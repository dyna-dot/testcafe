'use strict';

exports.__esModule = true;

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

var _asyncToGenerator2 = require('babel-runtime/helpers/asyncToGenerator');

var _asyncToGenerator3 = _interopRequireDefault(_asyncToGenerator2);

var _tmp = require('tmp');

var _tmp2 = _interopRequireDefault(_tmp);

var _endpointUtils = require('endpoint-utils');

var _config = require('./config');

var _config2 = _interopRequireDefault(_config);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var commonTempProfile = null;

function getTempProfileDir(config) {
    _tmp2.default.setGracefulCleanup();

    var tempProfile = commonTempProfile;
    var shouldUseCommonProfile = !config.headless && !config.emulation;

    if (!shouldUseCommonProfile || !commonTempProfile) tempProfile = _tmp2.default.dirSync({ unsafeCleanup: true });

    if (shouldUseCommonProfile && !commonTempProfile) commonTempProfile = tempProfile;

    return tempProfile;
}

exports.default = function () {
    var _ref = (0, _asyncToGenerator3.default)( /*#__PURE__*/_regenerator2.default.mark(function _callee(configString) {
        var config, tempProfileDir, cdpPort;
        return _regenerator2.default.wrap(function _callee$(_context) {
            while (1) {
                switch (_context.prev = _context.next) {
                    case 0:
                        config = (0, _config2.default)(configString);
                        tempProfileDir = !config.userProfile ? getTempProfileDir(config) : null;

                        if (!(config.headless || config.emulation)) {
                            _context.next = 11;
                            break;
                        }

                        _context.t1 = config.cdpPort;

                        if (_context.t1) {
                            _context.next = 8;
                            break;
                        }

                        _context.next = 7;
                        return (0, _endpointUtils.getFreePort)();

                    case 7:
                        _context.t1 = _context.sent;

                    case 8:
                        _context.t0 = _context.t1;
                        _context.next = 12;
                        break;

                    case 11:
                        _context.t0 = null;

                    case 12:
                        cdpPort = _context.t0;
                        return _context.abrupt('return', { config: config, cdpPort: cdpPort, tempProfileDir: tempProfileDir });

                    case 14:
                    case 'end':
                        return _context.stop();
                }
            }
        }, _callee, this);
    }));

    return function (_x) {
        return _ref.apply(this, arguments);
    };
}();

module.exports = exports['default'];