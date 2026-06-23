const express = require('express');
const { authMiddleware } = require('../api/auth');

const app = express();

app.use(express.json());
app.use(authMiddleware);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = { app };
