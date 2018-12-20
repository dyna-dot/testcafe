import { spawn } from 'child_process';
import { flatten } from 'lodash';
import Promise from 'pinkie';
import AsyncEmitter from '../utils/async-event-emitter';
import delay from '../utils/delay';


const DEFAULT_OPTIONS = {
    'y':                           true,
    'use_wallclock_as_timestamps': 1,
    'i':                           'pipe:0',
    'c:v':                         'libx264',
    'preset':                      'ultrafast',
    'pix_fmt':                     'yuv420p',
    'vf':                          'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    'r':                           30
};

const FFMPEG_START_DELAY = 500;

export default class VideoRecorder extends AsyncEmitter {
    constructor (basePath, ffmpegPath, connection, customOptions) {
        super();

        this.customOptions = customOptions;
        this.videoPath     = basePath;
        this.connection    = connection;
        this.ffmpegPath    = ffmpegPath;
        this.ffmpegProcess = null;

        this.ffmpegClosingPromise = null;

        this.closed = false;

        this.optionsList = this._getOptionsList();

        this.capturingPromise = null;
    }

    static _filterOption ([key, value]) {
        if (value === true)
            return ['-' + key];

        return ['-' + key, value];
    }

    _getOptionsList () {
        const optionsObject = Object.assign({}, DEFAULT_OPTIONS, this.customOptions);

        const optionsList = flatten(Object.entries(optionsObject).map(VideoRecorder._filterOption));

        optionsList.push(this.videoPath);

        return optionsList;
    }

    async _addFrame (frameData) {
        const writingFinished = this.ffmpegProcess.stdin.write(frameData);

        if (!writingFinished)
            await new Promise(r => this.ffmpegProcess.stdin.once('drain', r));
    }

    async _capture () {
        while (!this.closed) {
            const frame = await this.connection.provider.getVideoFrameData(this.connection.id);

            if (frame) {
                await this.emit('frame');
                await this._addFrame(frame);
            }
        }
    }

    async init () {
        this.ffmpegProcess = spawn(this.ffmpegPath, this.optionsList, { stdio: ['pipe', 'ignore', 'ignore' ] });

        this.ffmpegClosingPromise = new Promise(r => {
            this.ffmpegProcess.on('exit', r);
            this.ffmpegProcess.on('error', r);
        });

        await delay(FFMPEG_START_DELAY);
    }

    async startCapturing () {
        this.capturingPromise = this._capture();

        await this.once('frame');
    }

    async finishCapturing () {
        if (this.closed)
            return;

        this.closed = true;

        await this.capturingPromise;

        this.ffmpegProcess.stdin.end();

        await this.ffmpegClosingPromise;
    }
}
