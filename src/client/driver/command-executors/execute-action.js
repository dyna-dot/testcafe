import {
    domUtils,
    contentEditable,
    parseKeySequence,
} from '../deps/testcafe-core';

import { ensureElements, createElementDescriptor, createAdditionalElementDescriptor } from '../utils/ensure-elements';

import AutomationExecutor from './automation-executor';

import {
    calculateSelectTextArguments,
    Click as ClickAutomation,
    SelectChildClick as SelectChildClickAutomation,
    RClick as RClickAutomation,
    DblClick as DblClickAutomation,
    DragToOffset as DragToOffsetAutomation,
    DragToElement as DragToElementAutomation,
    Hover as HoverAutomation,
    Type as TypeAutomation,
    SelectText as SelectTextAutomation,
    SelectEditableContent as SelectEditableContentAutomation,
    Press as PressAutomation,
    Upload as UploadAutomation
} from '../deps/testcafe-automation';

import COMMAND_TYPE from '../../../test-run/commands/type';

import {
    ActionAdditionalElementNotFoundError,
    ActionAdditionalElementIsInvisibleError,
    ActionAdditionalSelectorMatchesWrongNodeTypeError,
    ActionIncorrectKeysError,
    ActionCanNotFindFileToUploadError,
    ActionElementNonEditableError,
    ActionElementNonContentEditableError,
    ActionRootContainerNotFoundError,
    ActionElementNotTextAreaError,
    ActionElementIsNotFileInputError
} from '../../../errors/test-run';


// Ensure command element properties
function ensureElementEditable (element) {
    if (!domUtils.isEditableElement(element))
        throw new ActionElementNonEditableError();
}

function ensureTextAreaElement (element) {
    if (!domUtils.isTextAreaElement(element))
        throw new ActionElementNotTextAreaError();
}

function ensureContentEditableElement (element, argumentTitle) {
    if (!domUtils.isContentEditableElement(element))
        throw new ActionElementNonContentEditableError(argumentTitle);
}

function ensureRootContainer (elements) {
    // NOTE: We should find a common element for the nodes to perform the select action
    if (!contentEditable.getNearestCommonAncestor(elements[0], elements[1]))
        throw new ActionRootContainerNotFoundError();

    return elements;
}

function ensureFileInput (element) {
    if (!domUtils.isFileInput(element))
        throw new ActionElementIsNotFileInputError();
}



class ActionExecutor extends AutomationExecutor {
    ensureCommandElementsProperties () {
        super.ensureCommandElementsProperties();

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

    ensureCommandArguments () {
        super.ensureCommandArguments();

        if (this.command.type === COMMAND_TYPE.pressKey) {
            var parsedKeySequence = parseKeySequence(this.command.keys);

            if (parsedKeySequence.error)
                throw new ActionIncorrectKeysError('keys');
        }
    }


}

export default function executeAction (command, globalSelectorTimeout, statusBar, testSpeed) {
    var actionExecutor = new ActionExecutor(command, globalSelectorTimeout, statusBar, testSpeed);

    return actionExecutor.execute();
}
