import { transport, Promise } from '../deps/hammerhead';
import { scrollController, delay } from '../deps/testcafe-core';
import { Scroll as ScrollAutomation } from '../deps/testcafe-automation';
import { hide as hideUI, show as showUI, showScreenshotMark, hideScreenshotMark } from '../deps/testcafe-ui';
import DriverStatus from '../status';
import ensureCropOptions from './ensure-crop-options';
import { ensureElements, createElementDescriptor } from '../utils/ensure-elements';
import runWithBarriers from '../utils/run-with-barriers';
import MESSAGE from '../../../test-run/client-messages';
import COMMAND_TYPE from '../../../test-run/commands/type';
import { ScrollOptions } from '../../../test-run/commands/options';


const POSSIBLE_RESIZE_ERROR_DELAY = 100;

class ManipulationExecutor {
    constructor (command, globalSelectorTimeout) {
        this.globalSelectorTimeout = globalSelectorTimeout;

        this.command  = command;
        this.elements = null;
    }

    _createManipulationReadyMessage () {
        var dpr = window.devicePixelRatio || 1;

        var message = {
            cmd: MESSAGE.readyForBrowserManipulation,

            pageDimensions: {
                dpr:            dpr,
                innerWidth:     window.innerWidth,
                innerHeight:    window.innerHeight,
                documentWidth:  document.documentElement.clientWidth,
                documentHeight: document.documentElement.clientHeight,
                bodyWidth:      document.body.clientWidth,
                bodyHeight:     document.body.clientHeight
            },

            disableResending: true
        };

        if (this.command.type === COMMAND_TYPE.takeElementScreenshot) {
            var { top, left } = this.elements[0].getBoundingClientRect();

            if (this.command.options.includeMargins) {
                top -= this.command.options.marginTop;
                left -= this.command.options.marginLeft;
            }

            var right  = left + this.command.options.crop.right;
            var bottom = top + this.command.options.crop.bottom;

            top += this.command.options.crop.top;
            left += this.command.options.crop.left;

            message.cropDimensions = { top, left, bottom, right };
        }

        return message;
    }

    _runScrollBeforeScreenshot () {
        return ensureElements([createElementDescriptor(this.command.selector)], this.globalSelectorTimeout)
            .then(elements => {
                this.elements = elements;

                ensureCropOptions(this.elements[0], this.command.options);

                var { scrollTargetX, scrollTargetY, scrollToCenter } = this.command.options;

                var scrollAutomation = new ScrollAutomation(this.elements[0], new ScrollOptions({
                    offsetX: scrollTargetX,
                    offsetY: scrollTargetY,
                    scrollToCenter
                }));

                return scrollAutomation.run();
            });
    }

    _runManipulation () {
        var manipulationResult = null;

        hideUI();

        if (this.command.markData)
            showScreenshotMark(this.command.markData);

        return Promise
            .resolve()
            .then(() => {
                if (this.command.type !== COMMAND_TYPE.takeElementScreenshot)
                    return Promise.resolve();

                scrollController.stopPropagation();

                return this._runScrollBeforeScreenshot();
            })
            .then(() => transport.queuedAsyncServiceMsg(this._createManipulationReadyMessage()))
            .then(({ result, error }) => {
                if (error)
                    throw error;

                scrollController.enablePropagation();

                manipulationResult = result;

                if (this.command.markData)
                    hideScreenshotMark();

                showUI();

                return delay(POSSIBLE_RESIZE_ERROR_DELAY);
            })
            .then(() => new DriverStatus({ isCommandResult: true, result: manipulationResult }))
            .catch(err => {
                scrollController.enablePropagation();

                return new DriverStatus({ isCommandResult: true, executionError: err });
            });
    }

    execute () {
        var { barriersPromise } = runWithBarriers(() => this._runManipulation());

        return barriersPromise;
    }
}

export default function (command, globalSelectorTimeout, statusBar, testSpeed) {
    var manipulationExecutor = new ManipulationExecutor(command, globalSelectorTimeout, statusBar, testSpeed);

    return manipulationExecutor.execute();
}
