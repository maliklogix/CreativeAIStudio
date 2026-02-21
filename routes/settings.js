const express = require('express');
const router  = express.Router();
const { getPool } = require('../database/init');
const { invalidateCache, SETTING_KEYS } = require('../utils/config');

// Mask sensitive values for display
function maskKey(val) {
  if (!val || val.length < 8) return val ? '••••••••' : '';
  return val.slice(0, 4) + '••••••••' + val.slice(-4);
}

// GET /api/settings — return masked key statuses
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await getPool().query('SELECT key, value FROM app_settings');
    const db = {};
    for (const r of rows) db[r.key] = r.value;

    const status = {};
    for (const [envKey, dbKey] of Object.entries(SETTING_KEYS)) {
      const val = db[dbKey] || process.env[envKey] || '';
      status[dbKey] = {
        set:    Boolean(val),
        source: db[dbKey] ? 'database' : (process.env[envKey] ? 'env' : 'not set'),
        masked: maskKey(val),
      };
    }
    res.json({ settings: status });
  } catch (err) { next(err); }
});

// PUT /api/settings — save one or more keys
router.put('/', async (req, res, next) => {
  try {
    const db = getPool();
    const allowed = Object.values(SETTING_KEYS);
    const saved = [];

    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.includes(key)) continue;
      if (value === '' || value === null) {
        // Delete to fall back to env
        await db.query('DELETE FROM app_settings WHERE key=$1', [key]);
      } else {
        await db.query(
          `INSERT INTO app_settings (key, value) VALUES ($1,$2)
           ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
          [key, value.toString().trim()]
        );
      }
      saved.push(key);
    }

    invalidateCache();
    res.json({ ok: true, saved });
  } catch (err) { next(err); }
});

// DELETE /api/settings/:key — remove one key (revert to env)
router.delete('/:key', async (req, res, next) => {
  try {
    await getPool().query('DELETE FROM app_settings WHERE key=$1', [req.params.key]);
    invalidateCache();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
