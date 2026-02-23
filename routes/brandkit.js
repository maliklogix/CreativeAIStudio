const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const { getPool } = require('../database/init');
const { logoUpload } = require('../middleware/upload');

// GET /api/brand-kit?clientId=
router.get('/', async (req, res, next) => {
  try {
    const clientId = parseClientId(req.query.clientId) || await getDefaultClientId();
    const { rows } = await getPool().query(
      'SELECT * FROM brand_kits WHERE client_id=$1', [clientId]
    );
    res.json({ brandKit: rows[0] || null, clientId });
  } catch (err) { next(err); }
});

// PUT /api/brand-kit  – upsert
router.put('/', async (req, res, next) => {
  try {
    const clientId = parseClientId(req.body.clientId) || await getDefaultClientId();
    const {
      brand_name, brand_description,
      primary_color, secondary_color, accent_color,
      font_primary, font_secondary,
    } = req.body;

    const { rows } = await getPool().query(
      `INSERT INTO brand_kits
         (client_id, brand_name, brand_description, primary_color, secondary_color, accent_color, font_primary, font_secondary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id) DO UPDATE SET
         brand_name        = EXCLUDED.brand_name,
         brand_description = EXCLUDED.brand_description,
         primary_color     = EXCLUDED.primary_color,
         secondary_color   = EXCLUDED.secondary_color,
         accent_color      = EXCLUDED.accent_color,
         font_primary      = EXCLUDED.font_primary,
         font_secondary    = EXCLUDED.font_secondary,
         updated_at        = NOW()
       RETURNING *`,
      [clientId, brand_name, brand_description, primary_color || '#000000',
       secondary_color || '#ffffff', accent_color || '#ff6600',
       font_primary || 'Inter', font_secondary || 'Georgia']
    );
    res.json({ brandKit: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/brand-kit/logo – upload dark/light logos
router.post('/logo', logoUpload.fields([
  { name: 'logo_dark', maxCount: 1 },
  { name: 'logo_light', maxCount: 1 },
]), async (req, res, next) => {
  try {
    const clientId = parseClientId(req.body.clientId) || await getDefaultClientId();
    const db = getPool();

    // Ensure brand kit row exists
    await db.query(
      `INSERT INTO brand_kits (client_id) VALUES ($1) ON CONFLICT (client_id) DO NOTHING`,
      [clientId]
    );

    const updates = {};
    if (req.files?.logo_dark?.[0]) {
      updates.logo_dark_path = `/uploads/logos/${req.files.logo_dark[0].filename}`;
    }
    if (req.files?.logo_light?.[0]) {
      updates.logo_light_path = `/uploads/logos/${req.files.logo_light[0].filename}`;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No logo files provided' });
    }

    const sets = Object.keys(updates).map((k, i) => `${k}=$${i + 2}`).join(', ');
    const vals = [clientId, ...Object.values(updates)];
    const { rows } = await db.query(
      `UPDATE brand_kits SET ${sets}, updated_at=NOW() WHERE client_id=$1 RETURNING *`, vals
    );
    res.json({ brandKit: rows[0], paths: updates });
  } catch (err) { next(err); }
});

async function getDefaultClientId() {
  const { rows } = await getPool().query(
    `SELECT id FROM clients WHERE is_default=TRUE ORDER BY id LIMIT 1`
  );
  return rows[0]?.id || (await getPool().query('SELECT id FROM clients ORDER BY id LIMIT 1')).rows[0]?.id;
}

function parseClientId(val) {
  if (!val || val === 'null' || val === 'undefined') return null;
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

module.exports = router;
