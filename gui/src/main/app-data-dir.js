const path = require('path');

const APP_NAME = 'MultiManager';

function canonicalUserData(app) {
  return path.join(app.getPath('appData'), APP_NAME);
}

module.exports = { canonicalUserData, APP_NAME };