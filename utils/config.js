/**
 * Dynamic config reader.
 * Reads API keys from the DB (app_settings table) first,
 * then falls back to environment variables.
 */
const { getPool } = require('../database/init');

const SETTING_KEYS = {
  FAL_KEY:              'fal_key',
  GEMINI_API_KEY:       'gemini_api_key',
  GEMINI_MODEL:         'gemini_model',
  LEONARDO_API_KEY:     'leonardo_api_key',
  LEONARDO_MODEL_ID:    'leonardo_model_id',
  MISTRAL_API_KEY:      'mistral_api_key',
  MISTRAL_MODEL:        'mistral_model',
  // Social platform credentials
  FACEBOOK_APP_ID:      'facebook_app_id',
  FACEBOOK_APP_SECRET:  'facebook_app_secret',
  YOUTUBE_CLIENT_ID:    'youtube_client_id',
  YOUTUBE_CLIENT_SECRET:'youtube_client_secret',
  LINKEDIN_CLIENT_ID:   'linkedin_client_id',
  LINKEDIN_CLIENT_SECRET:'linkedin_client_secret',
  TIKTOK_CLIENT_KEY:    'tiktok_client_key',
  TIKTOK_CLIENT_SECRET: 'tiktok_client_secret',
  PINTEREST_APP_ID:     'pinterest_app_id',
  PINTEREST_APP_SECRET: 'pinterest_app_secret',
};

// In-memory cache (invalidated on save)
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 30_000; // 30s

async function getSettings() {
  const now = Date.now();
  if (_cache && now - _cacheTs < CACHE_TTL) return _cache;

  try {
    const { rows } = await getPool().query('SELECT key, value FROM app_settings');
    const db = {};
    for (const row of rows) db[row.key] = row.value;

    _cache = {
      FAL_KEY:              db[SETTING_KEYS.FAL_KEY]              || process.env.FAL_KEY              || '',
      GEMINI_API_KEY:       db[SETTING_KEYS.GEMINI_API_KEY]       || process.env.GEMINI_API_KEY       || '',
      GEMINI_MODEL:         db[SETTING_KEYS.GEMINI_MODEL]         || process.env.GEMINI_MODEL         || 'gemini-2.0-flash',
      LEONARDO_API_KEY:     db[SETTING_KEYS.LEONARDO_API_KEY]     || process.env.LEONARDO_API_KEY     || '',
      LEONARDO_MODEL_ID:    db[SETTING_KEYS.LEONARDO_MODEL_ID]    || process.env.LEONARDO_MODEL_ID    || 'b24e16ff-06e3-43eb-8d33-4416c2d75876',
      MISTRAL_API_KEY:      db[SETTING_KEYS.MISTRAL_API_KEY]      || process.env.MISTRAL_API_KEY      || '',
      MISTRAL_MODEL:        db[SETTING_KEYS.MISTRAL_MODEL]        || process.env.MISTRAL_MODEL        || 'mistral-small-latest',
      FACEBOOK_APP_ID:      db[SETTING_KEYS.FACEBOOK_APP_ID]      || process.env.FACEBOOK_APP_ID      || '',
      FACEBOOK_APP_SECRET:  db[SETTING_KEYS.FACEBOOK_APP_SECRET]  || process.env.FACEBOOK_APP_SECRET  || '',
      YOUTUBE_CLIENT_ID:    db[SETTING_KEYS.YOUTUBE_CLIENT_ID]    || process.env.YOUTUBE_CLIENT_ID    || '',
      YOUTUBE_CLIENT_SECRET:db[SETTING_KEYS.YOUTUBE_CLIENT_SECRET]|| process.env.YOUTUBE_CLIENT_SECRET|| '',
      LINKEDIN_CLIENT_ID:   db[SETTING_KEYS.LINKEDIN_CLIENT_ID]   || process.env.LINKEDIN_CLIENT_ID   || '',
      LINKEDIN_CLIENT_SECRET:db[SETTING_KEYS.LINKEDIN_CLIENT_SECRET]|| process.env.LINKEDIN_CLIENT_SECRET|| '',
      TIKTOK_CLIENT_KEY:    db[SETTING_KEYS.TIKTOK_CLIENT_KEY]    || process.env.TIKTOK_CLIENT_KEY    || '',
      TIKTOK_CLIENT_SECRET: db[SETTING_KEYS.TIKTOK_CLIENT_SECRET] || process.env.TIKTOK_CLIENT_SECRET || '',
      PINTEREST_APP_ID:     db[SETTING_KEYS.PINTEREST_APP_ID]     || process.env.PINTEREST_APP_ID     || '',
      PINTEREST_APP_SECRET: db[SETTING_KEYS.PINTEREST_APP_SECRET] || process.env.PINTEREST_APP_SECRET || '',
    };
    _cacheTs = now;
  } catch (_) {
    // DB not ready yet — fall back to env only
    _cache = {
      FAL_KEY:              process.env.FAL_KEY              || '',
      GEMINI_API_KEY:       process.env.GEMINI_API_KEY       || '',
      GEMINI_MODEL:         process.env.GEMINI_MODEL         || 'gemini-2.0-flash',
      LEONARDO_API_KEY:     process.env.LEONARDO_API_KEY     || '',
      LEONARDO_MODEL_ID:    process.env.LEONARDO_MODEL_ID    || 'b24e16ff-06e3-43eb-8d33-4416c2d75876',
      MISTRAL_API_KEY:      process.env.MISTRAL_API_KEY      || '',
      MISTRAL_MODEL:        process.env.MISTRAL_MODEL        || 'mistral-small-latest',
      FACEBOOK_APP_ID:      process.env.FACEBOOK_APP_ID      || '',
      FACEBOOK_APP_SECRET:  process.env.FACEBOOK_APP_SECRET  || '',
      YOUTUBE_CLIENT_ID:    process.env.YOUTUBE_CLIENT_ID    || '',
      YOUTUBE_CLIENT_SECRET:process.env.YOUTUBE_CLIENT_SECRET|| '',
      LINKEDIN_CLIENT_ID:   process.env.LINKEDIN_CLIENT_ID   || '',
      LINKEDIN_CLIENT_SECRET:process.env.LINKEDIN_CLIENT_SECRET|| '',
      TIKTOK_CLIENT_KEY:    process.env.TIKTOK_CLIENT_KEY    || '',
      TIKTOK_CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET || '',
      PINTEREST_APP_ID:     process.env.PINTEREST_APP_ID     || '',
      PINTEREST_APP_SECRET: process.env.PINTEREST_APP_SECRET || '',
    };
    _cacheTs = now;
  }
  return _cache;
}

function invalidateCache() { _cache = null; }

module.exports = { getSettings, invalidateCache, SETTING_KEYS };
