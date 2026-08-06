function activateMainWindow(win) {
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) {
    return false;
  }
  if (typeof win.isMinimized === 'function' && win.isMinimized()) {
    win.restore();
  }
  if (typeof win.show === 'function') win.show();
  if (typeof win.focus === 'function') win.focus();
  return true;
}

module.exports = { activateMainWindow };