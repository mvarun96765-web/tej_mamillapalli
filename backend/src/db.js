const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

// ── SQLite → PostgreSQL dialect conversion ─────────────────────
// Keeps the existing `db.prepare(sql).run/get/all` call shape so callers only
// need to `await` the statement methods.

/** `?` placeholders -> `$1..$n` (safe: no `?` appears inside our SQL literals). */
function placeholders(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

/** `datetime('now')` (SQLite) -> UTC text timestamp matching the old format. */
function datetimeNow(sql) {
  return sql.replace(/datetime\('now'\)/g, "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')");
}

/** `INSERT OR IGNORE` -> `INSERT ... ON CONFLICT DO NOTHING`. */
function orIgnore(sql) {
  if (/^INSERT OR IGNORE/i.test(sql.trim())) {
    return `INSERT${sql.trim().slice('INSERT OR IGNORE'.length)} ON CONFLICT DO NOTHING`;
  }
  return sql;
}

/** Append `RETURNING id` to plain INSERTs so run() can report lastInsertRowid. */
function returningId(sql) {
  const t = sql.trim();
  if (/^INSERT/i.test(t) && !/RETURNING/i.test(t)) return `${t} RETURNING id`;
  return t;
}

function convert(sql) {
  let s = orIgnore(sql);
  s = datetimeNow(s);
  s = returningId(s);
  s = placeholders(s);
  return s;
}

async function execute(sql, params, mode) {
  const text = convert(sql);
  try {
    const r = await pool.query({ text, values: params });
    if (mode === 'run') {
      return { changes: r.rowCount, lastInsertRowid: r.rows[0] ? r.rows[0].id : undefined };
    }
    if (mode === 'get') return r.rows[0];
    return r.rows;
  } catch (e) {
    // Tables without an `id` column (e.g. notification_preferences) reject the
    // auto-appended `RETURNING id` — retry without it.
    if (/RETURNING id/i.test(text) && /does not exist/i.test(e.message)) {
      const r = await pool.query({ text: text.replace(/\s+RETURNING id/i, ''), values: params });
      return { changes: r.rowCount, lastInsertRowid: undefined };
    }
    console.error('[db]', mode, text.slice(0, 180), '->', e.message);
    throw e;
  }
}

/**
 * Prepared-statement style wrapper. `.run()/.get()/.all()` are async and accept
 * positional params exactly like the old SQLite driver.
 */
function prepare(sql) {
  return {
    run: (...params) => execute(sql, params, 'run'),
    get: (...params) => execute(sql, params, 'get'),
    all: (...params) => execute(sql, params, 'all'),
  };
}

// ── Schema (PostgreSQL) ────────────────────────────────────────
const NOW = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

async function initSchema() {
  await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  username TEXT UNIQUE,
  name TEXT DEFAULT '',
  dob TEXT DEFAULT '',              -- Date of birth (YYYY-MM-DD), used for password reset verification
  password_hash TEXT NOT NULL,
  email_verified INTEGER DEFAULT 0,
  phone_verified INTEGER DEFAULT 0,
  profile_pic TEXT DEFAULT '',
  security_pin_hash TEXT DEFAULT '',
  biometric_enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (${NOW}),
  updated_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  refresh_hash TEXT UNIQUE NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (${NOW}),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ai_keys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  work INTEGER NOT NULL,            -- 1 | 2 | 3
  slot INTEGER NOT NULL,            -- 1..10
  provider TEXT DEFAULT 'google',
  model TEXT DEFAULT '',
  encrypted_key TEXT NOT NULL,
  key_hint TEXT DEFAULT '',
  status TEXT DEFAULT 'UNKNOWN',    -- ACTIVE | RATE_LIMITED | QUOTA_EXCEEDED | INVALID | DISABLED | UNKNOWN
  last_error TEXT DEFAULT '',
  last_tested_at TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (${NOW}),
  UNIQUE(user_id, work, slot),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ai_models (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint TEXT DEFAULT '',
  encrypted_key TEXT NOT NULL,
  key_hint TEXT DEFAULT '',
  status TEXT DEFAULT 'VERIFICATION_REQUIRED', -- CONNECTED | VERIFICATION_REQUIRED | FAILED | DISABLED
  verified_at TEXT DEFAULT '',
  is_primary INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  last_error TEXT DEFAULT '',
  last_error_category TEXT DEFAULT '',
  latency_ms INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (${NOW}),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS news_articles (
  id SERIAL PRIMARY KEY,
  fingerprint TEXT UNIQUE NOT NULL,
  source TEXT DEFAULT '',
  url TEXT DEFAULT '',
  title TEXT NOT NULL,
  published_at TEXT DEFAULT '',
  company TEXT DEFAULT '',
  content_hash TEXT DEFAULT '',
  raw TEXT DEFAULT '',
  collected_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS news_checkpoint (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_checkpoint TEXT DEFAULT '',
  last_published_from TEXT DEFAULT ''
);

-- News API request history (Settings -> News API History); >24h auto-deleted.
CREATE TABLE IF NOT EXISTS news_history (
  id SERIAL PRIMARY KEY,
  request_time TEXT NOT NULL,
  requested_from TEXT DEFAULT '',
  requested_to TEXT DEFAULT '',
  returned INTEGER DEFAULT 0,
  added INTEGER DEFAULT 0,
  article_uuid TEXT DEFAULT '',
  title TEXT DEFAULT '',
  main_point TEXT DEFAULT '',
  source TEXT DEFAULT '',
  url TEXT DEFAULT '',
  published_at TEXT DEFAULT '',
  companies TEXT DEFAULT '',
  created_at TEXT DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_news_history_time ON news_history(request_time);

-- Per-company/option news (latest 10 per company retained).
CREATE TABLE IF NOT EXISTS option_news (
  id SERIAL PRIMARY KEY,
  company TEXT NOT NULL,
  article_id INTEGER NOT NULL,
  published_at TEXT DEFAULT '',
  created_at TEXT DEFAULT (${NOW}),
  UNIQUE(company, article_id)
);
CREATE INDEX IF NOT EXISTS idx_option_news_company ON option_news(company, published_at DESC);

-- Closed trade records preserved for performance tracking.
CREATE TABLE IF NOT EXISTS trade_history (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  symbol TEXT NOT NULL,
  instrument TEXT DEFAULT '',
  signal TEXT NOT NULL,
  entry_price TEXT DEFAULT '',
  target TEXT DEFAULT '',
  stop_loss TEXT DEFAULT '',
  confidence INTEGER DEFAULT 0,
  reason TEXT DEFAULT '',
  generated_at TEXT DEFAULT '',
  closed_at TEXT DEFAULT (${NOW}),
  highest_price TEXT DEFAULT '',
  lowest_price TEXT DEFAULT '',
  final_price TEXT DEFAULT '',
  final_status TEXT NOT NULL,        -- TARGET_REACHED | STOP_LOSS_REACHED | EXPIRED_AT_MARKET_CLOSE | CANCELLED
  result TEXT DEFAULT '',            -- Success | Loss | Expired | Cancelled
  timeframe TEXT DEFAULT '',
  risk TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_trade_history_user ON trade_history(user_id, closed_at DESC);

CREATE TABLE IF NOT EXISTS ai_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  article_id INTEGER,
  stage INTEGER NOT NULL,           -- 1 | 2 | 3
  kind TEXT DEFAULT 'news',         -- 'news' | 'historical' | 'stock' | 'option'
  payload TEXT NOT NULL,
  created_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,               -- 'stock' | 'option'
  symbol TEXT NOT NULL,
  instrument TEXT DEFAULT '',
  signal TEXT NOT NULL,             -- BUY | WATCH | AVOID
  entry_zone TEXT DEFAULT '',
  entry_price TEXT DEFAULT '',
  target TEXT DEFAULT '',
  stop_loss TEXT DEFAULT '',
  timeframe TEXT DEFAULT '',
  risk TEXT DEFAULT '',
  confidence INTEGER DEFAULT 0,
  reason TEXT DEFAULT '',
  status TEXT DEFAULT 'ACTIVE',     -- ACTIVE | TARGET_REACHED | STOP_LOSS_REACHED | EXPIRED_AT_MARKET_CLOSE | CANCELLED
  highest_price TEXT DEFAULT '',
  lowest_price TEXT DEFAULT '',
  final_price TEXT DEFAULT '',
  closed_at TEXT DEFAULT '',
  result TEXT DEFAULT '',
  high_confidence INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (${NOW}),
  updated_at TEXT DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id, kind);

CREATE TABLE IF NOT EXISTS analyses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,               -- 'stock' | 'option' | 'index'
  symbol TEXT NOT NULL,
  current_price TEXT DEFAULT '',
  market_trend TEXT DEFAULT '',
  news_sentiment TEXT DEFAULT '',
  ai_signal TEXT DEFAULT '',
  target TEXT DEFAULT '',
  stop_loss TEXT DEFAULT '',
  timeframe TEXT DEFAULT '',
  risk TEXT DEFAULT '',
  confidence INTEGER DEFAULT 0,
  reason TEXT DEFAULT '',
  created_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INTEGER PRIMARY KEY,
  new_trade INTEGER DEFAULT 1,
  high_confidence_trade INTEGER DEFAULT 1,
  trade_update INTEGER DEFAULT 1,
  target_reached INTEGER DEFAULT 1,
  stop_loss_alert INTEGER DEFAULT 1,
  new_stock_opportunity INTEGER DEFAULT 1,
  new_option_opportunity INTEGER DEFAULT 1,
  market_alert INTEGER DEFAULT 1,
  important_news INTEGER DEFAULT 1,
  major_company_news INTEGER DEFAULT 1,
  bullish_news INTEGER DEFAULT 0,
  bearish_news INTEGER DEFAULT 0,
  news_analysis_completed INTEGER DEFAULT 1,
  ai_analysis_completed INTEGER DEFAULT 1,
  daily_market_summary INTEGER DEFAULT 1,
  market_open INTEGER DEFAULT 0,
  market_close INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  data TEXT DEFAULT '{}',
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (${NOW}),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS scrips (
  symbol TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  exchange TEXT NOT NULL,
  ts BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  user_id INTEGER PRIMARY KEY,
  theme TEXT DEFAULT 'system',      -- light | dark | system
  server_url TEXT DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

  // Migrations for pre-existing databases (idempotent).
  // Auth: add date-of-birth for the DOB-based password reset; OTP flow removed.
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS dob TEXT DEFAULT \'\'');
  await pool.query('DROP TABLE IF EXISTS otps');
  await pool.query('ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_price TEXT DEFAULT \'\'');
  await pool.query('ALTER TABLE trades ADD COLUMN IF NOT EXISTS highest_price TEXT DEFAULT \'\'');
  await pool.query('ALTER TABLE trades ADD COLUMN IF NOT EXISTS lowest_price TEXT DEFAULT \'\'');
  await pool.query('ALTER TABLE trades ADD COLUMN IF NOT EXISTS final_price TEXT DEFAULT \'\'');
  await pool.query('ALTER TABLE trades ADD COLUMN IF NOT EXISTS closed_at TEXT DEFAULT \'\'');
  await pool.query('ALTER TABLE trades ADD COLUMN IF NOT EXISTS result TEXT DEFAULT \'\'');
  await pool.query('ALTER TABLE news_checkpoint ADD COLUMN IF NOT EXISTS last_published_from TEXT DEFAULT \'\'');
}

let schemaReady = null;
function ready() {
  if (!schemaReady) {
    schemaReady = initSchema().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

module.exports = {
  pool,
  prepare,
  ready,
  convert,
};
