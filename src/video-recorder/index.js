import { join, dirname } from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import makeDir from 'make-dir';
import VideoRecorderProcess from './process';
import TempDirectory from '../utils/temp-directory';
import PathPattern from '../utils/path-pattern';


const VIDEO_EXTENSION = 'mp4';

const TEMP_DIR_PREFIX        = 'video';
const TEMP_VIDEO_FILE_PREFIX = 'tmp-video';
const TEMP_MERGE_FILE_PREFIX = TEMP_VIDEO_FILE_PREFIX + '-merge';

const TEMP_MERGE_CONFIG_FILE_PREFIX    = 'config';
const TEMP_MERGE_CONFIG_FILE_EXTENSION = 'txt';

export default class VideoRecorder {
    constructor (browserJob, basePath, opts, encodingOpts) {
        this.basePath          = basePath;
        this.failedOnly        = opts.failedOnly;
        this.singleFile        = opts.singleFile;
        this.ffmpegPath        = opts.ffmpegPath;
        this.customPathPattern = opts.pathPattern;
        this.timeStamp         = opts.timeStamp;
        this.encodingOptions   = encodingOpts;

        this.tempDirectory = new TempDirectory(TEMP_DIR_PREFIX);
        this.tempVideoPath = '';
        this.tempMergeConfigPath = '';

        this.firstFile = true;

        this.testRunInfo = {};

        this._assignEventHandlers(browserJob);
    }

    _assignEventHandlers (browserJob) {
        browserJob.once('start', () => this._onBrowserJobStart());
        browserJob.once('done', () => this._onBrowserJobDone());
        browserJob.on('test-run-create', testRunInfo => this._onTestRunCreate(testRunInfo));
        browserJob.on('test-run-ready', testRun => this._onTestRunReady(testRun));
        browserJob.on('test-run-done', testRun => this._onTestRunDone(testRun));
    }

    _getTargetVideoPath (testRunInfo) {
        if (this.singleFile)
            return join(this.basePath, 'video.mp4');

        const { quarantine, test, index, testRun } = testRunInfo;

        const connection = testRun.browserConnection;

        const pathPattern = new PathPattern(this.customPathPattern, VIDEO_EXTENSION, {
            testIndex:         index,
            quarantineAttempt: quarantine ? quarantine.getNextAttemptNumber() : null,
            now:               this.timeStamp,
            fixture:           test.fixture.name,
            test:              test.name,
            parsedUserAgent:   connection.browserInfo.parsedUserAgent,
        });

        return join(this.basePath, pathPattern.getPath());
    }

    _generateTempNames (id) {
        const tempFileNames = {
            tempVideoPath:       `${TEMP_VIDEO_FILE_PREFIX}-${id}.${VIDEO_EXTENSION}`,
            tempMergeConfigPath: `${TEMP_MERGE_CONFIG_FILE_PREFIX}-${id}.${TEMP_MERGE_CONFIG_FILE_EXTENSION}`,
            tmpMergeName:        `${TEMP_MERGE_FILE_PREFIX}-${id}.${VIDEO_EXTENSION}`
        };

        for (const [tempFile, tempName] of Object.entries(tempFileNames))
            tempFileNames[tempFile] = join(this.tempDirectory.path, tempName);

        return tempFileNames;
    }

    _concatVideo (targetVideoPath, { tempVideoPath, tempMergeConfigPath, tempMergePath }) {
        if (this.firstFile) {
            this.firstFile = false;
            return;
        }

        fs.writeFileSync(this.tempMergeConfigPath, `
            file '${targetVideoPath}'
            file '${tempVideoPath}'
        `);

        spawnSync(this.ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', tempMergeConfigPath, '-c', 'copy', tempMergePath], { stdio: 'inherit' });
        fs.copyFileSync(tempMergePath, tempVideoPath);
    }

    async _onBrowserJobStart () {
        await this.tempDirectory.init();
    }

    async _onBrowserJobDone () {
        await this.tempDirectory.dispose();
    }

    async _onTestRunCreate ({ testRun, quarantine, test, index }) {
        const testRunInfo = { testRun, quarantine, test, index };

        this.testRunInfo[testRun] = testRunInfo;

        const connection = testRun.browserConnection;

        testRunInfo.tempFiles = this._generateTempNames(connection.id);


        testRunInfo.videoRecorder = new VideoRecorderProcess(testRunInfo.tempFiles.tempVideoPath, this.ffmpegPath, connection, this.encodingOptions);

        await testRunInfo.videoRecorder.init();
    }

    async _onTestRunReady (testRun) {
        const testRunInfo = this.testRunInfo[testRun];

        await testRunInfo.videoRecorder.startCapturing();
    }

    async _onTestRunDone (testRun) {
        const testRunInfo = this.testRunInfo[testRun];

        delete this.testRunInfo[testRun];

        await testRunInfo.videoRecorder.finishCapturing();

        const videoPath = this._getTargetVideoPath(testRunInfo);

        if (this.failedOnly && !testRun.errs.length)
            return;

        await makeDir(dirname(videoPath));

        if (this.singleFile)
            this._concatVideo(videoPath, testRunInfo.tempFiles);

        fs.copyFileSync(testRunInfo.tempFiles.tempVideoPath, videoPath);
    }
}
