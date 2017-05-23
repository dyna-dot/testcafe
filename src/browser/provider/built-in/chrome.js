import fs from 'fs';
import Promise from 'pinkie';
import pify from 'pify';
import tmp from 'tmp';
import browserTools from 'testcafe-browser-tools';
import remoteChrome from 'chrome-remote-interface';
import emulatedDevices from 'chrome-emulated-devices-list';
import psNode from 'ps-node';
import OS from 'os-family';
import { getFreePort } from 'endpoint-utils';


const psLookup    = pify(psNode.lookup, Promise);
const psKill      = pify(psNode.kill, Promise);
const fsWriteFile = pify(fs.writeFile, Promise);


const BROWSER_CLOSING_TIMEOUT    = 5;
const CONFIG_CACHE_CLEAR_TIMEOUT = 2 * 60 * 1000;

const CONFIG_TERMINATOR_RE = /(\s+|^)-/;

const DEFAULT_DEVICE_DATA = {
    capabilities
}

var configCache = {};

function hasMatch (array, re) {
    return array.some(el => el.match(re));
}

function findMatch (array, re) {
    var foundMatch = array
        .map((option, index) => ({ match: option.match(re), index }))
        .filter(({ match }) => !!match)
        .map(({ match, index }) => ({ match: match[1], index }))[0];

    return foundMatch || { match: '', index: -1 };
}

function splitEscaped (str, splitterChar) {
    var result = [''];

    for (var i = 0; i < str.length; i++) {
        if (str[i] === splitterChar) {
            result.push('');
            continue;
        }

        if (str[i] === '\\' && (str[i + 1] === '\\' || str [i + 1] === splitterChar))
            i++;

        result[result.length - 1] += str[i];
    }

    return result;
}

function splitConfig (str) {
    var configTerminatorMatch = str.match(CONFIG_TERMINATOR_RE);

    if (!configTerminatorMatch)
        return { modesString: str, userArgs: '' };

    return {
        modesString: str.substr(0, configTerminatorMatch.index),
        userArgs:    str.substr(configTerminatorMatch.index + configTerminatorMatch[1].length)
    };
}

function splitModes (str) {
    var parsed   = splitEscaped(str, ':');
    var pathMode = findMatch(parsed, /^path=(.*)/);

    if (OS.win && pathMode.index > -1 && pathMode.index < parsed.length - 1 && pathMode.match.match(/^A-Za-z$/))
        pathMode.match += ':' + parsed[pathMode.index + 1];

    var modes = {
        headless:  hasMatch(parsed, /^headless$/),
        emulation: hasMatch(parsed, /^emulation$/),
        path:      pathMode.match
    };

    var countOfModes  = Object.keys(modes).reduce((count, key) => modes[key] ? count + 1 : count, 0);
    var optionsString = countOfModes < Object.keys(modes).length ? parsed [parsed.length - 1] : '';

    return { modes, optionsString };
}

function splitOptions (str) {
    var parsed     = splitEscaped(str, ';');
    var deviceName = findMatch(parsed, /^deviceName=(.*)/).match;
    var deviceData = deviceName ? findDevice(deviceName) : null;
    var deviceBasedOptions = getDeviceBasedOptions;

    var mobile      = hasMatch(parsed, /^mobile$/) || deviceData.capabilities.indexOf('mobile') >= 0;
    var orientation = findMatch(parsed, /^orientation=(.*)/) || (mobile ? 'vertical' : 'horizontal').match;

    return {
        mobile:      mobile,
        orientation: orientation,
        touch:       hasMatch(parsed, /^touch$/) || deviceData.capabilities.indexOf('touch') >= 0,
        width:       findMatch(parsed, /^width=(.*)/).match || deviceData.screen[orientation].width,
        height:      findMatch(parsed, /^height=(.*)/).match || deviceData.screen[orientation].height,
        density:     findMatch(parsed, /^density=(.*)/).match || deviceData.screen['device-pixel-ratio'],
        userAgent:   findMatch(parsed, /^userAgent=(.*)/).match || deviceData['user-agent'],
        cdpPort:     findMatch(parsed, /^cdpPort=(.*)/).match || ''
    };
}

