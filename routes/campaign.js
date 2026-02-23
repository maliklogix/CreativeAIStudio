const express = require('express');
const router  = express.Router();
const { getPool } = require('../database/init');
const { generateText }  = require('../utils/llm');
const { getSettings }   = require('../utils/config');
const falai             = require('../utils/falai');
const leonardo          = require('../utils/leonardo');

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

async function getBrandKit(clientId) {
  const { rows } = await getPool().query('SELECT * FROM brand_kits WHERE client_id=$1', [clientId]);
  return rows[0] || null;
}

function buildFallbackPrompt(item, brandKit) {
  const parts = [];
  if (brandKit?.brand_name) parts.push(`${brandKit.brand_name} ad.`);
  if (item.persona)    parts.push(`Audience: ${item.persona}.`);
  if (item.angle)      parts.push(`Angle: ${item.angle}.`);
  if (item.campaignGoal) parts.push(`Goal: ${item.campaignGoal}.`);
  if (brandKit?.primary_color) parts.push(`Primary color: ${brandKit.primary_color}.`);
  parts.push('High-quality static social media advertisement, clean design, professional.');
  return parts.join(' ');
}

// POST /api/campaign/plan – build generation matrix from profiles
router.post('/plan', async (req, res, next) => {
  try {
    const clientId = parseClientId(req.body.clientId) || await getDefaultClientId();
    const {
      profileIds = [],
      campaignGoal = '',
      referenceImageUrl = '',
      productImageUrl = '',
      adsPerProfile = 1,
      size = '1024x1024',
    } = req.body;

    if (!profileIds.length) return res.status(400).json({ error: 'Select at least one intelligence profile' });

    const db = getPool();
    const { rows: profiles } = await db.query(
      `SELECT * FROM brand_intelligence WHERE id = ANY($1::int[])`, [profileIds]
    );

    const matrix = [];
    for (const profile of profiles) {
      for (let i = 0; i < Math.min(adsPerProfile, 4); i++) {
        matrix.push({
          profileId:       profile.id,
          persona:         profile.persona,
          angle:           profile.angle,
          visual_direction:profile.visual_direction,
          emotion:         profile.emotion,
          copy_hook:       profile.copy_hook,
          campaignGoal,
          referenceImageUrl,
          productImageUrl,
          size,
          variantIndex:    i + 1,
          status:          'planned',
        });
      }
    }

    res.json({
      plan: matrix,
      totalAds: matrix.length,
      profiles: profiles.length,
    });
  } catch (err) { next(err); }
});

// POST /api/campaign/generate – execute the plan
router.post('/generate', async (req, res, next) => {
  try {
    const clientId = parseClientId(req.body.clientId) || await getDefaultClientId();
    const { plan = [], size = '1024x1024' } = req.body;

    if (!plan.length) return res.status(400).json({ error: 'Plan is empty' });

    const db = getPool();
    const brandKit = await getBrandKit(clientId);
    const results = [];

    for (const item of plan) {
      let genId = null;
      try {
        // Compose prompt via Gemini
        let prompt;
        const kitContext = brandKit
          ? `Brand: ${brandKit.brand_name}. Colors: ${brandKit.primary_color}, ${brandKit.accent_color}. Tone: ${brandKit.brand_description || 'professional'}.`
          : '';

        const geminiPrompt = `
Write a single precise image generation prompt for a static ad.
${kitContext}
Target persona: ${item.persona}.
Marketing angle: ${item.angle}.
Visual direction: ${item.visual_direction || ''}.
Emotion: ${item.emotion || ''}.
Copy hook: "${item.copy_hook || ''}".
Campaign goal: ${item.campaignGoal || ''}.
Output ONLY the image generation prompt. No markdown, no explanation. Max 150 words.
        `.trim();

        try {
          prompt = await generateText(geminiPrompt);
        } catch (_) {
          prompt = buildFallbackPrompt(item, brandKit);
        }

        const ins = await db.query(
          `INSERT INTO generations
             (client_id, prompt, concept, avatar, reference_image, product_image,
              size, aspect_ratio, use_brand_kit, status, campaign_tags)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'1:1',TRUE,'pending',$8) RETURNING id`,
          [clientId, prompt,
           `Profile: ${item.persona}`, `Variant ${item.variantIndex}`,
           item.referenceImageUrl || null, item.productImageUrl || null,
           item.size || size,
           JSON.stringify([{ persona: item.persona, angle: item.angle }])]
        );
        genId = ins.rows[0].id;

        const cfg = await getSettings();
        const refUrl = item.referenceImageUrl || item.productImageUrl || undefined;
        let imageUrls, provider;

        if (cfg.FAL_KEY) {
          try {
            imageUrls = await falai.generateImages({ prompt, imageSize: item.size || size, numImages: 1, referenceImageUrl: refUrl, apiKey: cfg.FAL_KEY });
            provider = 'fal';
          } catch (falErr) {
            console.warn(`[CAMPAIGN] FAL failed: ${falErr.message}, trying Leonardo…`);
            if (!cfg.LEONARDO_API_KEY) throw falErr;
            imageUrls = await leonardo.generateImages({ prompt, imageSize: item.size || size, numImages: 1, modelId: cfg.LEONARDO_MODEL_ID, apiKey: cfg.LEONARDO_API_KEY });
            provider = 'leonardo';
          }
        } else if (cfg.LEONARDO_API_KEY) {
          imageUrls = await leonardo.generateImages({ prompt, imageSize: item.size || size, numImages: 1, modelId: cfg.LEONARDO_MODEL_ID, apiKey: cfg.LEONARDO_API_KEY });
          provider = 'leonardo';
        } else {
          throw new Error('No image generation API configured. Add FAL_KEY or LEONARDO_API_KEY in Settings.');
        }

        const images = imageUrls.map((url, i) => ({ url, index: i, status: 'ok', provider }));
        await db.query(
          `UPDATE generations SET images=$1, status='completed', updated_at=NOW() WHERE id=$2`,
          [JSON.stringify(images), genId]
        );

        const { rows } = await db.query('SELECT * FROM generations WHERE id=$1', [genId]);
        results.push({ status: 'success', generation: rows[0], persona: item.persona });
      } catch (err) {
        console.error(`[CAMPAIGN] Item failed: ${err.message}`);
        if (genId) {
          await db.query(
            `UPDATE generations SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
            [err.message, genId]
          ).catch(() => {});
          const { rows } = await db.query('SELECT * FROM generations WHERE id=$1', [genId]);
          results.push({ status: 'failed', error: err.message, generation: rows[0] || null, persona: item.persona });
        } else {
          results.push({ status: 'failed', error: err.message, generation: null, persona: item.persona });
        }
      }
    }

    const succeeded = results.filter(r => r.status === 'success').length;
    const failed    = results.filter(r => r.status === 'failed').length;

    res.json({ results, summary: { total: plan.length, succeeded, failed } });
  } catch (err) { next(err); }
});

module.exports = router;
