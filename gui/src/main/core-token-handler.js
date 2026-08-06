function createTokenHandler() {
  let coreToken = '';
  let tokenWaiters = [];
  let tokenListeners = [];
  let logger = () => {};

  function waitForToken(timeout = 15000) {
    if (coreToken) return Promise.resolve(coreToken);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        tokenWaiters = tokenWaiters.filter((w) => w !== onToken);
        reject(new Error('Timeout waiting for core token'));
      }, timeout);
      function onToken() {
        clearTimeout(timer);
        resolve(coreToken);
      }
      tokenWaiters.push(onToken);
    });
  }

  function onTokenReceived(token) {
    if (typeof token !== 'string' || token.length === 0) return false;
    const wasSet = coreToken !== '';
    coreToken = token;
    logger('INFO', wasSet ? 'Core token rotated (runtime)' : 'Core token received (startup)');
    const waiters = tokenWaiters;
    tokenWaiters = [];
    waiters.forEach((w) => w());
    const listeners = tokenListeners;
    listeners.forEach((l) => l(coreToken));
    return true;
  }

  function getCoreToken() {
    return coreToken;
  }

  function onTokenChange(listener) {
    if (typeof listener === 'function') tokenListeners.push(listener);
    return () => {
      tokenListeners = tokenListeners.filter((l) => l !== listener);
    };
  }

  function reset() {
    coreToken = '';
    tokenWaiters = [];
    tokenListeners = [];
  }

  function setLogger(fn) {
    if (typeof fn === 'function') logger = fn;
  }

  return { waitForToken, onTokenReceived, getCoreToken, onTokenChange, reset, setLogger };
}

module.exports = { createTokenHandler };