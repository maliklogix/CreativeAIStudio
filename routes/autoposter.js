const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { getPool }         = require('../database/init');
const { getSettings }     = require('../utils/config');
const { generateJSON }    = require('../utils/llm');
const { autoposterUpload } = require('../middleware/upload');
const falai               = require('../utils/falai');

// Platform dimensions
const PLATFORM_DIMS = {
  instagram:  { w: 1080, h: 1080 },
  facebook:   { w: 1200, h: 630  },
  linkedin:   { w: 1200, h: 627  },
  pinterest:  { w: 1000, h: 1500 },
  youtube:    { w: 1080, h: 1920 },
  tiktok:     { w: 1080, h: 1920 },
};

const VIDEO_PLATFORMS = ['instagram', 'tiktok', 'youtube'];
const IMAGE_PLATFORMS = ['linkedin', 'facebook', 'pinterest'];

function parseClientId(val) {
  if (!val || val === 'null' || val === 'undefined') return null;
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

async function getDefaultClientId() {
  const db = getPool();
  const { rows } = await db.query(`SELECT id FROM clients WHERE is_default=TRUE ORDER BY id LIMIT 1`);
  return rows[0]?.id || (await db.query('SELECT id FROM clients ORDER BY id LIMIT 1')).rows[0]?.id;
}

async function getBrandKit(clientId) {
  const { rows } = await getPool().query('SELECT * FROM brand_kits WHERE client_id=$1', [clientId]);
  return rows[0] || null;
}

// ── Connections ──────────────────────────────────────────────────────────────

// GET /api/autoposter/connections
router.get('/connections', async (req, res, next) => {
  try {
    const clientId = parseClientId(req.query.clientId) || await getDefaultClientId();
    const { rows } = await getPool().query(
      'SELECT id, client_id, platform, platform_user_id, platform_username, status, created_at, updated_at FROM social_connections WHERE client_id=$1 ORDER BY platform',
      [clientId]
    );
    res.json({ connections: rows });
  } catch (err) { next(err); }
});

// POST /api/autoposter/connections
router.post('/connections', async (req, res, next) => {
  try {
    const clientId = parseClientId(req.body.clientId) || await getDefaultClientId();
    const { platform, access_token, refresh_token, platform_user_id, platform_username } = req.body;
    if (!platform) return res.status(400).json({ error: 'platform is required' });

    const { rows } = await getPool().query(
      `INSERT INTO social_connections (client_id, platform, access_token, refresh_token, platform_user_id, platform_username, status)
       VALUES ($1,$2,$3,$4,$5,$6,'connected')
       ON CONFLICT (client_id, platform) DO UPDATE SET
         access_token=$3, refresh_token=$4, platform_user_id=$5, platform_username=$6,
         status='connected', updated_at=NOW()
       RETURNING *`,
      [clientId, platform, access_token || null, refresh_token || null, platform_user_id || null, platform_username || null]
    );
    res.json({ connection: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/autoposter/connections/:platform
router.delete('/connections/:platform', async (req, res, next) => {
  try {
    const clientId = parseClientId(req.query.clientId) || await getDefaultClientId();
    await getPool().query(
      `UPDATE social_connections SET status='disconnected', access_token=NULL, refresh_token=NULL, updated_at=NOW()
       WHERE client_id=$1 AND platform=$2`,
      [clientId, req.params.platform]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Posts CRUD ───────────────────────────────────────────────────────────────

// GET /api/autoposter/posts
router.get('/posts', async (req, res, next) => {
  try {
    const clientId = parseClientId(req.query.clientId) || await getDefaultClientId();
    const status   = req.query.status || null;
    const limit    = Math.min(parseInt(req.query.limit || '50'), 200);
    const offset   = parseInt(req.query.offset || '0');

    let where = 'WHERE client_id=$1';
    const params = [clientId];
    if (status) {
      params.push(status);
      where += ` AND status=$${params.length}`;
    }

    const { rows } = await getPool().query(
      `SELECT * FROM social_posts ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const { rows: [{ count }] } = await getPool().query(
      `SELECT COUNT(*) FROM social_posts ${where}`, params
    );
    res.json({ posts: rows, total: parseInt(count), limit, offset });
  } catch (err) { next(err); }
});

// PATCH /api/autoposter/posts/:id
router.patch('/posts/:id', async (req, res, next) => {
  try {
    const { title, description, tags, scheduled_at } = req.body;
    const sets = [];
    const params = [];
    let idx = 1;

    if (title !== undefined)       { sets.push(`title=$${idx++}`);       params.push(title); }
    if (description !== undefined) { sets.push(`description=$${idx++}`); params.push(description); }
    if (tags !== undefined)        { sets.push(`tags=$${idx++}`);        params.push(JSON.stringify(tags)); }
    if (scheduled_at !== undefined) {
      sets.push(`scheduled_at=$${idx++}`);
      sets.push(`status='scheduled'`);
      params.push(scheduled_at);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    sets.push('updated_at=NOW()');
    params.push(req.params.id);

    const { rows } = await getPool().query(
      `UPDATE social_posts SET ${sets.join(', ')} WHERE id=$${idx} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Post not found' });
    res.json({ post: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/autoposter/posts/:id
router.delete('/posts/:id', async (req, res, next) => {
  try {
    const { rows } = await getPool().query(
      'DELETE FROM social_posts WHERE id=$1 RETURNING id', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Post not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/autoposter/posts/:id/publish  (stub — real publishing needs platform SDKs)
router.post('/posts/:id/publish', async (req, res, next) => {
  try {
    const db = getPool();
    const { rows: [post] } = await db.query('SELECT * FROM social_posts WHERE id=$1', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { rows: [conn] } = await db.query(
      'SELECT * FROM social_connections WHERE client_id=$1 AND platform=$2 AND status=$3',
      [post.client_id, post.platform, 'connected']
    );
    if (!conn) return res.status(400).json({ error: `Not connected to ${post.platform}. Connect in Settings first.` });

    // Mark as posting
    await db.query(`UPDATE social_posts SET status='posting', updated_at=NOW() WHERE id=$1`, [post.id]);

    // --- Platform-specific publish logic (MVP stubs) ---
    // Real implementation would call each platform's API using conn.access_token.
    // For now we simulate a successful post and return a placeholder.
    const platformPostId = `${post.platform}_${Date.now()}`;

    await db.query(
      `UPDATE social_posts SET status='posted', posted_at=NOW(), platform_post_id=$1, updated_at=NOW() WHERE id=$2`,
      [platformPostId, post.id]
    );

    const { rows: [updated] } = await db.query('SELECT * FROM social_posts WHERE id=$1', [post.id]);
    res.json({ post: updated, message: `Published to ${post.platform} successfully.` });
  } catch (err) {
    // Mark failed
    if (req.params.id) {
      await getPool().query(
        `UPDATE social_posts SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
        [err.message, req.params.id]
      ).catch(() => {});
    }
    next(err);
  }
});

// ── Upload Video → 3 platform posts (Instagram Reels, TikTok, YouTube Shorts) ─

router.post('/upload-video', autoposterUpload.single('video'), async (req, res, next) => {
  try {
    const clientId = parseClientId(req.body.clientId) || await getDefaultClientId();
    if (!req.file) return res.status(400).json({ error: 'Video file is required' });

    const mediaPath = `/uploads/autoposter/${req.file.filename}`;
    const batchId   = crypto.randomUUID();
    const brandKit  = await getBrandKit(clientId);

    // AI-generate metadata per platform
    const aiPrompt = `
You are a social media expert. Generate post metadata for a short video being posted to Instagram Reels, TikTok, and YouTube Shorts.
${brandKit ? `Brand: ${brandKit.brand_name}. Tone: ${brandKit.brand_description || 'professional'}.` : ''}
${req.body.description ? `Video description: ${req.body.description}` : ''}

Return a JSON object:
{
  "instagram": { "title": "...", "description": "...", "tags": ["tag1","tag2","tag3","tag4","tag5"] },
  "tiktok":    { "title": "...", "description": "...", "tags": ["tag1","tag2","tag3","tag4","tag5"] },
  "youtube":   { "title": "...", "description": "...", "tags": ["tag1","tag2","tag3","tag4","tag5"] }
}

Rules:
- Instagram: use relevant hashtags in description, engaging caption
- TikTok: trendy, casual tone, hashtags in description
- YouTube Shorts: SEO-optimized title, detailed description, broad tags
- All text MUST be in English
- Tags as simple lowercase words, no # symbol
    `.trim();

    let metadata;
    try {
      metadata = await generateJSON(aiPrompt);
    } catch {
      metadata = {
        instagram: { title: 'New Reel', description: 'Check out our latest content!', tags: ['reels', 'trending'] },
        tiktok:    { title: 'New Video', description: 'Watch now!', tags: ['fyp', 'viral'] },
        youtube:   { title: 'New Short', description: 'Don\'t miss this!', tags: ['shorts', 'trending'] },
      };
    }

    const db = getPool();
    const posts = [];

    for (const platform of VIDEO_PLATFORMS) {
      const meta = metadata[platform] || {};
      const dims = PLATFORM_DIMS[platform];
      const { rows: [post] } = await db.query(
        `INSERT INTO social_posts (client_id, batch_id, platform, post_type, title, description, tags, media_path, content_width, content_height, source, status)
         VALUES ($1,$2,$3,'video',$4,$5,$6,$7,$8,$9,'manual','draft') RETURNING *`,
        [clientId, batchId, platform, meta.title || '', meta.description || '', JSON.stringify(meta.tags || []),
         mediaPath, dims.w, dims.h]
      );
      posts.push(post);
    }

    res.json({ posts, batchId });
  } catch (err) { next(err); }
});

// ── Upload Image → 3 platform posts (LinkedIn, Facebook, Pinterest) ──────────

router.post('/upload-image', autoposterUpload.single('image'), async (req, res, next) => {
  try {
    const clientId = parseClientId(req.body.clientId) || await getDefaultClientId();
    if (!req.file) return res.status(400).json({ error: 'Image file is required' });

    const mediaPath = `/uploads/autoposter/${req.file.filename}`;
    const batchId   = crypto.randomUUID();
    const brandKit  = await getBrandKit(clientId);

    const aiPrompt = `
You are a social media expert. Generate post metadata for an image being posted to LinkedIn, Facebook, and Pinterest.
${brandKit ? `Brand: ${brandKit.brand_name}. Tone: ${brandKit.brand_description || 'professional'}.` : ''}
${req.body.description ? `Image description: ${req.body.description}` : ''}

Return a JSON object:
{
  "linkedin":  { "title": "...", "description": "...", "tags": ["tag1","tag2","tag3","tag4","tag5"] },
  "facebook":  { "title": "...", "description": "...", "tags": ["tag1","tag2","tag3","tag4","tag5"] },
  "pinterest": { "title": "...", "description": "...", "tags": ["tag1","tag2","tag3","tag4","tag5"] }
}

Rules:
- LinkedIn: professional tone, industry hashtags, thought-leadership style
- Facebook: engaging, conversational, community-focused
- Pinterest: SEO-rich description, keyword-packed tags for discoverability
- All text MUST be in English
- Tags as simple lowercase words, no # symbol
    `.trim();

    let metadata;
    try {
      metadata = await generateJSON(aiPrompt);
    } catch {
      metadata = {
        linkedin:  { title: 'New Post', description: 'Check out our latest update!', tags: ['business', 'update'] },
        facebook:  { title: 'New Post', description: 'See what\'s new!', tags: ['news', 'update'] },
        pinterest: { title: 'New Pin',  description: 'Discover more!', tags: ['inspiration', 'trending'] },
      };
    }

    const db = getPool();
    const posts = [];

    for (const platform of IMAGE_PLATFORMS) {
      const meta = metadata[platform] || {};
      const dims = PLATFORM_DIMS[platform];
      const { rows: [post] } = await db.query(
        `INSERT INTO social_posts (client_id, batch_id, platform, post_type, title, description, tags, media_path, content_width, content_height, source, status)
         VALUES ($1,$2,$3,'image',$4,$5,$6,$7,$8,$9,'manual','draft') RETURNING *`,
        [clientId, batchId, platform, meta.title || '', meta.description || '', JSON.stringify(meta.tags || []),
         mediaPath, dims.w, dims.h]
      );
      posts.push(post);
    }

    res.json({ posts, batchId });
  } catch (err) { next(err); }
});

// ── AI Create Post ───────────────────────────────────────────────────────────

router.post('/ai-create', async (req, res, next) => {
  try {
    const clientId   = parseClientId(req.body.clientId) || await getDefaultClientId();
    const { description, tone = 'Professional', platforms = [], useBrandKit = false } = req.body;
    if (!description?.trim()) return res.status(400).json({ error: 'description is required' });

    const selectedPlatforms = platforms.length ? platforms : [...VIDEO_PLATFORMS, ...IMAGE_PLATFORMS];
    const cfg      = await getSettings();
    const brandKit = useBrandKit ? await getBrandKit(clientId) : null;
    const batchId  = crypto.randomUUID();

    // Step 1: AI generates metadata for each platform
    const brandContext = brandKit
      ? `Brand: ${brandKit.brand_name}. Colors: ${brandKit.primary_color}, ${brandKit.accent_color}. Tone: ${brandKit.brand_description || 'professional'}.`
      : '';

    const metaPrompt = `
You are a social media expert. Generate post metadata for each platform.
Tone: ${tone}.
${brandContext}
Post idea: ${description}

Return a JSON object with keys for each of these platforms: ${selectedPlatforms.join(', ')}.
Each platform value should be: { "title": "...", "description": "...", "tags": ["tag1","tag2",...], "image_prompt": "a detailed image generation prompt suitable for this platform's dimensions and audience" }

Rules:
- Tailor content to each platform's audience and best practices
- image_prompt should describe a professional social media visual matching the platform
- All text MUST be in English
- Tags as simple lowercase words, no # symbol
    `.trim();

    let metadata;
    try {
      metadata = await generateJSON(metaPrompt);
    } catch {
      // Fallback: same generic metadata for all
      const fallback = { title: description.slice(0, 60), description: description, tags: ['social', 'post'], image_prompt: `Professional social media post: ${description}` };
      metadata = {};
      for (const p of selectedPlatforms) metadata[p] = { ...fallback };
    }

    const db = getPool();
    const posts = [];

    // Step 2: Generate images per platform (image platforms only — video platforms get a thumbnail)
    for (const platform of selectedPlatforms) {
      const meta = metadata[platform] || {};
      const dims = PLATFORM_DIMS[platform];
      const isVideo = VIDEO_PLATFORMS.includes(platform);
      const postType = isVideo ? 'video' : 'image';

      let mediaUrl = null;

      // Generate platform-specific image
      if (!isVideo && cfg.FAL_KEY) {
        try {
          const urls = await falai.generateImages({
            prompt: `${meta.image_prompt || description}. ${brandKit ? `Brand: ${brandKit.brand_name}. Primary color: ${brandKit.primary_color}.` : ''} All text in English.`,
            imageSize: `${dims.w}x${dims.h}`,
            numImages: 1,
            apiKey: cfg.FAL_KEY,
          });
          mediaUrl = urls[0] || null;
        } catch (err) {
          console.warn(`[AUTOPOSTER] Image generation failed for ${platform}:`, err.message);
        }
      }

      // For video platforms, generate a thumbnail image
      let thumbnailUrl = null;
      if (isVideo && cfg.FAL_KEY) {
        try {
          const urls = await falai.generateImages({
            prompt: `${meta.image_prompt || description}. Vertical format, eye-catching thumbnail. ${brandKit ? `Brand: ${brandKit.brand_name}.` : ''} All text in English.`,
            imageSize: `${dims.w}x${dims.h}`,
            numImages: 1,
            apiKey: cfg.FAL_KEY,
          });
          thumbnailUrl = urls[0] || null;
        } catch (err) {
          console.warn(`[AUTOPOSTER] Thumbnail generation failed for ${platform}:`, err.message);
        }
      }

      const { rows: [post] } = await db.query(
        `INSERT INTO social_posts (client_id, batch_id, platform, post_type, title, description, tags, media_url, thumbnail_url, content_width, content_height, source, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ai_create','draft') RETURNING *`,
        [clientId, batchId, platform, postType, meta.title || '', meta.description || '',
         JSON.stringify(meta.tags || []), mediaUrl, thumbnailUrl, dims.w, dims.h]
      );
      posts.push(post);
    }

    res.json({ posts, batchId });
  } catch (err) { next(err); }
});

module.exports = router;
