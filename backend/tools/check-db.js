#!/usr/bin/env node
/**
 * VARUN TEJ — MongoDB connectivity + data-layer self-check.
 *
 * Connects to the MongoDB cluster configured in backend/.env and runs the
 * app's real query shapes (via the db.prepare(...) adapter) against a SCRATCH
 * database so your actual data is never touched. Prints ✓/✗ per group and
 * exits 0 on success.
 *
 * Usage:
 *   node tools/check-db.js
 *   MONGO_SELFTEST_DB=my_test_db node tools/check-db.js   # custom scratch db
 */
// NOTE: src/config runs dotenv with override:true (backend/.env wins), so the
// scratch database name must be pinned on the config object AFTER it loads.
const config = require('../src/config');
config.mongoDbName = process.env.MONGO_SELFTEST_DB || 'varuntej_selftest';

const db = require('../src/db');

const SELF = config.mongoDbName;
let failures = 0;
let checks = 0;

function assert(cond, label) {
  checks += 1;
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

async function cleanup() {
  const names = [
    'users', 'sessions', 'ai_keys', 'ai_models', 'news_articles', 'news_checkpoint',
    'news_history', 'option_news', 'trade_history', 'ai_reports', 'trades',
    'analyses', 'notification_preferences', 'notifications', 'scrips', 'app_settings', 'counters',
  ];
  for (const n of names) {
    try { await db.client.db(SELF).collection(n).drop(); } catch (e) { /* not created */ }
  }
}

(async () => {
  console.log(`Scratch database: ${SELF}`);
  await db.ready();
  console.log('✓ connected to MongoDB Atlas\n');

  // ── users (signup / login / profile) ─────────────────────────
  console.log('users');
  const signup = await db.prepare(
    `INSERT INTO users (email, username, name, dob, password_hash) VALUES (?, ?, ?, ?, ?)`
  ).run('alice@test.dev', 'alice', 'alice', '2000-01-01', 'hash1');
  assert(signup.lastInsertRowid === 1, 'first user gets id 1');

  const byUser = await db.prepare('SELECT id FROM users WHERE username = ?').get('alice');
  assert(byUser && byUser.id === 1, 'SELECT by username');

  const orRow = await db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get('alice', 'alice');
  assert(orRow && orRow.id === 1 && orRow.password_hash === 'hash1', 'OR lookup (username/email)');
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(orRow.created_at), 'created_at UTC text format');

  const clash = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get('alice', 1);
  assert(!clash, 'id != ? excludes self');
  const clash2 = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get('alice', 999);
  assert(clash2 && clash2.id === 1, 'id != ? matches others');

  await db.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?").run('Alice Smith', 1);
  const me = await db.prepare(
    'SELECT id, email, phone, username, name, dob, profile_pic, email_verified, phone_verified, biometric_enabled FROM users WHERE id = ?'
  ).get(1);
  assert(me && me.name === 'Alice Smith' && me.email_verified === 0 && me.phone === undefined, 'projected SELECT + update');

  const allIds = (await db.prepare('SELECT id FROM users').all()).map((r) => r.id);
  assert(allIds.includes(1), 'SELECT id FROM users (scheduler)');

  // ── sessions ─────────────────────────────────────────────────
  console.log('sessions');
  const ttl = 30 * 24 * 60 * 60 * 1000;
  await db.prepare(
    `INSERT INTO sessions (user_id, token_hash, refresh_hash, expires_at) VALUES (?, ?, ?, ?)`
  ).run(1, 'tok1', 'ref1', Date.now() + ttl);
  const sess = await db.prepare('SELECT * FROM sessions WHERE refresh_hash = ? AND revoked = 0').get('ref1');
  assert(sess && sess.user_id === 1 && typeof sess.expires_at === 'number', 'session lookup + BIGINT expires_at');
  await db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(sess.id);
  const gone = await db.prepare('SELECT * FROM sessions WHERE refresh_hash = ? AND revoked = 0').get('ref1');
  assert(!gone, 'revoked session no longer found');

  // ── notification_preferences / app_settings ──────────────────
  console.log('notification_preferences / app_settings');
  await db.prepare(`INSERT INTO notification_preferences (user_id) VALUES (?) ON CONFLICT DO NOTHING`).run(1);
  const prefs = await db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(1);
  assert(prefs.new_trade === 1 && prefs.market_open === 0, 'preference defaults');
  const dupPref = await db.prepare(`INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)`).run(1);
  assert(dupPref.changes === 0, 'duplicate preference ignored');
  await db.prepare(`UPDATE notification_preferences SET market_alert = ?, bullish_news = ? WHERE user_id = ?`).run(1, 0, 1);
  const prefs2 = await db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(1);
  assert(prefs2.market_alert === 1 && prefs2.bullish_news === 0, 'preference update');

  await db.prepare(`INSERT INTO app_settings (user_id) VALUES (?) ON CONFLICT DO NOTHING`).run(1);
  await db.prepare(
    `INSERT INTO app_settings (user_id, theme, server_url) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET theme = COALESCE(?, theme), server_url = COALESCE(?, server_url)`
  ).run(1, 'dark', 'http://x', 'dark', 'http://x');
  let st = await db.prepare('SELECT * FROM app_settings WHERE user_id = ?').get(1);
  assert(st.theme === 'dark' && st.server_url === 'http://x', 'app_settings upsert');
  await db.prepare(
    `INSERT INTO app_settings (user_id, theme, server_url) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET theme = COALESCE(?, theme), server_url = COALESCE(?, server_url)`
  ).run(1, 'system', '', null, null);
  st = await db.prepare('SELECT * FROM app_settings WHERE user_id = ?').get(1);
  assert(st.theme === 'dark' && st.server_url === 'http://x', 'COALESCE keeps existing value');

  // ── notifications ────────────────────────────────────────────
  console.log('notifications');
  await db.prepare('INSERT INTO notifications (user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?)')
    .run(1, 'new_trade', 'T', 'B', '{"a":1}');
  let inbox = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(1, 5);
  assert(inbox.length === 1 && inbox[0].read === 0, 'inbox insert + LIMIT ?');
  let unread = await db.prepare('SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = ? AND read = 0').get(1);
  assert(unread.c === 1, 'unread count');
  await db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (?, ?)').run(1, inbox[0].id, 999);
  unread = await db.prepare('SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = ? AND read = 0').get(1);
  assert(unread.c === 0, 'mark read by id IN (...)');
  await db.prepare('INSERT INTO notifications (user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?)')
    .run(1, 'market_open', 'M', '', '{}');
  await db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(1);
  unread = await db.prepare('SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = ? AND read = 0').get(1);
  assert(unread.c === 0, 'read-all update with literal 0');

  // ── scrips (token cache upsert) ──────────────────────────────
  console.log('scrips');
  const scripUpsert = (token) => db.prepare(
    `INSERT INTO scrips (symbol, token, exchange, ts) VALUES (?, ?, ?, ?)
     ON CONFLICT (symbol) DO UPDATE SET token = EXCLUDED.token, exchange = EXCLUDED.exchange, ts = EXCLUDED.ts`
  ).run('RELIANCE', token, 'NSE', Date.now());
  await scripUpsert('2885');
  let sc = await db.prepare('SELECT token FROM scrips WHERE symbol = ? AND exchange = ? AND ts > ?')
    .get('RELIANCE', 'NSE', Date.now() - 24 * 60 * 60 * 1000);
  assert(sc.token === '2885', 'scrip cache lookup');
  await scripUpsert('9999');
  sc = await db.prepare('SELECT token FROM scrips WHERE symbol = ? AND exchange = ? AND ts > ?')
    .get('RELIANCE', 'NSE', Date.now() - 24 * 60 * 60 * 1000);
  assert(sc.token === '9999', 'scrip upsert replaces token');
  const scCount = await db.prepare('SELECT COUNT(*)::int AS c FROM scrips').get();
  assert(scCount.c === 1, 'scrip upsert does not duplicate');

  // ── news_checkpoint ──────────────────────────────────────────
  console.log('news_checkpoint');
  await db.prepare('INSERT OR IGNORE INTO news_checkpoint (id, last_checkpoint, last_published_from) VALUES (1, ?, ?)')
    .run('now1', 'from1');
  let cp = await db.prepare('SELECT last_published_from, last_checkpoint FROM news_checkpoint WHERE id = 1').get();
  assert(cp.last_published_from === 'from1', 'checkpoint singleton insert');
  const cpDup = await db.prepare('INSERT OR IGNORE INTO news_checkpoint (id, last_checkpoint, last_published_from) VALUES (1, ?, ?)')
    .run('x', 'y');
  assert(cpDup.changes === 0, 'checkpoint duplicate ignored');
  await db.prepare(
    `INSERT INTO news_checkpoint (id, last_checkpoint, last_published_from) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_checkpoint = EXCLUDED.last_checkpoint, last_published_from = EXCLUDED.last_published_from`
  ).run('now2', 'from2');
  cp = await db.prepare('SELECT last_published_from, last_checkpoint FROM news_checkpoint WHERE id = 1').get();
  assert(cp.last_published_from === 'from2' && cp.last_checkpoint === 'now2', 'checkpoint upsert');

  // ── news_articles (dedupe by fingerprint) ────────────────────
  console.log('news_articles');
  const storeArt = (fp, title, publishedAt) => db.prepare(
    `INSERT OR IGNORE INTO news_articles (fingerprint, source, url, title, published_at, content_hash, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(fp, 'src', `url:${fp}`, title, publishedAt, 'ch', '{}');
  const art1 = await storeArt('fp1', 'Title A', '2026-08-17T08:00:00.000Z');
  assert(art1.changes === 1 && typeof art1.lastInsertRowid === 'number', 'article insert');
  const art1again = await storeArt('fp1', 'Title A', '2026-08-17T08:00:00.000Z');
  assert(art1again.changes === 0, 'fingerprint dedupe (changes 0)');
  const art2 = await storeArt('fp2', 'Title B', '2026-08-18T08:00:00.000Z');
  const art3 = await storeArt('fp3', 'Title C', '2026-08-19T08:00:00.000Z');
  const byFp = await db.prepare('SELECT id FROM news_articles WHERE fingerprint = ?').get('fp2');
  assert(byFp.id === art2.lastInsertRowid, 'lookup by fingerprint');
  const rec = await db.prepare('SELECT * FROM news_articles WHERE id = ?').get(1);
  assert(rec && rec.id === 1 && rec.fingerprint === 'fp1', 'SELECT * by id');
  const newsSince = await db.prepare('SELECT * FROM news_articles WHERE published_at >= ? ORDER BY published_at DESC LIMIT ?')
    .all('2026-01-01T00:00:00.000Z', 10);
  assert(newsSince.length === 3, 'news since filter');
  const newsAll = await db.prepare('SELECT * FROM news_articles ORDER BY id DESC LIMIT ?').all(5);
  assert(newsAll.length === 3 && newsAll[0].title === 'Title C', 'news ORDER BY id DESC');
  const recent = await db.prepare('SELECT title, source, published_at, raw FROM news_articles ORDER BY published_at DESC LIMIT 8').all();
  assert(recent.length === 3 && recent[0].title === 'Title C', 'projected recent news');

  // ── option_news (link + prune) ───────────────────────────────
  console.log('option_news');
  const link = db.prepare('INSERT OR IGNORE INTO option_news (company, article_id, published_at) VALUES (?, ?, ?)');
  await link.run('RELIANCE', art1.lastInsertRowid, '2026-08-17T08:00:00.000Z');
  const linkDup = await link.run('RELIANCE', art1.lastInsertRowid, '2026-08-17T08:00:00.000Z');
  assert(linkDup.changes === 0, 'company+article unique (dedupe)');
  await link.run('RELIANCE', art2.lastInsertRowid, '2026-08-18T08:00:00.000Z');
  await link.run('TCS', art2.lastInsertRowid, '2026-08-18T08:00:00.000Z');
  const companies = (await db.prepare('SELECT DISTINCT company FROM option_news').all()).map((r) => r.company);
  assert(companies.sort().join(',') === 'RELIANCE,TCS', 'DISTINCT company');
  const toDelete = (await db.prepare('SELECT id FROM option_news WHERE company = ? ORDER BY published_at DESC, id DESC OFFSET ?')
    .all('RELIANCE', 1)).map((r) => r.id);
  assert(toDelete.length === 1, 'OFFSET ? (prune keeps latest N)');
  const ph = toDelete.map(() => '?').join(',');
  await db.prepare(`DELETE FROM option_news WHERE company = ? AND id NOT IN (${ph})`).run('RELIANCE', ...toDelete);
  const remain = await db.prepare('SELECT COUNT(*)::int AS c FROM option_news WHERE company = ?').get('RELIANCE');
  assert(remain.c === 1, 'DELETE ... id NOT IN (...)');

  // ── JOIN news_articles <-> option_news ───────────────────────
  console.log('JOIN');
  // Note: the app's prune keeps the rows AFTER the OFFSET (SQL semantics), so the
  // surviving RELIANCE link here is the older article (Title A) — reproduced faithfully.
  const joined = await db.prepare(
    `SELECT n.* FROM news_articles n JOIN option_news on ON on.article_id = n.id WHERE on.company = ? ORDER BY n.published_at DESC LIMIT ?`
  ).all('RELIANCE', 10);
  assert(joined.length === 1 && joined[0].title === 'Title A', 'JOIN returns linked article');
  const joinedTcs = await db.prepare(
    `SELECT n.* FROM news_articles n JOIN option_news on ON on.article_id = n.id WHERE on.company = ? ORDER BY n.published_at DESC LIMIT ?`
  ).all('TCS', 10);
  assert(joinedTcs.length === 1 && joinedTcs[0].title === 'Title B', 'JOIN by company');

  // ── news_history ─────────────────────────────────────────────
  console.log('news_history');
  await db.prepare(
    `INSERT INTO news_history (request_time, requested_from, requested_to, returned, added, article_uuid, title, main_point, source, url, published_at, companies)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('2026-08-17T08:00:00.000Z', 'f', 't', 3, 1, 'uuid', 'H1', 'mp', 'src', 'u', 'p', 'RELIANCE');
  const hist = await db.prepare('SELECT * FROM news_history WHERE request_time >= ? ORDER BY id DESC LIMIT ?')
    .all('2026-08-01T00:00:00.000Z', 10);
  assert(hist.length === 1 && hist[0].returned === 3, 'history insert + query');
  await db.prepare('DELETE FROM news_history WHERE request_time < ?').run('2026-08-01T00:00:00.000Z');
  const histCount = await db.prepare('SELECT COUNT(*)::int AS c FROM news_history').get();
  assert(histCount.c === 1, 'stale history survives delete');
  await db.prepare('DELETE FROM news_history WHERE request_time < ?').run('2099-01-01T00:00:00.000Z');

  // ── ai_reports + subquery (processPendingNews) ───────────────
  console.log('ai_reports / subquery');
  await db.prepare("INSERT INTO ai_reports (user_id, article_id, stage, kind, payload) VALUES (?, ?, 1, 'news', ?)")
    .run(1, art1.lastInsertRowid, '{"a":1}');
  await db.prepare("INSERT INTO ai_reports (user_id, article_id, stage, kind, payload) VALUES (?, NULL, 1, 'historical', ?)")
    .run(1, '{"h":1}');
  await db.prepare("INSERT INTO ai_reports (user_id, article_id, stage, kind, payload) VALUES (?, ?, 3, 'news', ?)")
    .run(1, art2.lastInsertRowid, '{"b":1}');
  let pending = await db.prepare(
    "SELECT id FROM news_articles WHERE id > (SELECT COALESCE(MAX(article_id),0) FROM ai_reports WHERE user_id = ? AND kind = 'news') ORDER BY id LIMIT 20"
  ).all(1);
  assert(pending.length === 1 && pending[0].id === art3.lastInsertRowid, 'subquery: only unprocessed article pending');
  pending = await db.prepare(
    "SELECT id FROM news_articles WHERE id > (SELECT COALESCE(MAX(article_id),0) FROM ai_reports WHERE user_id = ? AND kind = 'news') ORDER BY id LIMIT 20"
  ).all(2);
  assert(pending.length === 3, 'subquery: other user sees all articles');

  // ── ai_keys (upsert keeps encrypted key when blank) ──────────
  console.log('ai_keys');
  const keyUpsert = (provider, model, enc, hint) => db.prepare(
    `INSERT INTO ai_keys (user_id, work, slot, provider, model, encrypted_key, key_hint, status, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
     ON CONFLICT(user_id, work, slot) DO UPDATE SET
       provider = excluded.provider,
       model = excluded.model,
       encrypted_key = CASE WHEN excluded.encrypted_key = '' THEN ai_keys.encrypted_key ELSE excluded.encrypted_key END,
       key_hint = CASE WHEN excluded.encrypted_key = '' THEN ai_keys.key_hint ELSE excluded.key_hint END,
       status = CASE WHEN excluded.encrypted_key = '' THEN ai_keys.status ELSE 'ACTIVE' END,
       last_error = '',
       enabled = excluded.enabled`
  ).run(1, 1, 1, provider, model, enc, hint, 1);
  await keyUpsert('google', 'gemini', 'enc1', 'hint1');
  const k1 = await db.prepare('SELECT * FROM ai_keys WHERE id = ? AND user_id = ?').get(1, 1);
  assert(k1.encrypted_key === 'enc1' && k1.status === 'ACTIVE', 'ai_key insert');
  await keyUpsert('google', 'gemini2', '', '');
  const k2 = await db.prepare('SELECT * FROM ai_keys WHERE id = ? AND user_id = ?').get(1, 1);
  assert(k2.id === 1 && k2.encrypted_key === 'enc1' && k2.key_hint === 'hint1' && k2.model === 'gemini2' && k2.status === 'ACTIVE',
    'upsert keeps key when blank, updates model');
  await keyUpsert('openai', 'gpt', 'enc2', 'hint2');
  const k3 = await db.prepare('SELECT * FROM ai_keys WHERE id = ? AND user_id = ?').get(1, 1);
  assert(k3.encrypted_key === 'enc2' && k3.provider === 'openai', 'upsert replaces key when provided');
  const keys = await db.prepare('SELECT id, work, slot, provider, model, key_hint, status, last_error, last_tested_at, enabled FROM ai_keys WHERE user_id = ? AND work = ? ORDER BY slot').all(1, 1);
  assert(keys.length === 1 && keys[0].enabled === 1, 'listKeys projection + sort');
  await db.prepare("UPDATE ai_keys SET status = ?, last_error = ?, last_tested_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run('RATE_LIMITED', 'boom', 1, 1);
  const k4 = await db.prepare('SELECT * FROM ai_keys WHERE id = ? AND user_id = ?').get(1, 1);
  assert(k4.status === 'RATE_LIMITED' && /^\d{4}-\d{2}-\d{2} /.test(k4.last_tested_at), 'status update with datetime(now)');
  const uidRows = await db.prepare('SELECT DISTINCT user_id FROM ai_keys WHERE enabled = 1').all();
  assert(uidRows.map((r) => r.user_id).includes(1), 'DISTINCT user_id (scheduler)');

  // ── ai_models ────────────────────────────────────────────────
  console.log('ai_models');
  await db.prepare(
    `INSERT INTO ai_models (user_id, provider, model, endpoint, encrypted_key, key_hint, status, verified_at, is_primary, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, 'CONNECTED', datetime('now'), 0, ?)`
  ).run(1, 'google', 'gemini', '', 'ek', 'kh', 12);
  const models = await db.prepare(
    'SELECT id, provider, model, endpoint, key_hint, status, verified_at, is_primary, enabled, last_error, last_error_category, latency_ms, created_at FROM ai_models WHERE user_id = ? ORDER BY is_primary DESC, id DESC'
  ).all(1);
  assert(models.length === 1 && models[0].latency_ms === 12 && /^\d{4}-\d{2}-\d{2} /.test(models[0].verified_at),
    'model insert with datetime(now)');
  await db.prepare("UPDATE ai_models SET status = 'CONNECTED', verified_at = datetime('now'), latency_ms = ?, last_error = '', last_error_category = '' WHERE id = ?")
    .run(25, 1);
  const m2 = await db.prepare('SELECT * FROM ai_models WHERE id = ? AND user_id = ?').get(1, 1);
  assert(m2.latency_ms === 25 && m2.last_error === '', 'model update mixed literals/params');
  await db.prepare('UPDATE ai_models SET is_primary = 0 WHERE user_id = ?').run(1);
  await db.prepare('UPDATE ai_models SET is_primary = 1 WHERE id = ?').run(1);
  await db.prepare('UPDATE ai_models SET enabled = ?, status = ? WHERE id = ?').run(0, 'DISABLED', 1);
  const m3 = await db.prepare('SELECT * FROM ai_models WHERE id = ? AND user_id = ?').get(1, 1);
  assert(m3.enabled === 0 && m3.status === 'DISABLED' && m3.is_primary === 1, 'primary/enabled updates');
  await db.prepare('DELETE FROM ai_models WHERE id = ?').run(1);
  const m4 = await db.prepare('SELECT * FROM ai_models WHERE id = ? AND user_id = ?').get(1, 1);
  assert(!m4, 'model delete');

  // ── trades / trade_history / GROUP BY ────────────────────────
  console.log('trades / trade_history');
  const tInfo = await db.prepare(
    `INSERT INTO trades (user_id, kind, symbol, instrument, signal, entry_zone, entry_price, target, stop_loss, timeframe, risk, confidence, reason, high_confidence)
     VALUES (?, 'option', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(1, 'NIFTY 24000 CE', 'inst', 'BUY', '24000', '24000', '24500', '23900', 'intraday', 'medium', 80, 'reason', 1);
  const tradeId = tInfo.lastInsertRowid;
  const listed = await db.prepare("SELECT * FROM trades WHERE user_id = ? AND status = 'ACTIVE' AND kind = 'option' AND signal = 'BUY' AND confidence >= ? ORDER BY id DESC")
    .all(1, 50);
  assert(listed.length === 1 && listed[0].id === tradeId && listed[0].status === 'ACTIVE', 'listTrades filter (literal + param)');
  await db.prepare(
    `UPDATE trades SET status = ?, final_price = ?, closed_at = ?,
       highest_price = COALESCE(highest_price, ''), lowest_price = COALESCE(lowest_price, ''),
       updated_at = ? WHERE id = ?`
  ).run('TARGET_REACHED', '24500', '2026-08-17T09:30:00.000Z', '2026-08-17T09:30:00.000Z', tradeId);
  const closed = await db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
  assert(closed.status === 'TARGET_REACHED' && closed.highest_price === '' && closed.final_price === '24500', 'closeTrade COALESCE keeps values');
  await db.prepare('UPDATE trades SET highest_price = ?, lowest_price = ?, updated_at = ? WHERE id = ?')
    .run('24600', '23950', '2026-08-17T10:00:00.000Z', tradeId);
  const mon = await db.prepare('SELECT highest_price, lowest_price FROM trades WHERE id = ?').get(tradeId);
  assert(mon.highest_price === '24600' && mon.lowest_price === '23950', 'monitor high/low update');

  await db.prepare(
    `INSERT INTO trade_history
     (trade_id, user_id, kind, symbol, instrument, signal, entry_price, target, stop_loss,
      confidence, reason, generated_at, closed_at, highest_price, lowest_price, final_price,
      final_status, result, timeframe, risk)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(tradeId, 1, 'option', 'NIFTY 24000 CE', 'inst', 'BUY', '24000', '24500', '23900', 80, 'reason',
    '2026-08-17T08:00:00.000Z', '2026-08-17T09:30:00.000Z', '24600', '23950', '24500', 'TARGET_REACHED', 'Success', 'intraday', 'medium');
  const hist2 = await db.prepare('SELECT * FROM trade_history WHERE user_id = ? AND closed_at >= ? ORDER BY id DESC LIMIT ?')
    .all(1, '2026-08-01T00:00:00.000Z', 200);
  assert(hist2.length === 1 && hist2[0].result === 'Success', 'trade history query');
  const perf = await db.prepare("SELECT final_status, COUNT(*)::int AS c FROM trade_history WHERE user_id = ? AND closed_at >= ? GROUP BY final_status")
    .all(1, '2026-08-01T00:00:00.000Z');
  assert(perf.length === 1 && perf[0].final_status === 'TARGET_REACHED' && perf[0].c === 1, 'GROUP BY performance stats');
  const activeCount = await db.prepare("SELECT COUNT(*)::int AS c FROM trades WHERE user_id = ? AND status = 'ACTIVE'").get(1);
  assert(activeCount.c === 0, 'active trade count');

  // ── analyses ─────────────────────────────────────────────────
  console.log('analyses');
  await db.prepare(
    `INSERT INTO analyses (user_id, kind, symbol, current_price, market_trend, news_sentiment, ai_signal, target, stop_loss, timeframe, risk, confidence, reason)
     VALUES (?, 'stock', ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(1, 'RELIANCE', 'bullish', 'BUY', '3000', '2900', '1-3 months', 'medium', 75, 'reason');
  const analyses = await db.prepare('SELECT * FROM analyses WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT 100').all(1, 'stock');
  assert(analyses.length === 1 && analyses[0].symbol === 'RELIANCE', 'analyses insert + list');

  // ── LIKE ─────────────────────────────────────────────────────
  console.log('LIKE');
  const like = await db.prepare(
    `SELECT title, source, published_at, raw FROM news_articles WHERE title LIKE ? OR raw LIKE ? ORDER BY published_at DESC LIMIT 15`
  ).all('%title b%', '%title b%');
  assert(like.length === 1 && like[0].title === 'Title B', 'LIKE ? OR LIKE ? (case-insensitive)');

  console.log(`\n${checks} checks, ${failures} failures`);
  await cleanup();
  await db.client.close();
  process.exit(failures ? 1 : 0);
})().catch(async (e) => {
  console.error('\nSELF-CHECK CRASHED:', e.message);
  try { await cleanup(); await db.client.close(); } catch (e2) { /* ignore */ }
  process.exit(1);
});
