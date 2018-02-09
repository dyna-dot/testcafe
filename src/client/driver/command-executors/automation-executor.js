import { Promise } from '../deps/hammerhead';

import {
    domUtils,
    promiseUtils,
    RequestBarrier,
    pageUnloadBarrier,
    delay,
    NODE_TYPE_DESCRIPTIONS
} from '../deps/testcafe-core';

import ScriptExecutionBarrier from '../script-execution-barrier';

import {
    ERROR_TYPES as AUTOMATION_ERROR_TYPES,
    getOffsetOptions
} from '../deps/testcafe-automation';

import DriverStatus from '../status';
import SelectorExecutor from './client-functions/selector-executor';

import {
    ActionElementNotFoundError,
    ActionElementIsInvisibleError,
    ActionSelectorMatchesWrongNodeTypeError
} from '../../../errors/test-run';


const MAX_DELAY_AFTER_EXECUTION             = 2000;
const CHECK_ELEMENT_IN_AUTOMATIONS_INTERVAL = 250;

const DUMMY_AUTOMATION = { run: () => Promise.resolve() };

function ensureOffsetOptions (element, options) {
    var { offsetX, offsetY } = getOffsetOptions(element, options.offsetX, options.offsetY);

    options.offsetX = offsetX;
    options.offsetY = offsetY;
}

export default class AutomationExecutor {
    constructor (command, globalSelectorTimeout, statusBar, testSpeed) {
        this.command                = command;
        this.globalSelectorTimeout  = globalSelectorTimeout;
        this.statusBar              = statusBar;
        this.testSpeed              = testSpeed;

        this.elements                = [];
        this.ensureElementsPromise   = null;
        this.ensureElementsStartTime = null;

        this.executionStartTime      = null;
        this.executionStartedHandler = null;
        this.commandSelectorTimeout  = null;

    }

    _awaitEnsureCommandElements () {
        this.elements              = [];
        this.ensureElementsPromise = Promise.resolve();
        this.startTime             = new Date();

        this.ensureCommandElements();

        return this.ensureElementsPromise;
    }

    _getSpecificTimeout () {
        var hasSpecificTimeout = this.command.selector && typeof this.command.selector.timeout === 'number';

        return hasSpecificTimeout ? this.command.selector.timeout : this.globalSelectorTimeout;
    }

    _delayAfterExecution () {
        if (!this.command.options || this.command.options.speed === 1)
            return Promise.resolve();

        return delay((1 - this.command.options.speed) * MAX_DELAY_AFTER_EXECUTION);
    }

    _isExecutionTimeoutExpired () {
        return Date.now() - this.executionStartTime >= this.commandSelectorTimeout;
    }

    _runAction (strictElementCheck) {
        return this
            .ensureCommandElements()
            .then(() => this.ensureCommandElementsProperties())
            .then(() => {
                this.ensureCommandOptions();

                var automation = this.createAutomation();

                if (automation.TARGET_ELEMENT_FOUND_EVENT) {
                    automation.on(automation.TARGET_ELEMENT_FOUND_EVENT, () => {
                        this.statusBar.hideWaitingElementStatus(true);
                        this.executionStartedHandler();
                    });
                }
                else {
                    this.statusBar.hideWaitingElementStatus(true);
                    this.executionStartedHandler();
                }

                return automation
                    .run(strictElementCheck);
            })
    }

