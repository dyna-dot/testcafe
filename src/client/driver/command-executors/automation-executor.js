import { Promise } from '../deps/hammerhead';

import {
    domUtils,
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

    _runRecursively (strictElementCheck) {
        return this._awaitEnsureCommandElements()
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
            .catch(err => {
                if (!this.shouldRerunOnError(err))
                    return Promise.resolve();

                var timeoutExpired = Date.now() - this.executionStartTime >= this.commandSelectorTimeout;

                if (timeoutExpired) {
                    if (err.message === AUTOMATION_ERROR_TYPES.foundElementIsNotTarget) {
                        // If we can't get a target element via elementFromPoint but it's
                        // visible we click on the point where the element is located.
                        return this._runRecursively(false);
                    }

                    throw err.message === AUTOMATION_ERROR_TYPES.elementIsInvisibleError ?
                        new ActionElementIsInvisibleError() : err;
                }

                return delay(CHECK_ELEMENT_IN_AUTOMATIONS_INTERVAL).then(() => this._runRecursively(strictElementCheck));
            });
    }

    // Overridable API
    ensureCommandArguments () {

    }

    ensureCommandElements () {
        if (this.command.selector) {
            this.ensureElement(
                this.command.selector,
                () => new ActionElementNotFoundError(),
                () => new ActionElementIsInvisibleError(),
                nodeDescription => new ActionSelectorMatchesWrongNodeTypeError(nodeDescription)
            );
        }
    }

    ensureCommandElementsProperties () {

    }

    ensureCommandOptions () {
        if (this.elements.length && this.command.options && 'offsetX' in this.command.options && 'offsetY' in this.command.options)
            ensureOffsetOptions(this.elements[0], this.command.options);
    }

    createAutomation () {
        return DUMMY_AUTOMATION;
    }

    shouldReturnResult (result) { // eslint-disable-line no-unused-vars
        return false;
    }

    shouldRerunOnError (error) { // eslint-disable-line no-unused-vars
        return true;
    }

    // Public API
    ensureElement (selectorCommand, createNotFoundError, createIsInvisibleError, createHasWrongNodeTypeError) {
        this.ensureElementsPromise = this.ensureElementsPromise
            .then(() => {
                var selectorExecutor = new SelectorExecutor(selectorCommand, this.globalSelectorTimeout, this.ensureElementsStartTime,
                    createNotFoundError, createIsInvisibleError);

                return selectorExecutor.getResult();
            })
            .then(el => {
                if (!domUtils.isDomElement(el))
                    throw createHasWrongNodeTypeError(NODE_TYPE_DESCRIPTIONS[el.nodeType]);

                this.elements.push(el);
            });
    }

    execute () {
        var startPromise = new Promise(resolve => {
            this.executionStartedHandler = resolve;
        });

        if (this.command.options && !this.command.options.speed)
            this.command.options.speed = this.testSpeed;

        var completionPromise = new Promise(resolve => {
            this.executionStartTime = new Date();

            try {
                this.ensureCommandArguments();
            }
            catch (err) {
                resolve(new DriverStatus({ isCommandResult: true, executionError: err }));
                return;
            }

            var requestBarrier         = new RequestBarrier();
            var scriptExecutionBarrier = new ScriptExecutionBarrier();

            pageUnloadBarrier.watchForPageNavigationTriggers();

            this.commandSelectorTimeout = this._getSpecificTimeout();

            var result = null;

            this.statusBar.showWaitingElementStatus(this.commandSelectorTimeout);

            this._runRecursively(true)
                .then(runResult => {
                    if (this.shouldReturnResult(result))
                        result = runResult;

                    return Promise.all([
                        this._delayAfterExecution(),

                        // NOTE: script can be added by xhr-request, so we should run
                        // script execution barrier waiting after request barrier resolved
                        requestBarrier
                            .wait()
                            .then(() => scriptExecutionBarrier.wait()),

                        pageUnloadBarrier.wait()
                    ]);
                })
                .then(() => resolve(new DriverStatus({ isCommandResult: true, result })))
                .catch(err => {
                    return this.statusBar.hideWaitingElementStatus(false)
                        .then(() => resolve(new DriverStatus({ isCommandResult: true, executionError: err })));
                });
        });

        return { startPromise, completionPromise };
    }
}
