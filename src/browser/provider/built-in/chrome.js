import fs from 'fs';
import Promise from 'pinkie';
import pify from 'pify';
import tmp from 'tmp';
import browserTools from 'testcafe-browser-tools';
import remoteChrome from 'chrome-remote-interface';
import emulatedDevices from 'chrome-emulated-devices-list';
import psNode from 'ps-node';
import { Config, ConfigSchema } from 'config-line';


const psLookup    = pify(psNode.lookup, Promise);
const psKill      = pify(psNode.kill, Promise);
const fsWriteFile = pify(fs.writeFile, Promise);

const PORT_RE = /:(\d)+$/;

const BROWSER_CLOSING_TIMEOUT    = 5;
const CONFIG_CACHE_CLEAR_TIMEOUT = 2 * 60 * 1000;

const CONFIG_SPEC = {
    remote:    false,
    noCdb:     false,
    args:      '',
    incognito: false,
    headless:  false,
    host:      'localhost',
    port:      9222,
    path:      '',

    userDataDir:    '',
    noTempUserData: false,

    emulation: false,

    device: {
        screen: {
            width:   0,
            height:  0,
            density: 0,
        },

        mobile:      false,
        orientation: 'default',
        name:        '',

        userAgent:          void 0,
        _userAgentTypeHint: 'string',

        touch:          void 0,
        _touchTypeHint: 'boolean'
    }
};

const CONFIG_SCHEMA     = new ConfigSchema(CONFIG_SPEC);
const DEVICE_PROPERTIES = Object.keys(CONFIG_SCHEMA).filter(key => key.indexOf('device') === 0);

var configCache = {};

function simplifyDeviceName (deviceName) {
    return deviceName.replace(/\s/g, '').toLowerCase();
}

function findDevice (deviceName) {
    var simpleName = simplifyDeviceName(deviceName);

    return emulatedDevices.filter(device => simplifyDeviceName(device.title).indexOf(simpleName) >= 0)[0];
}

async function getNewConfig (configString) {
    if (configString.indexOf('--') === 0)
        configString = 'args=' + configString;

    var config = new Config(CONFIG_SCHEMA, configString);

    config.override('remote', !config.isDefault('host'));

    if (config.remote) {
        config.noTempUserData = true;

        var portMatch = config.host.match(PORT_RE);

        if (portMatch) {
            config.override('port', Number(portMatch[1]));
            config.host = config.host.replace(PORT_RE, '');
        }
    }
    else
        config.override('noTempUserData', !!config.userDataDir);

    config.emulation = DEVICE_PROPERTIES.some(key => !config.isDefault(key));

    if (config.device.name) {
        var dbDevice = findDevice(config.device.name);

        config.override('device.mobile', dbDevice.capabilities.indexOf('mobile') >= 0);
        config.override('device.touch', dbDevice.capabilities.indexOf('touch') >= 0);
        config.override('device.orientation', config.device.mobile ? 'vertical' : 'horizontal');
        config.override('device.screen.width', dbDevice.screen[config.device.orientation].width);
        config.override('device.screen.height', dbDevice.screen[config.device.orientation].height);
        config.override('device.screen.density', dbDevice.screen['device-pixel-ratio']);
        config.override('device.userAgent', dbDevice['user-agent']);
    }

    return config;
}

async function getConfig (configString) {
    if (!configCache[configString]) {
        configCache[configString] = getNewConfig(configString);

        setTimeout(() => delete configCache[configString], CONFIG_CACHE_CLEAR_TIMEOUT);
    }

    return await configCache[configString];
}

function buildChromeArgs (config, platformArgs, tempUserDataDir) {
    var tempUserDataDirName = tempUserDataDir && tempUserDataDir.name;
    var userDataDir         = config.userDataDir || tempUserDataDirName;

    return []
        .concat(
            !config.noCdb ? [`--remote-debugging-port=${config.port}`] : [],
            userDataDir ? [`--user-data-dir=${userDataDir}`] : [],
            config.headless ? ['--headless'] : [],
            config.incognito ? ['--incognito'] : [],
            config.args ? [config.args] : [],
            platformArgs ? [platformArgs] : []
        )
        .join(' ');
}

async function killChrome (config) {
    var chromeOptions = { arguments: `--remote-debugging-port=${config.port}` };
    var chromeProcess = await psLookup(chromeOptions);

    if (!chromeProcess.length)
        return true;

    try {
        await psKill(chromeProcess[0].pid, { timeout: BROWSER_CLOSING_TIMEOUT });

        return true;
    }
    catch (e) {
        return false;
    }
}

async function stopLocalChrome (config) {
    if (!await killChrome(config))
        await killChrome(config);
}

async function getActiveTab (config, browserId) {
    var tabs = await remoteChrome.listTabs(config);
    var tab  = tabs.filter(t => t.type === 'page' && t.url.indexOf(browserId) > -1)[0];

    return tab;
}

async function setEmulationBounds (client, device, overrideWidth, overrideHeight) {
    var width  = overrideWidth !== void 0 ? overrideWidth : device.screen.width;
    var height = overrideHeight !== void 0 ? overrideHeight : device.screen.height;

    await client.Emulation.setDeviceMetricsOverride({
        width:             width,
        height:            height,
        deviceScaleFactor: device.screen.density,
        mobile:            device.mobile,
        fitWindow:         true
    });

    await client.Emulation.setVisibleSize({ width, height });
}

