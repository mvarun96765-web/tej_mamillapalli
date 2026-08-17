const db = require('../db');
const angleOne = require('./angleOneService');
const notificationEngine = require('./notificationEngine');

/**
 * Trade lifecycle monitor.
 *
 * During market hours it watches every ACTIVE trade against live prices:
 *   - updates highest/lowest price seen
 *   - closes the trade (TARGET_REACHED / STOP_LOSS_REACHED) the moment a level is hit
 * At market close it finalizes any remaining active trade as EXPIRED_AT_MARKET_CLOSE
 * (never success/loss) and archives the complete record to trade_history.
 */

const TARGET_REACHED = 'TARGET_REACHED';
const STOP_LOSS_REACHED = 'STOP_LOSS_REACHED';
const EXPIRED_AT_MARKET_CLOSE = 'EXPIRED_AT_MARKET_CLOSE';
const CANCELLED = 'CANCELLED';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

async function activeTrades() {
  return db.prepare("SELECT * FROM trades WHERE status = 'ACTIVE'").all();
}

/** Resolve an AI-generated symbol to a tradable Angel One instrument. */
async function resolveInstrument(trade) {
  if (trade.kind === 'option') {
    const m = String(trade.symbol || '').match(/^(NIFTY|BANKNIFTY)\s+(\d+)\s+(CE|PE)$/i);
    if (m) {
      try {
        const chain = await angleOne.getOptionChain();
        const hit = chain.find((p) => p.strike === parseInt(m[2], 10) && p.optionType === m[3].toUpperCase());
        if (hit) return { exchange: 'NFO', token: hit.token, symbol: hit.symbol };
      } catch (e) {
        return null;
      }
    }
    return null;
  }
  // stock
  const token = await angleOne.resolveToken(String(trade.symbol || '').toUpperCase());
  return token ? { exchange: 'NSE', token, symbol: trade.symbol } : null;
}

/** Fetch one live quote for an instrument (best-effort). */
async function fetchQuote(exchange, token) {
  try {
    const quotes = await angleOne.getQuotesCached({ [exchange]: [token] });
    return quotes.find((q) => q.token === token) || null;
  } catch (e) {
    return null;
  }
}

