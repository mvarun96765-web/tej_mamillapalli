const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const wrap = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth);

const PREF_COLUMNS = [
  'new_trade', 'high_confidence_trade', 'trade_update', 'target_reached',
  'stop_loss_alert', 'new_stock_opportunity', 'new_option_opportunity',
  'market_alert', 'important_news', 'major_company_news', 'bullish_news',
  'bearish_news', 'news_analysis_completed', 'ai_analysis_completed',
  'daily_market_summary', 'market_open', 'market_close',
];

// ── Preferences ────────────────────────────────────────────────
router.get('/preferences', wrap(async (req, res) => {
  const row = await db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?')
    .get(req.user.id) || {};
  const prefs = {};
  for (const c of PREF_COLUMNS) prefs[c] = !!row[c];
  res.json({ preferences: prefs });
}));

router.put('/preferences', wrap(async (req, res) => {
  const prefs = req.body.preferences || {};
  const sets = [];
  const vals = [];
  for (const c of PREF_COLUMNS) {
    if (typeof prefs[c] === 'boolean') {
      sets.push(`${c} = ?`);
      vals.push(prefs[c] ? 1 : 0);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No valid preferences provided' });

  await db.prepare(`INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)`).run(req.user.id);
  await db.prepare(`UPDATE notification_preferences SET ${sets.join(', ')} WHERE user_id = ?`)
    .run(...vals, req.user.id);
  res.json({ ok: true });
}));

// ── Inbox / history ────────────────────────────────────────────
router.get('/inbox', wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
  const rows = await db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ).all(req.user.id, limit);
  const unread = await db.prepare(
    'SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = ? AND read = 0'
  ).get(req.user.id);
  res.json({ notifications: rows, unread: unread ? unread.c : 0 });
}));

router.put('/inbox/read', wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    await db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${placeholders})`)
      .run(req.user.id, ...ids);
  }
  res.json({ ok: true });
}));

router.put('/inbox/read-all', wrap(async (req, res) => {
  await db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(req.user.id);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.PREF_COLUMNS = PREF_COLUMNS;