async function setEmulation (client, device) {
    if (device.userAgent !== void 0)
        await client.Network.setUserAgentOverride({ userAgent: device.userAgent });

    if (device.touch !== void 0) {
        await client.Emulation.setTouchEmulationEnabled({
            enabled:       device.touch,
            configuration: device.mobile ? 'mobile' : 'desktop'
        });
    }

    await setEmulationBounds(client, device);
}

async function getWindowId (client, tab) {
    try {
        var { windowId } = await client.Browser.getWindowForTarget({ targetId: tab.id });

        return windowId;
    }
    catch (e) {
        return null;
    }
}

async function getCdbClientInfo (config, browserId) {
    try {
        var tab = config.remote ? await remoteChrome.spawnTab(config) : await getActiveTab(config, browserId);

        if (!tab)
            return {};

        var client   = await remoteChrome({ target: tab, host: config.host, port: config.port });
        var windowId = await getWindowId(client, tab);

        return { tab, client, windowId };
    }
    catch (e) {
        return {};
    }
}

async function isCdbEnabled (config) {
    var chromeOptions = { arguments: `--remote-debugging-port=${config.port}` };
    var chromeProcess = await psLookup(chromeOptions);

    return !!chromeProcess.length;
}

function createTempUserDataDir () {
    tmp.setGracefulCleanup();

    return tmp.dirSync({ unsafeCleanup: true });
}

export default {
    openedBrowsers: {},

    isMultiBrowser: false,

    async _startLocalChrome (browserId, config, pageUrl, tempUserDataDir) {
        var chromeInfo = null;

        if (config.path)
            chromeInfo = await browserTools.getBrowserInfo(config.path);
        else
            chromeInfo = await browserTools.getBrowserInfo(this.providerName);

        var chromeOpenParameters = Object.assign({}, chromeInfo);

        chromeOpenParameters.cmd = buildChromeArgs(config, chromeOpenParameters.cmd, tempUserDataDir);

        await browserTools.open(chromeOpenParameters, pageUrl);

        await this.waitForConnectionReady(browserId);
    },

    async openBrowser (browserId, pageUrl, configString) {
        var config          = await getConfig(configString);
        var tempUserDataDir = !config.remote && !config.noTempUserData && createTempUserDataDir() || null;

        if (!config.remote)
            await this._startLocalChrome(browserId, config, pageUrl, tempUserDataDir);

        var cdbEnabled    = config.remote || !config.noCdb && await isCdbEnabled(config);
        var cdbClientInfo = cdbEnabled && await getCdbClientInfo(config, browserId) || {};

        if (cdbClientInfo.client) {
            await cdbClientInfo.client.Page.enable();
            await cdbClientInfo.client.Network.enable();


            if (config.emulation)
                await setEmulation(cdbClientInfo.client, config.device);

            if (config.remote)
                await cdbClientInfo.client.Page.navigate({ url: pageUrl });
        }

        var hasLocalWindow = !config.remote || !!await browserTools.findWindow(browserId);

        Object.assign(cdbClientInfo, { config, tempUserDataDir, hasLocalWindow });

        this.openedBrowsers[browserId] = cdbClientInfo;
    },

    async closeBrowser (browserId) {
        var { tab, config } = this.openedBrowsers[browserId];

        if (tab && (config.remote || config.headless)) {
            await remoteChrome.closeTab({ id: tab.id, host: config.host, port: config.port });

            if (!config.remote)
                await stopLocalChrome(config);
        }
        else
            await browserTools.close(browserId);

        delete this.openedBrowsers[browserId];
    },

    async isLocalBrowser (browserId, configString) {
        var config = this.openedBrowsers[browserId] && this.openedBrowsers[browserId].config ||
                     await getConfig(configString);

        var hasLocalWindow = this.openedBrowsers[browserId] && this.openedBrowsers[browserId].hasLocalWindow;

        return !config.remote && !config.headless || hasLocalWindow;
    },

    async takeScreenshot (browserId, path) {
        var { client, config } = this.openedBrowsers[browserId];

        var screenshot = await client.Page.captureScreenshot({ fromSurface: config.headless });

        await fsWriteFile(path, screenshot.data, { encoding: 'base64' });
    },

    async resizeWindow (browserId, width, height, currentWidth, currentHeight) {
        var { client, config, windowId } = this.openedBrowsers[browserId];

        if (config.emulation || !windowId && config.headless) {
            await setEmulationBounds(client, config.device, width, height);

            return;
        }

        if (!windowId)
            return;

        var bounds = await client.Browser.getWindowBounds({ windowId });

        bounds.width += width - currentWidth;
        bounds.height += height - currentHeight;

        await client.Browser.setWindowBounds({ windowId, bounds });
    },

    async hasCustomActionForBrowser (browserId) {
        var { config, windowId, client } = this.openedBrowsers[browserId];

        return {
            hasResizeWindow:                !!client && (config.emulation || windowId || config.headless),
            hasTakeScreenshot:              !!client,
            hasCanResizeWindowToDimensions: false,
            hasMaximizeWindow:              false
        };
    }
};
