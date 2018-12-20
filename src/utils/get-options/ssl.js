import os from 'os';
import baseGetOptions from './base';
import { fsObjectExists, readFile } from '../promisified-functions';


const MAX_PATH_LENGTH = {
    'Linux':      4096,
    'Windows_NT': 260,
    'Darwin':     1024
};

const OS_MAX_PATH_LENGTH = MAX_PATH_LENGTH[os.type()];

const OPTIONS_SEPARATOR          = ';';
const FILE_OPTION_NAMES          = ['cert', 'key', 'pfx'];


export default function (optionString) {
    return baseGetOptions(optionString, {
        optionsSeparator: OPTIONS_SEPARATOR,

        async onOptionParsed (key, value) {
            const isFileOption = FILE_OPTION_NAMES.includes(key) && value.length < OS_MAX_PATH_LENGTH;

            if (isFileOption && await fsObjectExists(value))
                value = await readFile(value);

            return value;
        }
    });
}

