const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const { getPool } = require('../database/init');
const { templateUpload } = require('../middleware/upload');

async function getDefaultClientId() {
  const db = getPool();
  const { rows } = await db.query(`SELECT id FROM clients WHERE is_default=TRUE ORDER BY id LIMIT 1`);
  return rows[0]?.id || (await db.query('SELECT id FROM clients ORDER BY id LIMIT 1')).rows[0]?.id;
}

function parseClientId(val) {
  if (!val || val === 'null' || val === 'undefined') return null;
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

// GET /api/templates?clientId=&category=&search=
router.get('/', async (req, res, next) => {
  try {
    const clientId = parseClientId(req.query.clientId) || await getDefaultClientId();
    let sql = 'SELECT * FROM templates WHERE client_id=$1';
    const params = [clientId];
    if (req.query.category) { sql += ` AND category=$${params.length + 1}`; params.push(req.query.category); }
    if (req.query.search)   { sql += ` AND (name ILIKE $${params.length + 1} OR description ILIKE $${params.length + 1})`; params.push(`%${req.query.search}%`); }
    sql += ' ORDER BY is_favorite DESC, updated_at DESC';
    const { rows } = await getPool().query(sql, params);
    res.json({ templates: rows });
  } catch (err) { next(err); }
});

// GET /api/templates/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await getPool().query('SELECT * FROM templates WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/templates – upload template image
router.post('/', templateUpload.single('file'), async (req, res, next) => {
  try {
    const clientId = parseClientId(req.body.clientId) || await getDefaultClientId();
    const { name, description, category, tags, source_type } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Template name required' });

    const filePath  = req.file ? `/uploads/templates/${req.file.filename}` : null;
    const parsedTags = tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : [];

    const { rows } = await getPool().query(
      `INSERT INTO templates (client_id, name, description, category, tags, file_path, thumbnail, source_type)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7) RETURNING *`,
      [clientId, name.trim(), description || '', category || 'general',
       JSON.stringify(parsedTags), filePath, source_type || 'uploaded']
    );
    res.status(201).json({ template: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/templates/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { name, description, category, tags, is_favorite } = req.body;
    const fields = [];
    const vals   = [];
    let i = 1;
    if (name !== undefined)        { fields.push(`name=$${i++}`);        vals.push(name); }
    if (description !== undefined) { fields.push(`description=$${i++}`); vals.push(description); }
    if (category !== undefined)    { fields.push(`category=$${i++}`);    vals.push(category); }
    if (tags !== undefined)        { fields.push(`tags=$${i++}`);        vals.push(JSON.stringify(tags)); }
    if (is_favorite !== undefined) { fields.push(`is_favorite=$${i++}`); vals.push(Boolean(is_favorite)); }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    fields.push(`updated_at=NOW()`);
    vals.push(req.params.id);
    const { rows } = await getPool().query(
      `UPDATE templates SET ${fields.join(',')} WHERE id=$${i} RETURNING *`, vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/templates/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await getPool().query('DELETE FROM templates WHERE id=$1 RETURNING *', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    // Clean up file
    if (rows[0].file_path) {
      const abs = path.join(__dirname, '..', 'public', rows[0].file_path.replace(/^\//, ''));
      fs.unlink(abs, () => {});
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/templates/save-from-generation – copy generated image as template
router.post('/save-from-generation', async (req, res, next) => {
  try {
    const { generationId, imageUrl, name, category, clientId: cid } = req.body;
    const clientId = parseClientId(cid) || await getDefaultClientId();
    if (!imageUrl || !name?.trim()) return res.status(400).json({ error: 'imageUrl and name required' });

    const { rows } = await getPool().query(
      `INSERT INTO templates (client_id, name, category, file_path, thumbnail, source_type, tags)
       VALUES ($1,$2,$3,$4,$4,'generated','[]') RETURNING *`,
      [clientId, name.trim(), category || 'generated', imageUrl]
    );

    // Tag the generation
    if (generationId) {
      await getPool().query(
        `UPDATE generations SET campaign_tags = campaign_tags || $1::jsonb WHERE id=$2`,
        [JSON.stringify([{ label: 'saved-template', templateId: rows[0].id }]), generationId]
      );
    }
    res.status(201).json({ template: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