function simplifyDeviceName (deviceName) {
    return deviceName.replace(/\s/g, '').toLowerCase();
}

function findDevice (deviceName) {
    var simpleName = simplifyDeviceName(deviceName);

    return emulatedDevices.filter(device => simplifyDeviceName(device.title).indexOf(simpleName) >= 0)[0];
}

async function getNewConfig (configString) {
    var { userArgs, modesString } = splitConfig(configString);
    var { modes, optionsString }  = splitModes(modesString);
    var options                   = splitOptions(optionsString);

    return Object.assign({ userArgs }, modes, options);
}

async function getConfig (configString) {
    if (!configCache[configString]) {
        configCache[configString] = getNewConfig(configString);

        setTimeout(() => delete configCache[configString], CONFIG_CACHE_CLEAR_TIMEOUT);
    }

    return await configCache[configString];
}

function buildChromeArgs (config, cdpPort, platformArgs, userDataDir) {
    return [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir.name}`]
        .concat(
            config.headless ? ['--headless'] : [],
            config.userArgs ? [config.userArgs] : [],
            platformArgs ? [platformArgs] : []
        )
        .join(' ');
}

async function killChrome (config, cdpPort) {
    var chromeOptions = { arguments: `--remote-debugging-port=${cdpPort}` };
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

async function getActiveTab (cdpPort, browserId) {
    var tabs = await remoteChrome.listTabs({ port: cdpPort });
    var tab  = tabs.filter(t => t.type === 'page' && t.url.indexOf(browserId) > -1)[0];

    return tab;
}

async function setEmulationBounds (client, device, overrideWidth, overrideHeight) {
    var width  = overrideWidth !== void 0 ? overrideWidth : device.width;
    var height = overrideHeight !== void 0 ? overrideHeight : device.height;

    await client.Emulation.setDeviceMetricsOverride({
        width:             width,
        height:            height,
        deviceScaleFactor: device.density,
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

async function getCdpClientInfo (cdpPort, browserId) {
    try {
        var tab = await getActiveTab(cdpPort, browserId);

        if (!tab)
            return {};

        var client   = await remoteChrome({ target: tab, port: cdpPort });
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

    async _startLocalChrome (browserId, config, cdpPort, pageUrl, tempUserDataDir) {
        var chromeInfo = null;

        if (config.path)
            chromeInfo = await browserTools.getBrowserInfo(config.path);
        else
            chromeInfo = await browserTools.getBrowserInfo(this.providerName);

        var chromeOpenParameters = Object.assign({}, chromeInfo);

        chromeOpenParameters.cmd = buildChromeArgs(config, cdpPort, chromeOpenParameters.cmd, tempUserDataDir);

        await browserTools.open(chromeOpenParameters, pageUrl);

        await this.waitForConnectionReady(browserId);
    },

    async openBrowser (browserId, pageUrl, configString) {
        var config          = await getConfig(configString);
        var tempUserDataDir = createTempUserDataDir();
        var cdpPort         = config.cdpPort || await getFreePort();

        await this._startLocalChrome(browserId, config, cdpPort, pageUrl, tempUserDataDir);

        var cdpClientInfo = await getCdpClientInfo(cdpPort, browserId);

        if (cdpClientInfo.client) {
            await cdpClientInfo.client.Page.enable();
            await cdpClientInfo.client.Network.enable();

            if (config.emulation)
                await setEmulation(cdpClientInfo.client, config);
        }

        Object.assign(cdpClientInfo, { config, cdpPort, tempUserDataDir });

        this.openedBrowsers[browserId] = cdpClientInfo;
    },

    async closeBrowser (browserId) {
        var { tab, config, cdpPort } = this.openedBrowsers[browserId];

        if (tab && config.headless)
            await remoteChrome.closeTab({ id: tab.id, port: cdpPort });
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
