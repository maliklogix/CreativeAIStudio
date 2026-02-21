const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const { getPool } = require('../database/init');
const { assetUpload } = require('../middleware/upload');

const CATEGORIES = ['product_image', 'packaging', 'lifestyle', 'logo', 'other'];

async function getDefaultClientId() {
  const db = getPool();
  const { rows } = await db.query(`SELECT id FROM clients WHERE is_default=TRUE ORDER BY id LIMIT 1`);
  return rows[0]?.id || (await db.query('SELECT id FROM clients ORDER BY id LIMIT 1')).rows[0]?.id;
}

// GET /api/assets?clientId=&category=&search=
router.get('/', async (req, res, next) => {
  try {
    const clientId = req.query.clientId || await getDefaultClientId();
    let sql = 'SELECT * FROM assets WHERE client_id=$1';
    const params = [clientId];
    if (req.query.category) { sql += ` AND category=$${params.length + 1}`; params.push(req.query.category); }
    if (req.query.search) {
      sql += ` AND (original_name ILIKE $${params.length + 1} OR category ILIKE $${params.length + 1})`;
      params.push(`%${req.query.search}%`);
    }
    sql += ' ORDER BY created_at DESC';
    const { rows } = await getPool().query(sql, params);
    res.json({ assets: rows });
  } catch (err) { next(err); }
});

// POST /api/assets – multi-file upload
router.post('/', assetUpload.array('files', 20), async (req, res, next) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
    const clientId = req.body.clientId || await getDefaultClientId();
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'other';
    const db = getPool();
    const inserted = [];

    for (const file of req.files) {
      const { rows } = await db.query(
        `INSERT INTO assets (client_id, filename, original_name, file_type, file_size, category, file_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [clientId, file.filename, file.originalname, file.mimetype,
         file.size, category, `/uploads/assets/${file.filename}`]
      );
      inserted.push(rows[0]);
    }
    res.status(201).json({ assets: inserted, categories: CATEGORIES });
  } catch (err) { next(err); }
});

// PATCH /api/assets/:id – update category / name
router.patch('/:id', async (req, res, next) => {
  try {
    const { category, original_name } = req.body;
    const fields = [];
    const vals = [];
    let i = 1;
    if (category !== undefined && CATEGORIES.includes(category)) { fields.push(`category=$${i++}`); vals.push(category); }
    if (original_name !== undefined) { fields.push(`original_name=$${i++}`); vals.push(original_name); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    fields.push(`updated_at=NOW()`);
    vals.push(req.params.id);
    const { rows } = await getPool().query(
      `UPDATE assets SET ${fields.join(',')} WHERE id=$${i} RETURNING *`, vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'Asset not found' });
    res.json({ asset: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/assets/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await getPool().query('DELETE FROM assets WHERE id=$1 RETURNING *', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Asset not found' });
    const abs = path.join(__dirname, '..', 'public', rows[0].file_path.replace(/^\//, ''));
    fs.unlink(abs, () => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/assets/categories
router.get('/categories', (req, res) => res.json({ categories: CATEGORIES }));

module.exports = router;