async function archive(trade, { finalStatus, finalPrice, closedAt }) {
  const result = finalStatus === TARGET_REACHED ? 'Success'
    : finalStatus === STOP_LOSS_REACHED ? 'Loss'
    : finalStatus === CANCELLED ? 'Cancelled'
    : 'Expired';
  await db.prepare(
    `INSERT INTO trade_history
     (trade_id, user_id, kind, symbol, instrument, signal, entry_price, target, stop_loss,
      confidence, reason, generated_at, closed_at, highest_price, lowest_price, final_price,
      final_status, result, timeframe, risk)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    trade.id, trade.user_id, trade.kind, trade.symbol, trade.instrument || '', trade.signal,
    trade.entry_price || trade.entry_zone || '', trade.target || '', trade.stop_loss || '',
    trade.confidence || 0, trade.reason || '', trade.created_at || '',
    closedAt || new Date().toISOString(),
    trade.highest_price || '', trade.lowest_price || '',
    finalPrice !== null && finalPrice !== undefined ? String(finalPrice) : '',
    finalStatus, result, trade.timeframe || '', trade.risk || ''
  );
}

async function closeTrade(trade, finalStatus, { finalPrice, notify = true } = {}) {
  const closedAt = new Date().toISOString();
  await db.prepare(
    `UPDATE trades SET status = ?, final_price = ?, closed_at = ?,
       highest_price = COALESCE(highest_price, ''), lowest_price = COALESCE(lowest_price, ''),
       updated_at = ? WHERE id = ?`
  ).run(finalStatus, finalPrice !== null && finalPrice !== undefined ? String(finalPrice) : '', closedAt, closedAt, trade.id);
  await archive(trade, { finalStatus, finalPrice, closedAt });

  if (notify) {
    if (finalStatus === TARGET_REACHED) {
      await notificationEngine.notify(trade.user_id, 'target_reached', 'Target Reached',
        `${trade.symbol} reached its target of ${trade.target}.`, { tradeId: trade.id });
    } else if (finalStatus === STOP_LOSS_REACHED) {
      await notificationEngine.notify(trade.user_id, 'stop_loss_alert', 'Stop Loss Alert',
        `${trade.symbol} hit its stop loss of ${trade.stop_loss}.`, { tradeId: trade.id });
    }
  }
  return finalStatus;
}

/** One monitoring pass over all active trades. */
async function monitorOnce() {
  const trades = await activeTrades();
  if (!trades.length) return { checked: 0, closed: [] };

  const closed = [];
  for (const t of trades) {
    const instrument = await resolveInstrument(t);
    if (!instrument) continue; // cannot price-track yet (symbol not resolvable)
    const quote = await fetchQuote(instrument.exchange, instrument.token);
    if (!quote || quote.ltp <= 0) continue;

    const ltp = quote.ltp;
    const target = num(t.target);
    const stop = num(t.stop_loss);

    // Track high / low
    const high = Math.max(num(t.highest_price) || 0, ltp);
    const low = Math.min(num(t.lowest_price) || (num(t.entry_price) || ltp), ltp);
    await db.prepare('UPDATE trades SET highest_price = ?, lowest_price = ?, updated_at = ? WHERE id = ?')
      .run(String(high), String(low), new Date().toISOString(), t.id);
    t.highest_price = String(high);
    t.lowest_price = String(low);

    let status = null;
    if (target !== null && ltp >= target) status = TARGET_REACHED;
    else if (stop !== null && ltp <= stop) status = STOP_LOSS_REACHED;

    if (status) {
      await closeTrade(t, status, { finalPrice: ltp });
      closed.push({ tradeId: t.id, symbol: t.symbol, status });
    }
  }
  return { checked: trades.length, closed };
}

/** Called at market close: finalize every remaining ACTIVE trade as expired. */
async function finalizeAtClose() {
  const trades = await activeTrades();
  const closed = [];
  for (const t of trades) {
    const instrument = await resolveInstrument(t);
    let finalPrice = null;
    if (instrument) {
      const quote = await fetchQuote(instrument.exchange, instrument.token);
      if (quote && quote.ltp > 0) finalPrice = quote.ltp;
    }
    await closeTrade(t, EXPIRED_AT_MARKET_CLOSE, { finalPrice, notify: false });
    closed.push({ tradeId: t.id, symbol: t.symbol, status: EXPIRED_AT_MARKET_CLOSE, finalPrice });
  }
  return { closed };
}

// ── Performance / history ────────────────────────────────────

/** Closed trade records for the last `hours` (default 24h). */
async function listHistory(userId, { hours = 24, limit = 200 } = {}) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return db.prepare(
    'SELECT * FROM trade_history WHERE user_id = ? AND closed_at >= ? ORDER BY id DESC LIMIT ?'
  ).all(userId, cutoff, limit);
}

/** 24h performance summary used by the Settings -> Trade Performance screen. */
async function performanceStats(userId, { hours = 24 } = {}) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await db.prepare(
    "SELECT final_status, COUNT(*)::int AS c FROM trade_history WHERE user_id = ? AND closed_at >= ? GROUP BY final_status"
  ).all(userId, cutoff);

  const counts = { TARGET_REACHED: 0, STOP_LOSS_REACHED: 0, EXPIRED_AT_MARKET_CLOSE: 0, CANCELLED: 0 };
  for (const r of rows) counts[r.final_status] = (counts[r.final_status] || 0) + r.c;

  const total = rows.reduce((s, r) => s + r.c, 0);
  const success = counts.TARGET_REACHED;
  const loss = counts.STOP_LOSS_REACHED;
  const expired = counts.EXPIRED_AT_MARKET_CLOSE;
  const cancelled = counts.CANCELLED;

  const active = await db.prepare(
    "SELECT COUNT(*)::int AS c FROM trades WHERE user_id = ? AND status = 'ACTIVE'"
  ).get(userId);

  return {
    windowHours: hours,
    total,
    successful: success,
    loss,
    expired,
    cancelled,
    // Expired trades are shown separately and never inflate success/loss rates.
    successRate: total ? Math.round((success / total) * 100) : 0,
    lossRate: total ? Math.round((loss / total) * 100) : 0,
    activeCount: active ? active.c : 0,
  };
}

module.exports = {
  TARGET_REACHED, STOP_LOSS_REACHED, EXPIRED_AT_MARKET_CLOSE, CANCELLED,
  monitorOnce, finalizeAtClose, listHistory, performanceStats,
};
