const express = require('express');
const cors = require('cors');
const routes = require('./routes');

const app = express();

// gzip-compress all API responses (big win for the full leads list over the wire).
// Defensive require so the server still boots if the module is not installed yet.
let compression; try { compression = require('compression'); } catch (e) { compression = null; }
if (compression) app.use(compression());

// Allow the Manager app (5174), Coordinator app (5173) and previews to call the API
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
// Raise the body limit so uploaded PDFs (stored as base64 in fileData) can be saved/synced
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

app.use('/api', routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

module.exports = app;
