const express = require('express');
const router  = express.Router();
const { getPool }      = require('../database/init');
const { getSettings }  = require('../utils/config');
const falai            = require('../utils/falai');
const leonardo         = require('../utils/leonardo');

async function getDefaultClientId() {
  const db = getPool();
  const { rows } = await db.query(`SELECT id FROM clients WHERE is_default=TRUE ORDER BY id LIMIT 1`);
  return rows[0]?.id || (await db.query('SELECT id FROM clients ORDER BY id LIMIT 1')).rows[0]?.id;
}

async function getBrandKit(clientId) {
  const { rows } = await getPool().query('SELECT * FROM brand_kits WHERE client_id=$1', [clientId]);
  return rows[0] || null;
}

function applyBrandConstraints(prompt, brandKit) {
  if (!brandKit) return prompt;
  const parts = [prompt];
  if (brandKit.brand_name)        parts.push(`Brand: ${brandKit.brand_name}.`);
  if (brandKit.primary_color)     parts.push(`Primary color: ${brandKit.primary_color}.`);
  if (brandKit.secondary_color)   parts.push(`Secondary color: ${brandKit.secondary_color}.`);
  if (brandKit.accent_color)      parts.push(`Accent color: ${brandKit.accent_color}.`);
  if (brandKit.font_primary)      parts.push(`Typography: ${brandKit.font_primary}.`);
  if (brandKit.brand_description) parts.push(`Brand tone: ${brandKit.brand_description}.`);
  return parts.join(' ');
}

/**
 * Try FAL first, fall back to Leonardo.ai on failure.
 */
async function generateWithFallback(params, cfg) {
  // 1 — Try FAL.ai
  if (cfg.FAL_KEY) {
    try {
      console.log('[GEN] Trying FAL.ai…');
      const urls = await falai.generateImages({ ...params, apiKey: cfg.FAL_KEY });
      return { urls, provider: 'fal' };
    } catch (falErr) {
      console.warn(`[GEN] FAL.ai failed: ${falErr.message}. Trying Leonardo.ai…`);
    }
  } else {
    console.warn('[GEN] FAL_KEY not set — skipping FAL, trying Leonardo.ai…');
  }

  // 2 — Fall back to Leonardo.ai
  if (cfg.LEONARDO_API_KEY) {
    console.log('[GEN] Using Leonardo.ai…');
    // Leonardo doesn't support dual-image img2img — use product image as reference if available
    const leonardoRef = params.productImageUrl || params.referenceImageUrl || undefined;
    const urls = await leonardo.generateImages({
      prompt:   params.prompt,
      imageSize:params.imageSize,
      numImages:params.numImages,
      modelId:  cfg.LEONARDO_MODEL_ID,
      apiKey:   cfg.LEONARDO_API_KEY,
      referenceImageUrl: leonardoRef,
    });
    return { urls, provider: 'leonardo' };
  }

  throw new Error('No image generation API configured. Add FAL_KEY or LEONARDO_API_KEY in Settings.');
}

