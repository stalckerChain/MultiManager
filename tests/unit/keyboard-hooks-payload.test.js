import { describe, it, expect } from 'vitest';

const {
  vkToKey,
  vkToCode,
  buildKeyEvent,
  shouldSendCharInput,
  hasControlChars,
} = require('../../gui/src/main/keyboard-hooks-payload.js');

describe('keyboard-hooks-payload: buildKeyEvent', () => {
  it('строит keyDown payload с sourcePid и text', () => {
    const evt = buildKeyEvent({
      vkCode: 0x41,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      text: 'A',
      sourcePid: 1234,
      isDown: true,
      isUp: false,
    });
    expect(evt).toEqual({
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 0x41,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      text: 'A',
      sourcePid: 1234,
    });
  });

  it('строит keyUp payload с sourcePid', () => {
    const evt = buildKeyEvent({ vkCode: 0x0D, isDown: false, isUp: true, sourcePid: 4321 });
    expect(evt.type).toBe('keyUp');
    expect(evt.key).toBe('Enter');
    expect(evt.sourcePid).toBe(4321);
  });

  it('keyDown сохраняет пустой text как пустую строку', () => {
    const evt = buildKeyEvent({ vkCode: 0x0D, isDown: true, isUp: false });
    expect(evt.text).toBe('');
  });

  it('маппит спецклавиши', () => {
    expect(vkToKey(0x1B)).toBe('Escape');
    expect(vkToCode(0x0D)).toBe('Enter');
    expect(vkToKey(0xFF)).toBe('VK_255');
  });
});

describe('keyboard-hooks-payload: shouldSendCharInput', () => {
  it('отправляет текст для обычной печатной клавиши', () => {
    expect(shouldSendCharInput({ text: 'a', ctrlKey: false, altKey: false, metaKey: false, altGr: false })).toBe(true);
  });

  it('учитывает Shift/раскладку — текст приходит уже вычисленным', () => {
    expect(shouldSendCharInput({ text: 'A', ctrlKey: false, altKey: false, metaKey: false, altGr: false })).toBe(true);
    expect(shouldSendCharInput({ text: 'ф', ctrlKey: false, altKey: false, metaKey: false, altGr: false })).toBe(true);
  });

  it('не отправляет текст для Ctrl (browser shortcut), в т.ч. Ctrl+1/Ctrl+W/Ctrl+T', () => {
    expect(shouldSendCharInput({ text: '1', ctrlKey: true, altKey: false, metaKey: false, altGr: false })).toBe(false);
    expect(shouldSendCharInput({ text: 'w', ctrlKey: true, altKey: false, metaKey: false, altGr: false })).toBe(false);
    expect(shouldSendCharInput({ text: 't', ctrlKey: true, altKey: false, metaKey: false, altGr: false })).toBe(false);
  });

  it('не отправляет текст для Meta', () => {
    expect(shouldSendCharInput({ text: 'a', ctrlKey: false, altKey: false, metaKey: true, altGr: false })).toBe(false);
  });

  it('не отправляет текст для обычного Alt', () => {
    expect(shouldSendCharInput({ text: 'a', ctrlKey: false, altKey: true, metaKey: false, altGr: false })).toBe(false);
  });

  it('отправляет AltGr-символ по результату layout-aware ToUnicodeEx', () => {
    expect(shouldSendCharInput({ text: '@', ctrlKey: true, altKey: true, metaKey: false, altGr: true })).toBe(true);
  });

  it('не отправляет текст при пустом text (dead key / непечатная клавиша)', () => {
    expect(shouldSendCharInput({ text: '', ctrlKey: false, altKey: false, metaKey: false, altGr: false })).toBe(false);
    expect(shouldSendCharInput({ text: undefined, ctrlKey: false, altKey: false, metaKey: false })).toBe(false);
  });

  it('не отправляет управляющие символы ToUnicodeEx (Backspace/Tab/Enter/Delete)', () => {
    expect(shouldSendCharInput({ text: '\b', ctrlKey: false, altKey: false, metaKey: false, altGr: false })).toBe(false);
    expect(shouldSendCharInput({ text: '\t', ctrlKey: false, altKey: false, metaKey: false, altGr: false })).toBe(false);
    expect(shouldSendCharInput({ text: '\r', ctrlKey: false, altKey: false, metaKey: false, altGr: false })).toBe(false);
    expect(shouldSendCharInput({ text: '\x7f', ctrlKey: false, altKey: false, metaKey: false, altGr: false })).toBe(false);
  });

  it('hasControlChars распознаёт только управляющие символы', () => {
    expect(hasControlChars('\b')).toBe(true);
    expect(hasControlChars('a')).toBe(false);
    expect(hasControlChars('ф')).toBe(false);
  });

  it('не падает на null', () => {
    expect(shouldSendCharInput(null)).toBe(false);
  });
});
