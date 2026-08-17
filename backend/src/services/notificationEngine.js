const db = require('../db');
const config = require('../config');

const PREF_COLUMNS = [
  'new_trade', 'high_confidence_trade', 'trade_update', 'target_reached',
  'stop_loss_alert', 'new_stock_opportunity', 'new_option_opportunity',
  'market_alert', 'important_news', 'major_company_news', 'bullish_news',
  'bearish_news', 'news_analysis_completed', 'ai_analysis_completed',
  'daily_market_summary', 'market_open', 'market_close',
];

/**
 * Create a notification for a user.
 * If the user's preference for `type` is OFF, no notification is stored or pushed.
 * Never throws — DB errors are logged and swallowed so callers can fire-and-forget.
 */
async function notify(userId, type, title, body, data = {}) {
  try {
    const pref = await db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(userId);
    if (!pref) {
      // Default table row always exists for registered users; be safe anyway.
      await db.prepare('INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)').run(userId);
      const fresh = await db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(userId);
      if (!fresh || !fresh[type]) return null;
    } else if (!pref[type]) {
      return null; // user disabled this notification type -> do nothing
    }

    const info = await db.prepare(
      'INSERT INTO notifications (user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, type, title, body || '', JSON.stringify(data || {}));

    sendPush(userId, type, title, body).catch((e) => console.error('[push]', e.message));

    return { id: info.lastInsertRowid, type, title, body };
  } catch (e) {
    console.error('[notification]', e.message);
    return null;
  }
}

async function sendPush(userId, type, title, body) {
  // FCM is wired here. Requires FCM_SERVICE_ACCOUNT_JSON and a device token
  // registry; both can be added without touching the rest of the app.
  if (!config.fcmServiceAccountJson) return;
  // ...send to the user's registered device tokens...
  console.log(`[push:${type}] user=${userId} "${title}"`);
}

module.exports = { notify, PREF_COLUMNS };
