const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool(
      process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false }
        : {
            host:     process.env.DB_HOST     || 'localhost',
            port:     parseInt(process.env.DB_PORT || '5432'),
            database: process.env.DB_NAME     || 'static_ads_generator',
            user:     process.env.DB_USER     || 'postgres',
            password: process.env.DB_PASSWORD || '',
          }
    );
  }
  return pool;
}

async function initDatabase() {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      is_default  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Ensure at least one default client
  const { rowCount } = await db.query('SELECT 1 FROM clients LIMIT 1');
  if (rowCount === 0) {
    await db.query(`INSERT INTO clients (name, is_default) VALUES ('Default Client', TRUE)`);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS brand_kits (
      id                SERIAL PRIMARY KEY,
      client_id         INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      brand_name        TEXT,
      brand_description TEXT,
      primary_color     TEXT DEFAULT '#000000',
      secondary_color   TEXT DEFAULT '#ffffff',
      accent_color      TEXT DEFAULT '#ff6600',
      font_primary      TEXT DEFAULT 'Inter',
      font_secondary    TEXT DEFAULT 'Georgia',
      logo_dark_path    TEXT,
      logo_light_path   TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(client_id)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS templates (
      id          SERIAL PRIMARY KEY,
      client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      category    TEXT DEFAULT 'general',
      tags        JSONB DEFAULT '[]',
      file_path   TEXT,
      thumbnail   TEXT,
      source_type TEXT DEFAULT 'uploaded',
      is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS assets (
      id            SERIAL PRIMARY KEY,
      client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      filename      TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_type     TEXT NOT NULL,
      file_size     INTEGER NOT NULL DEFAULT 0,
      category      TEXT NOT NULL DEFAULT 'other',
      file_path     TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS generations (
      id              SERIAL PRIMARY KEY,
      client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      prompt          TEXT NOT NULL,
      concept         TEXT,
      avatar          TEXT,
      reference_image TEXT,
      product_image   TEXT,
      size            TEXT DEFAULT '1024x1024',
      aspect_ratio    TEXT DEFAULT '1:1',
      use_brand_kit   BOOLEAN NOT NULL DEFAULT FALSE,
      images          JSONB DEFAULT '[]',
      status          TEXT NOT NULL DEFAULT 'pending',
      error_message   TEXT,
      parent_id       INTEGER REFERENCES generations(id),
      edit_instruction TEXT,
      campaign_tags   JSONB DEFAULT '[]',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS brand_intelligence (
      id               SERIAL PRIMARY KEY,
      client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      persona          TEXT NOT NULL,
      pain_point       TEXT,
      angle            TEXT,
      visual_direction TEXT,
      emotion          TEXT,
      copy_hook        TEXT,
      source           TEXT DEFAULT 'manual',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS campaign_tags (
      id          SERIAL PRIMARY KEY,
      client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      color       TEXT DEFAULT '#6366f1',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(client_id, name)
    );
  `);

  // Safe iterative migrations
  const migrations = [
    `ALTER TABLE generations   ADD COLUMN IF NOT EXISTS edit_instruction TEXT`,
    `ALTER TABLE generations   ADD COLUMN IF NOT EXISTS campaign_tags JSONB DEFAULT '[]'`,
    `ALTER TABLE assets        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `ALTER TABLE brand_kits    ADD COLUMN IF NOT EXISTS logo_dark_path TEXT`,
    `ALTER TABLE brand_kits    ADD COLUMN IF NOT EXISTS logo_light_path TEXT`,
    `ALTER TABLE templates     ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE templates     ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'uploaded'`,
  ];

  for (const sql of migrations) {
    try { await db.query(sql); } catch (_) { /* already exists */ }
  }

  await db.query(`CREATE INDEX IF NOT EXISTS idx_generations_client   ON generations(client_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_assets_client        ON assets(client_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_templates_client     ON templates(client_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_intelligence_client  ON brand_intelligence(client_id)`);

  // App-wide settings (API keys, preferences) — key/value store
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = { getPool, initDatabase };
