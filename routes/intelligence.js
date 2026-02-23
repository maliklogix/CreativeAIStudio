const express = require('express');
const router  = express.Router();
const { getPool } = require('../database/init');
const { generateJSON } = require('../utils/llm');

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

// GET /api/intelligence?clientId=
router.get('/', async (req, res, next) => {
  try {
    const clientId = parseClientId(req.query.clientId) || await getDefaultClientId();
    const { rows } = await getPool().query(
      'SELECT * FROM brand_intelligence WHERE client_id=$1 ORDER BY created_at DESC', [clientId]
    );
    res.json({ profiles: rows });
  } catch (err) { next(err); }
});

// POST /api/intelligence/generate – AI-generate profiles
router.post('/generate', async (req, res, next) => {
  try {
    const { researchText, numProfiles = 3 } = req.body;
    const clientId = parseClientId(req.body.clientId) || await getDefaultClientId();

    const kit = (await getPool().query('SELECT * FROM brand_kits WHERE client_id=$1', [clientId])).rows[0];
    const brandContext = kit
      ? `Brand: ${kit.brand_name || 'Unknown'}. Description: ${kit.brand_description || 'N/A'}.`
      : 'No brand kit available.';

    const prompt = `
You are a strategic marketing expert. Generate ${numProfiles} distinct audience profiles for the following brand.

${brandContext}
${researchText ? `Additional research context:\n${researchText}` : ''}

For each profile return an object with these exact fields:
- persona: (string) Target audience description, e.g. "Health-conscious millennial moms"
- pain_point: (string) Core frustration or problem this audience faces
- angle: (string) Marketing angle that resonates with them
- visual_direction: (string) Visual style that appeals to them (colors, imagery, mood)
- emotion: (string) Primary emotion to evoke
- copy_hook: (string) Powerful opening line or hook for ads targeting them

Return a JSON array of ${numProfiles} profile objects.
    `.trim();

    const profiles = await generateJSON(prompt);
    const arr = Array.isArray(profiles) ? profiles : profiles.profiles || [];

    const db = getPool();
    const saved = [];
    for (const p of arr) {
      const { rows } = await db.query(
        `INSERT INTO brand_intelligence
           (client_id, persona, pain_point, angle, visual_direction, emotion, copy_hook, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ai') RETURNING *`,
        [clientId, p.persona || '', p.pain_point || '', p.angle || '',
         p.visual_direction || '', p.emotion || '', p.copy_hook || '']
      );
      saved.push(rows[0]);
    }
    res.status(201).json({ profiles: saved });
  } catch (err) { next(err); }
});

// POST /api/intelligence – manual add
router.post('/', async (req, res, next) => {
  try {
    const clientId = parseClientId(req.body.clientId) || await getDefaultClientId();
    const { persona, pain_point, angle, visual_direction, emotion, copy_hook } = req.body;
    if (!persona?.trim()) return res.status(400).json({ error: 'Persona is required' });
    const { rows } = await getPool().query(
      `INSERT INTO brand_intelligence
         (client_id, persona, pain_point, angle, visual_direction, emotion, copy_hook, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'manual') RETURNING *`,
      [clientId, persona.trim(), pain_point || '', angle || '',
       visual_direction || '', emotion || '', copy_hook || '']
    );
    res.status(201).json({ profile: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/intelligence/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const fields = ['persona','pain_point','angle','visual_direction','emotion','copy_hook'];
    const updates = [];
    const vals = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f}=$${i++}`); vals.push(req.body[f]); }
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    updates.push(`updated_at=NOW()`);
    vals.push(req.params.id);
    const { rows } = await getPool().query(
      `UPDATE brand_intelligence SET ${updates.join(',')} WHERE id=$${i} RETURNING *`, vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'Profile not found' });
    res.json({ profile: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/intelligence/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await getPool().query(
      'DELETE FROM brand_intelligence WHERE id=$1 RETURNING id', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Profile not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
