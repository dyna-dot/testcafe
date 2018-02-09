class ElementsRetriever {
    constructor (elementDescriptors) {
        this.elements                = [];
        this.ensureElementsPromise   = Promise.resolve();
        this.ensureElementsStartTime = new Date();

        elementDescriptors.forEach(descriptor => this._ensureElement(descriptor));
    }

    _ensureElement ({ selector, createNotFoundError, createIsInvisibleError, createHasWrongNodeTypeError }) {
        this.ensureElementsPromise = this.ensureElementsPromise
            .then(() => {
                var selectorExecutor = new SelectorExecutor(selector, this.globalSelectorTimeout, this.ensureElementsStartTime,
                    createNotFoundError, createIsInvisibleError);

                return selectorExecutor.getResult();
            })
            .then(el => {
                if (!domUtils.isDomElement(el))
                    throw createHasWrongNodeTypeError(NODE_TYPE_DESCRIPTIONS[el.nodeType]);

                this.elements.push(el);
            });
    }

    getElements () {
        return this.ensureElementsPromise
            .then(() => this.elements);
    }
}

export function ensureElements (elementDescriptors) {
    var elementsRetriever = new ElementsRetriever(elementDescriptors);

    return elementsRetriever.getElements();
}

export function createElementDescriptor (selector) {
    return {
        selector:                    selector,
        createNotFoundError:         () => new ActionElementNotFoundError(),
        createIsInvisibleError:      () => new ActionElementIsInvisibleError(),
        createHasWrongNodeTypeError: nodeDescription => new ActionSelectorMatchesWrongNodeTypeError(nodeDescription)
    };
}

export function createAdditionalElementDescriptor (selector, elementName) {
    return {
        selector:                    selector,
        createNotFoundError:         () => new ActionAdditionalElementNotFoundError(elementName),
        createIsInvisibleError:      () => new ActionAdditionalElementIsInvisibleError(elementName),
        createHasWrongNodeTypeError: nodeDescription => new ActionAdditionalSelectorMatchesWrongNodeTypeError(elementName, nodeDescription)
    }
}
