/**
 * One-off migration: copy all data from the old SQLite database
 * (backend/data/varuntej.db) into PostgreSQL (DATABASE_URL).
 *
 *   node tools/migrate-sqlite-to-pg.js
 *
 * Idempotent: skips tables that already have rows in PostgreSQL.
 */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const db = require('../src/db');

const SQLITE_PATH = path.join(__dirname, '..', 'data', 'varuntej.db');

const TABLES = [
  'users', 'otps', 'sessions', 'ai_keys', 'ai_models', 'news_articles',
  'news_checkpoint', 'ai_reports', 'trades', 'analyses', 'notification_preferences',
  'notifications', 'app_settings', 'scrips', 'news_history', 'option_news', 'trade_history',
];

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.log('No SQLite database found at', SQLITE_PATH, '- nothing to migrate.');
    return;
  }
  const sqlite = new DatabaseSync(SQLITE_PATH);
  await db.ready();

  for (const table of TABLES) {
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    if (!rows.length) {
      console.log(`skip  ${table} (empty)`);
      continue;
    }
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    const stmt = db.prepare(sql);
    let inserted = 0;
    for (const r of rows) {
      const out = await stmt.run(...cols.map((c) => r[c]));
      inserted += out.changes;
    }
    // Keep sequences in sync after explicit id inserts (tables without an
    // `id` column, e.g. notification_preferences, are skipped).
    if (cols.includes('id')) {
      await db.prepare(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`).get();
    }
    console.log(`${table}: ${inserted}/${rows.length} rows inserted`);
  }

  console.log('Done. SQLite data copied to PostgreSQL.');
  sqlite.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
