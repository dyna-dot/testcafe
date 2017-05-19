import fs from 'fs';
import Promise from 'pinkie';
import pify from 'pify';
import tmp from 'tmp';
import browserTools from 'testcafe-browser-tools';
import remoteChrome from 'chrome-remote-interface';
import emulatedDevices from 'chrome-emulated-devices-list';
import psNode from 'ps-node';
import OS from 'os-family';
import { Config, ConfigSchema } from 'config-line';


const psLookup    = pify(psNode.lookup, Promise);
const psKill      = pify(psNode.kill, Promise);
const fsWriteFile = pify(fs.writeFile, Promise);


const BROWSER_CLOSING_TIMEOUT    = 5;
const CONFIG_CACHE_CLEAR_TIMEOUT = 2 * 60 * 1000;

const CONFIG_SPEC = {
    headless: false,

    _deviceDefaultKey: 'name',

    device: {
        name: '',

        screen: {
            width:   0,
            height:  0,
            density: 0,
        },

        mobile:      false,
        orientation: 'default',

        userAgent:          void 0,
        _userAgentTypeHint: 'string',

        touch:          void 0,
        _touchTypeHint: 'boolean'
    },

    cdpArgs: {
        host: 'localhost',
        port: 9222,
        path: ''
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
    var config = new Config(CONFIG_SCHEMA, configString);

    config.userArgs  = config.unparsed;
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

function buildChromeArgs (config, platformArgs, userDataDir) {
    return [`--remote-debugging-port=${config.cdpArgs.port}`, `--user-data-dir=${userDataDir.name}`]
        .concat(
            config.headless ? ['--headless'] : [],
            config.userArgs ? [config.userArgs] : [],
            platformArgs ? [platformArgs] : []
        )
        .join(' ');
}

async function killChrome (config) {
    var chromeOptions = { arguments: `--remote-debugging-port=${config.cdpArgs.port}` };
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
    var tabs = await remoteChrome.listTabs({ host: config.cdpArgs.host, port: config.cdpArgs.port });
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

async function getCdpClientInfo (config, browserId) {
    try {
        var tab = await getActiveTab(config, browserId);

        if (!tab)
            return {};

        var client   = await remoteChrome({ target: tab, host: config.cdpArgs.host, port: config.cdpArgs.port });
        var windowId = await getWindowId(client, tab);

        return { tab, client, windowId };
    }
    catch (e) {
        return {};
    }
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

        if (config.cdpArgs.path)
            chromeInfo = await browserTools.getBrowserInfo(config.cdpArgs.path);
        else
            chromeInfo = await browserTools.getBrowserInfo(this.providerName);

        var chromeOpenParameters = Object.assign({}, chromeInfo);

        chromeOpenParameters.cmd = buildChromeArgs(config, chromeOpenParameters.cmd, tempUserDataDir);

        await browserTools.open(chromeOpenParameters, pageUrl);

        await this.waitForConnectionReady(browserId);
    },

    async openBrowser (browserId, pageUrl, configString) {
        var config          = await getConfig(configString);
        var tempUserDataDir = createTempUserDataDir();

        await this._startLocalChrome(browserId, config, pageUrl, tempUserDataDir);

        var cdpClientInfo = await getCdpClientInfo(config, browserId);

        if (cdpClientInfo.client) {
            await cdpClientInfo.client.Page.enable();
            await cdpClientInfo.client.Network.enable();

            if (config.emulation)
                await setEmulation(cdpClientInfo.client, config.device);
        }

        Object.assign(cdpClientInfo, { config, tempUserDataDir });

        this.openedBrowsers[browserId] = cdpClientInfo;
    },

    async closeBrowser (browserId) {
        var { tab, config } = this.openedBrowsers[browserId];

        if (tab && config.headless)
            await remoteChrome.closeTab({ id: tab.id, host: config.cdpArgs.host, port: config.cdpArgs.port });
        else
            await browserTools.close(browserId);

        if (OS.mac || config.headless)
            await stopLocalChrome(config);

        delete this.openedBrowsers[browserId];
    },

    async isLocalBrowser (browserId, configString) {
        var config = this.openedBrowsers[browserId] && this.openedBrowsers[browserId].config ||
                     await getConfig(configString);

        return !config.headless;
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
