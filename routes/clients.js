const express = require('express');
const router  = express.Router();
const { getPool } = require('../database/init');

// GET /api/clients
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await getPool().query(
      'SELECT * FROM clients ORDER BY is_default DESC, name ASC'
    );
    res.json({ clients: rows });
  } catch (err) { next(err); }
});

// GET /api/clients/default
router.get('/default', async (req, res, next) => {
  try {
    const { rows } = await getPool().query(
      `SELECT * FROM clients WHERE is_default = TRUE ORDER BY id LIMIT 1`
    );
    const client = rows[0] || (await getPool().query('SELECT * FROM clients ORDER BY id LIMIT 1')).rows[0];
    if (!client) return res.status(404).json({ error: 'No clients found' });
    res.json({ client });
  } catch (err) { next(err); }
});

// POST /api/clients  { name }
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Client name is required' });
    const { rows } = await getPool().query(
      `INSERT INTO clients (name) VALUES ($1) RETURNING *`, [name.trim()]
    );
    res.status(201).json({ client: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Client name already exists' });
    next(err);
  }
});

// PATCH /api/clients/:id  { name }
router.patch('/:id', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { rows } = await getPool().query(
      `UPDATE clients SET name=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [name.trim(), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Client not found' });
    res.json({ client: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/clients/:id/set-default
router.post('/:id/set-default', async (req, res, next) => {
  try {
    const db = getPool();
    await db.query('UPDATE clients SET is_default=FALSE');
    const { rows } = await db.query(
      `UPDATE clients SET is_default=TRUE WHERE id=$1 RETURNING *`, [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Client not found' });
    res.json({ client: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/clients/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getPool();
    const { rows } = await db.query('SELECT * FROM clients WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Client not found' });

    const { rowCount: total } = await db.query('SELECT 1 FROM clients');
    if (total <= 1) return res.status(400).json({ error: 'Cannot delete the last client' });

    if (rows[0].is_default) {
      // Promote another client to default first
      await db.query(
        `UPDATE clients SET is_default=TRUE WHERE id != $1 ORDER BY id LIMIT 1`, [req.params.id]
      );
    }
    await db.query('DELETE FROM clients WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
