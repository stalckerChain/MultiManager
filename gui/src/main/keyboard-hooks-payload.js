// Чистое преобразование native-событий клавиатуры в payload для backend.
// Отдельный модуль без зависимостей от electron/network, чтобы логику можно
// было покрыть unit-тестами (тот же модуль использует gui/src/main/keyboard-hooks.js).

const VK_KEY_MAP = {
  0x08: 'Backspace', 0x09: 'Tab', 0x0D: 'Enter', 0x10: 'Shift',
  0x11: 'Control', 0x12: 'Alt', 0x13: 'Pause', 0x14: 'CapsLock',
  0x1B: 'Escape', 0x20: ' ', 0x21: 'PageUp', 0x22: 'PageDown',
  0x23: 'End', 0x24: 'Home', 0x25: 'ArrowLeft', 0x26: 'ArrowUp',
  0x27: 'ArrowRight', 0x28: 'ArrowDown', 0x2C: 'PrintScreen',
  0x2D: 'Insert', 0x2E: 'Delete', 0x5B: 'Meta', 0x5C: 'Meta',
  0x60: '0', 0x61: '1', 0x62: '2', 0x63: '3', 0x64: '4',
  0x65: '5', 0x66: '6', 0x67: '7', 0x68: '8', 0x69: '9',
  0x70: 'F1', 0x71: 'F2', 0x72: 'F3', 0x73: 'F4',
  0x74: 'F5', 0x75: 'F6', 0x76: 'F7', 0x77: 'F8',
  0x78: 'F9', 0x79: 'F10', 0x7A: 'F11', 0x7B: 'F12',
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

function buildKeyEvent(raw) {
  return {
    type: raw.isDown ? 'keyDown' : 'keyUp',
    key: vkToKey(raw.vkCode),
    code: vkToCode(raw.vkCode),
    windowsVirtualKeyCode: raw.vkCode,
    ctrlKey: !!raw.ctrlKey,
    shiftKey: !!raw.shiftKey,
    altKey: !!raw.altKey,
    metaKey: !!raw.metaKey,
    text: typeof raw.text === 'string' ? raw.text : '',
    sourcePid: raw.sourcePid,
  };
}

// Управляющие символы (C0 и DEL) текстом не являются: ToUnicodeEx для
// Backspace/Tab/Enter/Delete может вернуть \b, \t, \r, \x7f — это клавиши,
// а не печатный символ, вставлять их в input нельзя (в slave появится
// «квадратик» вместо стирания/перевода строки).
function hasControlChars(text) {
  return Array.from(text).some((ch) => {
    const code = ch.codePointAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

/**
 * Решает, является ли нативное событие обычным текстовым вводом, который надо
 * отправить в backend как `charInput`.
 *
 * - `text` берётся из native addon (ToUnicodeEx) с учётом раскладки, Shift,
 *   CapsLock и AltGr — простое ASCII-преобразование vk не используется.
 * - Meta и Ctrl (без AltGr) — browser/командные сочетания, текстом не считаются.
 * - AltGr (правый Alt) — символы европейских раскладок формируются по результату
 *   ToUnicodeEx, т.е. только если layout действительно дал символ.
 * - Пустой text (dead key, меню, непечатная клавиша) — charInput не отправляется.
 * - Управляющие символы (\b, \t, \r, \x7f и прочие C0/DEL) — не текст, а клавиши.
 */
function shouldSendCharInput(event) {
  if (!event) return false;
  if (typeof event.text !== 'string' || event.text.length === 0) return false;
  if (hasControlChars(event.text)) return false;
  if (event.metaKey) return false;
  if (event.ctrlKey && !event.altGr) return false;
  if (event.altKey && !event.altGr) return false;
  return true;
}

module.exports = { vkToKey, vkToCode, buildKeyEvent, shouldSendCharInput, hasControlChars };
