const { logger } = require('../logger');

function randomDelay(min = 50, max = 150) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function humanType(cdp, text) {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (Math.random() < 0.03 && i < text.length - 1) {
      const wrongChar = String.fromCharCode(char.charCodeAt(0) + Math.floor(Math.random() * 3) - 1);
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: wrongChar,
      });
      await sleep(randomDelay());
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
        nativeVirtualKeyCode: 8,
      });
      await sleep(randomDelay());
    }

    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: char,
    });
    
    await sleep(randomDelay());
  }

  logger.debug(`Введен текст длиной ${text.length} символов`);
}

module.exports = { humanType, randomDelay };
