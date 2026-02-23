require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDatabase } = require('./database/init');

const app = express();
const PORT = process.env.PORT || 8080;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/clients',     require('./routes/clients'));
app.use('/api/brand-kit',   require('./routes/brandkit'));
app.use('/api/templates',   require('./routes/templates'));
app.use('/api/assets',      require('./routes/assets'));
app.use('/api/generate',    require('./routes/generate'));
app.use('/api/prompt',      require('./routes/prompt'));
app.use('/api/campaign',    require('./routes/campaign'));
app.use('/api/intelligence',require('./routes/intelligence'));
app.use('/api/autoposter', require('./routes/autoposter'));
app.use('/api/settings',   require('./routes/settings'));

// ── Image download proxy (avoids CORS issues with external URLs) ─────────
app.get('/api/download-image', async (req, res, next) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).json({ error: 'url query param required' });
    const response = await fetch(imageUrl);
    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch image' });
    const contentType = response.headers.get('content-type') || 'image/png';
    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="generated-ad.${ext}"`);
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) { next(err); }
});

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
});

// ── UI ───────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Database init (runs once, cached for serverless) ─────────────────────────
let dbReady = false;
async function ensureDb() {
  if (dbReady) return;
  try {
    await initDatabase();
    dbReady = true;
    console.log('[DB]   Database ready');
  } catch (err) {
    console.error('[DB]   Database init failed:', err.message);
    throw err;
  }
}

// Initialize DB before every request (no-op after first call)
app.use(async (req, res, next) => {
  try { await ensureDb(); next(); }
  catch (err) { res.status(500).json({ error: 'Database not available' }); }
});

// ── Boot (local dev only) ────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  (async function start() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Static Ads Generator  |  Starting up…');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!process.env.FAL_KEY && !process.env.LEONARDO_API_KEY)
      console.warn('[WARN] No image generation key set in env — add FAL_KEY or LEONARDO_API_KEY, or use Settings UI');
    if (!process.env.GEMINI_API_KEY)
      console.warn('[WARN] GEMINI_API_KEY not set in env — add it in Settings UI or .env');

    await ensureDb();

    app.listen(PORT, () => {
      console.log(`[HTTP] Listening on http://localhost:${PORT}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    });
  })();
}

// ── Export for Vercel serverless ──────────────────────────────────────────────
module.exports = app;
