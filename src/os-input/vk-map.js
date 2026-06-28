const VK_KEY_MAP = {
  0x08: 'Backspace', 0x09: 'Tab', 0x0D: 'Enter', 0x10: 'Shift',
  0x11: 'Control', 0x12: 'Alt', 0x13: 'Pause', 0x14: 'CapsLock',
  0x1B: 'Escape', 0x20: ' ', 0x21: 'PageUp', 0x22: 'PageDown',
  0x23: 'End', 0x24: 'Home', 0x25: 'ArrowLeft', 0x26: 'ArrowUp',
  0x27: 'ArrowRight', 0x28: 'ArrowDown', 0x2C: 'PrintScreen',
  0x2D: 'Insert', 0x2E: 'Delete', 0x5B: 'Meta', 0x5C: 'Meta',
  0x60: '0', 0x61: '1', 0x62: '2', 0x63: '3', 0x64: '4',
  0x65: '5', 0x66: '6', 0x67: '7', 0x68: '8', 0x69: '9',
  0x6A: '*', 0x6B: '+', 0x6C: ',', 0x6D: '-', 0x6E: '.', 0x6F: '/',
  0x70: 'F1', 0x71: 'F2', 0x72: 'F3', 0x73: 'F4',
  0x74: 'F5', 0x75: 'F6', 0x76: 'F7', 0x77: 'F8',
  0x78: 'F9', 0x79: 'F10', 0x7A: 'F11', 0x7B: 'F12',
  0x90: 'NumLock', 0x91: 'ScrollLock',
};

const VK_CODE_MAP = {
  0x08: 'Backspace', 0x09: 'Tab', 0x0D: 'Enter', 0x10: 'ShiftLeft',
  0x11: 'ControlLeft', 0x12: 'AltLeft', 0x1B: 'Escape', 0x20: 'Space',
  0x25: 'ArrowLeft', 0x26: 'ArrowUp', 0x27: 'ArrowRight', 0x28: 'ArrowDown',
};

function vkToKey(vkCode) {
  if (vkCode >= 0x30 && vkCode <= 0x5A) return String.fromCharCode(vkCode).toLowerCase();
  return VK_KEY_MAP[vkCode] || 'VK_' + vkCode;
}

function vkToCode(vkCode) {
  if (vkCode >= 0x30 && vkCode <= 0x39) return 'Digit' + String.fromCharCode(vkCode);
  if (vkCode >= 0x41 && vkCode <= 0x5A) return 'Key' + String.fromCharCode(vkCode);
  return VK_CODE_MAP[vkCode] || 'Key' + vkCode;
}

module.exports = { vkToKey, vkToCode };