// ── POST /api/generate ────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  const db = getPool();
  let genId;
  try {
    const {
      prompt, reference_image, product_image,
      size = '1024x1024', aspect_ratio = '1:1',
      use_brand_kit = false, num_images = 1,
      concept, avatar,
    } = req.body;
    const clientId = req.body.clientId || await getDefaultClientId();

    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });

    const cfg = await getSettings();

    // Insert pending record
    const ins = await db.query(
      `INSERT INTO generations
         (client_id, prompt, concept, avatar, reference_image, product_image,
          size, aspect_ratio, use_brand_kit, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING id`,
      [clientId, prompt.trim(), concept || null, avatar || null,
       reference_image || null, product_image || null,
       size, aspect_ratio, Boolean(use_brand_kit)]
    );
    genId = ins.rows[0].id;

    let finalPrompt = prompt.trim();
    if (use_brand_kit) {
      const kit = await getBrandKit(clientId);
      finalPrompt = applyBrandConstraints(finalPrompt, kit);
    }

    // English-language enforcement: placed at START and END of prompt since
    // image models weight prompt boundaries most heavily. Also includes explicit
    // English example words so the model's text renderer targets English glyphs.
    const englishPrefix = 'English text only. All words, headlines, and labels in English language.';
    const englishSuffix = 'Text on image must be in English. Use English words like "Sale", "Shop Now", "Limited Offer", "Free Shipping", "Buy Now", "New Arrival", "Best Deal", "Save", "Discount". No French, no Spanish, no other languages.';

    if (reference_image) {
      finalPrompt = `${englishPrefix} Create an ad image that is nearly identical to the reference image. Keep the EXACT same layout, design template, color scheme, typography style, composition, and visual structure. Only vary the text content — change the headline, discount numbers, promotional quotes, or call-to-action text to create a subtle variation. Do NOT change the background, graphic elements, shapes, or overall design. ${finalPrompt} ${englishSuffix}`;
      if (product_image) {
        finalPrompt += ` Incorporate the product from the product image into the same layout and position as shown in the reference.`;
      }
    } else if (product_image) {
      finalPrompt = `${englishPrefix} Professional advertisement featuring the exact product shown in the product image. ${finalPrompt} ${englishSuffix}`;
    } else {
      finalPrompt = `${englishPrefix} ${finalPrompt} ${englishSuffix}`;
    }

    const { urls, provider } = await generateWithFallback({
      prompt: finalPrompt,
      imageSize: size,
      numImages: Math.min(parseInt(num_images) || 4, 10),
      productImageUrl:   product_image   || undefined,
      referenceImageUrl: reference_image || undefined,
    }, cfg);

    const images = urls.map((url, i) => ({ url, index: i, status: 'ok', provider }));

    await db.query(
      `UPDATE generations SET images=$1, status='completed', updated_at=NOW() WHERE id=$2`,
      [JSON.stringify(images), genId]
    );

    const { rows } = await db.query('SELECT * FROM generations WHERE id=$1', [genId]);
    res.json({ generation: rows[0], provider });
  } catch (err) {
    if (genId) {
      await db.query(
        `UPDATE generations SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
        [err.message, genId]
      ).catch(() => {});
    }
    next(err);
  }
});

// ── POST /api/generate/edit ───────────────────────────────────────────────
router.post('/edit', async (req, res, next) => {
  const db = getPool();
  let genId;
  try {
    const { parentId, editInstruction, num_images = 1 } = req.body;
    const clientId = req.body.clientId || await getDefaultClientId();

    if (!parentId) return res.status(400).json({ error: 'parentId is required' });
    if (!editInstruction?.trim()) return res.status(400).json({ error: 'editInstruction is required' });

    const parent = (await db.query('SELECT * FROM generations WHERE id=$1', [parentId])).rows[0];
    if (!parent) return res.status(404).json({ error: 'Parent generation not found' });

    const cfg = await getSettings();
    const newPrompt = `${parent.prompt} — Variation: ${editInstruction.trim()}`;

    const ins = await db.query(
      `INSERT INTO generations
         (client_id, prompt, reference_image, product_image, size, aspect_ratio,
          use_brand_kit, status, parent_id, edit_instruction)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9) RETURNING id`,
      [clientId, newPrompt, parent.reference_image, parent.product_image,
       parent.size, parent.aspect_ratio, parent.use_brand_kit, parentId, editInstruction.trim()]
    );
    genId = ins.rows[0].id;

    let finalPrompt = newPrompt;
    if (parent.use_brand_kit) {
      const kit = await getBrandKit(clientId);
      finalPrompt = applyBrandConstraints(finalPrompt, kit);
    }

    const srcImages = Array.isArray(parent.images) ? parent.images : [];
    // For edits: if the parent had a reference image, use it as the primary base
    // so variations stay faithful to the original reference design.
    // If no reference, use the previously-generated image as the base.
    const editReferenceUrl = parent.reference_image || srcImages[0]?.url || undefined;
    const editProductUrl   = parent.product_image || undefined;

    const englishPrefixEdit = 'English text only. All words, headlines, and labels in English language.';
    const englishSuffixEdit = 'Text on image must be in English. Use English words like "Sale", "Shop Now", "Limited Offer", "Free Shipping", "Buy Now", "New Arrival", "Best Deal", "Save", "Discount". No French, no Spanish, no other languages.';
    if (editReferenceUrl) {
      finalPrompt = `${englishPrefixEdit} Create an ad image that is nearly identical to the reference image. Keep the EXACT same layout, design template, color scheme, typography style, composition, and visual structure. Only vary the text content — change the headline, discount numbers, promotional quotes, or call-to-action text. ${finalPrompt} ${englishSuffixEdit}`;
    } else {
      finalPrompt = `${englishPrefixEdit} ${finalPrompt} ${englishSuffixEdit}`;
    }

    const { urls, provider } = await generateWithFallback({
      prompt: finalPrompt,
      imageSize: parent.size || '1024x1024',
      numImages: Math.min(parseInt(num_images) || 4, 10),
      productImageUrl:   editProductUrl,
      referenceImageUrl: editReferenceUrl,
    }, cfg);

    const images = urls.map((url, i) => ({ url, index: i, status: 'ok', provider }));
    await db.query(
      `UPDATE generations SET images=$1, status='completed', updated_at=NOW() WHERE id=$2`,
      [JSON.stringify(images), genId]
    );

    const { rows } = await db.query('SELECT * FROM generations WHERE id=$1', [genId]);
    res.json({ generation: rows[0], provider });
  } catch (err) {
    if (genId) {
      await db.query(
        `UPDATE generations SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
        [err.message, genId]
      ).catch(() => {});
    }
    next(err);
  }
});

// ── GET /api/generate/history ─────────────────────────────────────────────
router.get('/history', async (req, res, next) => {
  try {
    const clientId = req.query.clientId || await getDefaultClientId();
    const limit  = Math.min(parseInt(req.query.limit  || '20'), 100);
    const offset = parseInt(req.query.offset || '0');
    const { rows } = await getPool().query(
      `SELECT * FROM generations WHERE client_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [clientId, limit, offset]
    );
    const { rows: [{ count }] } = await getPool().query(
      'SELECT COUNT(*) FROM generations WHERE client_id=$1', [clientId]
    );
    res.json({ generations: rows, total: parseInt(count), limit, offset });
  } catch (err) { next(err); }
});

// ── DELETE /api/generate/:id ──────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await getPool().query(
      'DELETE FROM generations WHERE id=$1 RETURNING id', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Generation not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
