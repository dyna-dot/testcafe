import {
    domUtils,
    contentEditable,
    parseKeySequence,
} from '../deps/testcafe-core';

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
        super.ensureCommandElements();

        if (this.command.type === COMMAND_TYPE.dragToElement) {
            this.ensureElement(
                this.command.destinationSelector,
                () => new ActionAdditionalElementNotFoundError('destinationSelector'),
                () => new ActionAdditionalElementIsInvisibleError('destinationSelector'),
                nodeDescription => new ActionAdditionalSelectorMatchesWrongNodeTypeError('destinationSelector', nodeDescription)
            );
        }

        else if (this.command.type === COMMAND_TYPE.selectEditableContent) {
            this.ensureElement(
                this.command.startSelector,
                () => new ActionAdditionalElementNotFoundError('startSelector'),
                () => new ActionAdditionalElementIsInvisibleError('startSelector'),
                nodeDescription => new ActionAdditionalSelectorMatchesWrongNodeTypeError('startSelector', nodeDescription)
            );

            this.ensureElement(
                this.command.endSelector || this.command.startSelector,
                () => new ActionAdditionalElementNotFoundError('endSelector'),
                () => new ActionAdditionalElementIsInvisibleError('endSelector'),
                nodeDescription => new ActionAdditionalSelectorMatchesWrongNodeTypeError('endSelector', nodeDescription)
            );
        }
    }

    ensureCommandArguments () {
        super.ensureCommandArguments();

        if (this.command.type === COMMAND_TYPE.pressKey) {
            var parsedKeySequence = parseKeySequence(this.command.keys);

            if (parsedKeySequence.error)
                throw new ActionIncorrectKeysError('keys');
        }
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
}

export default function executeAction (command, globalSelectorTimeout, statusBar, testSpeed) {
    var actionExecutor = new ActionExecutor(command, globalSelectorTimeout, statusBar, testSpeed);

    return actionExecutor.execute();
}
