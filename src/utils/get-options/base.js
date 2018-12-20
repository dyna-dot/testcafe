import Promise from 'pinkie';
import convertToBestFitType from '../convert-to-best-fit-type';


const DEFAULT_OPTIONS_SEPARATOR   = ',';
const DEFAULT_KEY_VALUE_SEPARATOR = '=';

const DEFAULT_ON_OPTION_PARSED = (key, value) => value;

function parseOptionsString (optionsStr, optionsSeparator, keyValueSeparator) {
    const splittedOptions = optionsStr.split(optionsSeparator);

    if (!splittedOptions.length)
        return null;

    const parsedOptions = {};

    splittedOptions.forEach(item => {
        const keyValuePair = item.split(keyValueSeparator);
        const key          = keyValuePair[0];
        let value          = keyValuePair[1];

        if (!value && keyValuePair.length === 1)
            value = true;

        parsedOptions[key] = value;
    });

    return parsedOptions;
}

export default async function (options = '', optionsConfig) {
    const {
        optionsSeparator = DEFAULT_OPTIONS_SEPARATOR,
        keyValueSeparator = DEFAULT_KEY_VALUE_SEPARATOR,
        onOptionParsed = DEFAULT_ON_OPTION_PARSED
    } = optionsConfig;

    if (typeof options === 'string')
        options = parseOptionsString(options, optionsSeparator, keyValueSeparator);

    await Promise.all(Object.entries(options).map(async ([key, value]) => {
        value = convertToBestFitType(value);

        options[key] = await onOptionParsed(key, value);
    }));

    return options;
}

