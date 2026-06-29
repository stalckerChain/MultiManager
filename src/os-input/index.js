const { WindowsHooks, windowsHooks } = require('./windows-hooks');
const { InputCapture, inputCapture } = require('./input-capture');
const { WindowTracker, windowTracker } = require('./window-tracker');
const { NativeKeyboardHooks, nativeKeyboardHooks } = require('./native-hooks');

module.exports = {
  WindowsHooks, windowsHooks,
  InputCapture, inputCapture,
  WindowTracker, windowTracker,
  NativeKeyboardHooks, nativeKeyboardHooks,
};