    _runRecursively () {
        var actionFinished     = false;
        var strictElementCheck = true;

        return promiseUtils.whilst(() => !actionFinished, () => {
            return this
                ._runAction(true)
                .then(() => {
                    actionFinished = true;
                })
                .catch(err => {
                    var timeoutExpired =

                    if (timeoutExpired) {
                        if (err.message === AUTOMATION_ERROR_TYPES.foundElementIsNotTarget) {
                            // If we can't get a target element via elementFromPoint but it's
                            // visible we click on the point where the element is located.
                            return this._runRecursively(false);
                        }

                        throw err.message === AUTOMATION_ERROR_TYPES.elementIsInvisibleError ?
                            new ActionElementIsInvisibleError() : err;
                    }

                    return delay(CHECK_ELEMENT_IN_AUTOMATIONS_INTERVAL);
                });
        }

    }

    // Overridable API
    ensureCommandArguments () {
        if (this.command.type === COMMAND_TYPE.pressKey) {
            var parsedKeySequence = parseKeySequence(this.command.keys);

            if (parsedKeySequence.error)
                throw new ActionIncorrectKeysError('keys');
        }
    }

    ensureCommandElements () {
        var elements = [];

        if (this.command.selector)
            elements.push(createElementDescriptor(this.command.selector));

        if (this.command.type === COMMAND_TYPE.dragToElement)
            elements.push(createAdditionalElementDescriptor(this.command.destinationSelector, 'destinationSelector'));
        else if (this.command.type === COMMAND_TYPE.selectEditableContent) {
            elements.push(createAdditionalElementDescriptor(this.command.startSelector, 'startSelector'));
            elements.push(createAdditionalElementDescriptor(this.command.endSelector || this.command.startSelector, 'endSelector'));
        }

        return ensureElements(elements);
    }

    ensureCommandElementsProperties () {
        if (this.command.type === COMMAND_TYPE.selectText)
            ensureElementEditable(this.elements[0]);

        else if (this.command.type === COMMAND_TYPE.selectTextAreaContent)
            ensureTextAreaElement(this.elements[0]);

        else if (this.command.type === COMMAND_TYPE.selectEditableContent) {
            ensureContentEditableElement(this.elements[0], 'startSelector');
            ensureContentEditableElement(this.elements[1], 'endSelector');
            ensureRootContainer(this.elements);
        }

        else if (this.command.type === COMMAND_TYPE.setFilesToUpload || this.command.type === COMMAND_TYPE.clearUpload)
            ensureFileInput(this.elements[0]);
    }

    ensureCommandOptions () {
        if (this.elements.length && this.command.options && 'offsetX' in this.command.options && 'offsetY' in this.command.options)
            ensureOffsetOptions(this.elements[0], this.command.options);
    }

    createAutomation () {
        var selectArgs = null;

        switch (this.command.type) {
            case COMMAND_TYPE.click :
                if (/option|optgroup/.test(domUtils.getTagName(this.elements[0])))
                    return new SelectChildClickAutomation(this.elements[0], this.command.options);

                return new ClickAutomation(this.elements[0], this.command.options);

            case COMMAND_TYPE.rightClick :
                return new RClickAutomation(this.elements[0], this.command.options);

            case COMMAND_TYPE.doubleClick :
                return new DblClickAutomation(this.elements[0], this.command.options);

            case COMMAND_TYPE.hover :
                return new HoverAutomation(this.elements[0], this.command.options);

            case COMMAND_TYPE.drag :
                return new DragToOffsetAutomation(this.elements[0], this.command.dragOffsetX, this.command.dragOffsetY, this.command.options);

            case COMMAND_TYPE.dragToElement :
                return new DragToElementAutomation(this.elements[0], this.elements[1], this.command.options);

            case COMMAND_TYPE.typeText:
                return new TypeAutomation(this.elements[0], this.command.text, this.command.options);

            case COMMAND_TYPE.selectText:
            case COMMAND_TYPE.selectTextAreaContent:
                selectArgs = calculateSelectTextArguments(this.elements[0], this.command);

                return new SelectTextAutomation(this.elements[0], selectArgs.startPos, selectArgs.endPos, this.command.options);

            case COMMAND_TYPE.selectEditableContent:
                return new SelectEditableContentAutomation(this.elements[0], this.elements[1], this.command.options);

            case COMMAND_TYPE.pressKey:
                return new PressAutomation(parseKeySequence(this.command.keys).combinations, this.command.options);

            case COMMAND_TYPE.setFilesToUpload :
                return new UploadAutomation(this.elements[0], this.command.filePath,
                    filePaths => new ActionCanNotFindFileToUploadError(filePaths)
                );

            case COMMAND_TYPE.clearUpload :
                return new UploadAutomation(this.elements[0]);
        }

        return null;
    }

    execute () {
        if (this.command.options && !this.command.options.speed)
            this.command.options.speed = this.testSpeed;

        var startPromise = new Promise(resolve => {
            this.executionStartedHandler = resolve;
        });

        var completionPromise = new Promise(resolve => {
            this.executionStartTime = new Date();

            try {
                this.ensureCommandArguments();
            }
            catch (err) {
                resolve(new DriverStatus({ isCommandResult: true, executionError: err }));
                return;
            }


            this.commandSelectorTimeout = this._getSpecificTimeout();

            this.statusBar.showWaitingElementStatus(this.commandSelectorTimeout);

            var { actionPromise, barriersPromise } = runWithBarriers(() => this._runRecursively());

            actionPromise
                .then(() => Promise.all([
                    this._delayAfterExecution(),
                    barriersPromise
                ]))
                .then(() => resolve(new DriverStatus({ isCommandResult: true })))
                .catch(err => {
                    return this.statusBar.hideWaitingElementStatus(false)
                        .then(() => resolve(new DriverStatus({ isCommandResult: true, executionError: err })));
                });
        });

        return { startPromise, completionPromise };
    }
}
