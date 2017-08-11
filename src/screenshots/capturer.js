import { join as joinPath, dirname } from 'path';
import sanitizeFilename from 'sanitize-filename';
import { generateThumbnail } from 'testcafe-browser-tools';
import { ensureDir } from '../utils/promisified-functions';


const PNG_EXTENSION_RE = /(\.png)$/;


export default class Capturer {
    constructor (baseScreenshotsPath, testEntry, connection, namingOptions) {
        this.enabled              = !!baseScreenshotsPath;
        this.baseScreenshotsPath  = baseScreenshotsPath;
        this.testEntry            = testEntry;
        this.provider             = connection.provider;
        this.browserId            = connection.id;
        this.baseDirName          = namingOptions.baseDirName;
        this.userAgentName        = namingOptions.userAgentName;
        this.quarantineAttemptNum = namingOptions.quarantineAttemptNum;
        this.testIndex            = namingOptions.testIndex;
        this.screenshotIndex      = 1;
        this.errorScreenshotIndex = 1;

        var testDirName     = `test-${this.testIndex}`;
        var screenshotsPath = this.enabled ? joinPath(this.baseScreenshotsPath, this.baseDirName, testDirName) : '';

        this.screenshotsPath         = screenshotsPath;
        this.screenshotPathForReport = screenshotsPath;
    }

    static _correctFilePath (path) {
        var correctedPath = path
            .replace(/\\/g, '/')
            .split('/')
            .map(str => sanitizeFilename(str))
            .join('/');

        return PNG_EXTENSION_RE.test(correctedPath) ? correctedPath : `${correctedPath}.png`;
    }

    _getFileName (forError) {
        var fileName = `${forError ? this.errorScreenshotIndex : this.screenshotIndex}.png`;

        if (forError)
            this.errorScreenshotIndex++;
        else
            this.screenshotIndex++;

        return fileName;
    }

    _getSreenshotPath (fileName, customPath) {
        if (customPath)
            return joinPath(this.baseScreenshotsPath, Capturer._correctFilePath(customPath));

        var screenshotPath = this.quarantineAttemptNum !== null ?
                             joinPath(this.screenshotsPath, `run-${this.quarantineAttemptNum}`) :
                             this.screenshotsPath;

        return joinPath(screenshotPath, this.userAgentName, fileName);
    }

    async _takeScreenshot (filePath, pageWidth, pageHeight) {
        console.log('_takeScreenshot', filePath, pageWidth, pageHeight);
        await ensureDir(dirname(filePath));
        console.log('ensureDir');
        await this.provider.takeScreenshot(this.browserId, filePath, pageWidth, pageHeight);
        console.log('screenshot taken');
    }

    async _capture (forError, pageWidth, pageHeight, customScreenshotPath) {
        console.log('_capture');
        if (!this.enabled) {
            console.log('!enabled');
            return null;
        }


        var fileName = this._getFileName(forError);

        console.log('78:', fileName);

        fileName = forError ? joinPath('errors', fileName) : fileName;

        console.log('82:', fileName);

        var screenshotPath = this._getSreenshotPath(fileName, customScreenshotPath);

        console.log('86:', screenshotPath);

        await this._takeScreenshot(screenshotPath, pageWidth, pageHeight);

        console.log('93:', 'after _takeScreenshot');

        await generateThumbnail(screenshotPath);

        console.log('97:', 'generated');

        // NOTE: if test contains takeScreenshot action with custom path
        // we should specify the most common screenshot folder in report
        if (customScreenshotPath)
            this.screenshotPathForReport = this.baseScreenshotsPath;

        this.testEntry.hasScreenshots = true;
        this.testEntry.path           = this.screenshotPathForReport;
        console.log('106:', this.testEntry.path);

        return screenshotPath;
    }


    async captureAction ({ pageWidth, pageHeight, customPath }) {
        return await this._capture(false, pageWidth, pageHeight, customPath);
    }

    async captureError ({ pageWidth, pageHeight }) {
        return await this._capture(true, pageWidth, pageHeight);
    }
}

