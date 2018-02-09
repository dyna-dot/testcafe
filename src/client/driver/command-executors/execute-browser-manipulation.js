import { transport, Promise } from '../deps/hammerhead';
import { scrollController, delay } from '../deps/testcafe-core';
import { Scroll as ScrollAutomation } from '../deps/testcafe-automation';
import AutomationExecutor from './automation-executor';
import ensureCropOptions from './ensure-crop-options';
import { hide as hideUI, show as showUI, showScreenshotMark, hideScreenshotMark } from '../deps/testcafe-ui';
import MESSAGE from '../../../test-run/client-messages';
import COMMAND_TYPE from '../../../test-run/commands/type';
import { ScrollOptions } from '../../../test-run/commands/options';


const POSSIBLE_RESIZE_ERROR_DELAY = 100;

class ManipulationExecutor extends AutomationExecutor {
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

    _runManipulation () {
        var result  = null;

        hideUI();

        if (this.command.markData)
            showScreenshotMark(this.command.markData);

        return Promise
            .resolve()
            .then(() => {
                if (this.command.type !== COMMAND_TYPE.takeElementScreenshot)
                    return Promise.resolve();

                scrollController.stopPropagation();

                var { offsetX, offsetY, scrollToCenter } = this.command.options;
                var scrollAutomation     = new ScrollAutomation(this.elements[0], new ScrollOptions({ offsetX, offsetY, scrollToCenter }));

                return scrollAutomation.run();
            })
            .then(() => transport.queuedAsyncServiceMsg(this._createManipulationReadyMessage()))
            .catch(err => {
                scrollController.enablePropagation();

                return Promise.reject(err);
            })
            .then(res => {
                scrollController.enablePropagation();

                result = res;

                if (this.command.markData)
                    hideScreenshotMark();

                showUI();

                return delay(POSSIBLE_RESIZE_ERROR_DELAY);
            })
            .then(() => result);
    }

    // Overridden API
    ensureCommandOptions () {
        if (this.command.type === COMMAND_TYPE.takeElementScreenshot)
            ensureCropOptions(this.elements[0], this.command.options);
    }

    createAutomation () {
        return { run: () => this._runManipulation() };
    }

    shouldReturnResult () {
        return true;
    }

    shouldRerunOnError () {
        return false;
    }
}

export default function (command, globalSelectorTimeout, statusBar, testSpeed) {
    var manipulationExecutor = new ManipulationExecutor(command, globalSelectorTimeout, statusBar, testSpeed);

    return manipulationExecutor.execute().completionPromise;
}
