const db = require('../db');
const config = require('../config');
const newsService = require('./newsService');
const pipeline = require('./aiPipeline');
const notificationEngine = require('./notificationEngine');
const tradeMonitor = require('./tradeMonitor');

const INTERVAL_MS = config.news.intervalSeconds * 1000; // 220s -> every 3m40s
const RECHECK_MS = 20 * 60 * 1000; // market-hours opportunity re-evaluation cadence

let nextRunAt = null;
let timer = null;
let dayKey = '';
let marketDayKey = '';
let lastRecheckAt = 0;
let recheckBusy = false;

function nowIstParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.market.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { year: get('year'), month: get('month'), day: get('day'), hour: parseInt(get('hour'), 10), minute: parseInt(get('minute'), 10), second: parseInt(get('second'), 10) };
}

function inWindow(openHour, openMinute, closeHour, closeMinute) {
  const p = nowIstParts();
  const nowMin = p.hour * 60 + p.minute;
  const open = openHour * 60 + openMinute;
  const close = closeHour * 60 + closeMinute;
  return nowMin >= open && nowMin <= close;
}

/** News collection window: 08:00 - 14:00 IST (~98 requests at 3m40s, fits 100/day cap). */
function inNewsWindow() {
  return inWindow(config.news.windowOpenHour, config.news.windowOpenMinute, config.news.windowCloseHour, config.news.windowCloseMinute);
}

/** Market analysis window: 09:00 - 15:00 IST (used for monitoring + open/close notifications). */
function inMarketWindow() {
  return inWindow(config.market.openHour, config.market.openMinute, config.market.closeHour, config.market.closeMinute);
}

/** All users that have AI keys configured (personal-use app, usually one). */
async function usersWithKeys() {
  return (await db.prepare('SELECT DISTINCT user_id FROM ai_keys WHERE enabled = 1').all()).map((r) => r.user_id);
}

async function allUsers() {
  return (await db.prepare('SELECT id FROM users').all()).map((r) => r.id);
}

/** News collection -> AI pipeline for every user with keys configured. */
async function runCollection() {
  try {
    const out = await newsService.collectNews();
    console.log(`[scheduler] news collection ->`, JSON.stringify(out));

    const users = await usersWithKeys();
    for (const uid of users) {
      try {
        const results = await pipeline.processPendingNews(uid);
        console.log(`[scheduler] pipeline user=${uid} ->`, JSON.stringify(results));
      } catch (e) {
        console.error(`[scheduler] pipeline user=${uid} error:`, e.message);
      }
    }
  } catch (e) {
    console.error('[scheduler] collection error:', e.message);
  }
}

/** Trade lifecycle pass: watch active trades against live prices. */
async function runTradeMonitor() {
  try {
    const out = await tradeMonitor.monitorOnce();
    if (out.closed.length) console.log('[scheduler] trade monitor closed:', JSON.stringify(out.closed));
  } catch (e) {
    console.error('[scheduler] trade monitor error:', e.message);
  }
}

/** Plan req.: re-evaluate live option movers during market hours (dip-then-recover). */
async function runOpportunityRecheck() {
  if (recheckBusy) return;
  recheckBusy = true;
  try {
    for (const uid of await usersWithKeys()) {
      try {
        const out = await pipeline.recheckOpportunities(uid);
        if (out.created && out.created.length) console.log(`[scheduler] recheck user=${uid} ->`, JSON.stringify(out.created));
      } catch (e) {
        console.error(`[scheduler] recheck user=${uid} error:`, e.message);
      }
    }
  } finally {
    recheckBusy = false;
  }
}

/** Market close: finalize remaining active trades as expired at market close. */
async function finalizeTrades() {
  try {
    const out = await tradeMonitor.finalizeAtClose();
    if (out.closed.length) console.log('[scheduler] finalize at close:', JSON.stringify(out.closed));
  } catch (e) {
    console.error('[scheduler] finalize error:', e.message);
  }
}

function scheduleNext() {
  // Next slot = last slot + interval; if that falls outside the window, next slot is tomorrow 08:00.
  const base = nextRunAt ? new Date(nextRunAt.getTime() + INTERVAL_MS) : todayAtOpen();
  if (!inNewsWindow()) {
    nextRunAt = null;
    return;
  }
  nextRunAt = base > new Date() ? base : new Date();
}

function todayAtOpen() {
  const p = nowIstParts();
  const date = new Date(`${p.year}-${p.month}-${p.day}T${String(config.news.windowOpenHour).padStart(2, '0')}:${String(config.news.windowOpenMinute).padStart(2, '0')}:00+05:30`);
  return date;
}

function start() {
  stop();
  console.log(`[scheduler] started. News window ${config.news.windowOpenHour}:00-${config.news.windowCloseHour}:00 IST every ${config.news.intervalSeconds}s; market window ${config.market.openHour}:00-${config.market.closeHour}:00 IST.`);

  let prevInMarket = null; // null = unknown until first tick, so no spurious open/close notification
  let prevInNews = null;
  let monitorBusy = false;

  timer = setInterval(() => {
    (async () => {
      const p = nowIstParts();
      const today = `${p.year}-${p.month}-${p.day}`;
      const inMarket = inMarketWindow();
      const inNews = inNewsWindow();

      if (marketDayKey !== today) {
        marketDayKey = today;
        prevInMarket = null;
        prevInNews = null;
        lastRecheckAt = 0;
      }

      // ── Market window transitions: open / close once each ─────
      if (inMarket) {
        if (prevInMarket === false) {
          const users = await allUsers();
          for (const u of users) notificationEngine.notify(u.id, 'market_open', 'Market Open', 'The Indian market session has begun.');
        }
        if (!monitorBusy) {
          monitorBusy = true;
          runTradeMonitor().finally(() => { monitorBusy = false; });
        }
        // Opportunity re-evaluation every 20 min (plan: dip-then-recover options).
        if (Date.now() - lastRecheckAt >= RECHECK_MS) {
          lastRecheckAt = Date.now();
          runOpportunityRecheck();
        }
      } else if (prevInMarket === true) {
        // Market closed: notify once and finalize remaining active trades as
        // EXPIRED_AT_MARKET_CLOSE (they are never forced into success/loss).
        const users = await allUsers();
        for (const u of users) notificationEngine.notify(u.id, 'market_close', 'Market Close', 'The Indian market session has ended.');
        finalizeTrades();
      }
      prevInMarket = inMarket;

      // ── News collection chain (08:00 - 14:00 IST) ─────────────
      if (inNews) {
        if (prevInNews !== true) nextRunAt = null; // fresh slot chain when the window opens
        if (!nextRunAt) {
          scheduleNext();
        } else if (new Date() >= nextRunAt) {
          runCollection();
          scheduleNext();
        }
      } else {
        nextRunAt = null; // window ended -> reset for tomorrow
      }
      prevInNews = inNews;
    })().catch((e) => console.error('[scheduler] tick error:', e.message));
  }, 15_000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function getStatus() {
  const p = nowIstParts();
  return {
    running: !!timer,
    intervalSeconds: config.news.intervalSeconds,
    inNewsWindow: inNewsWindow(),
    inMarketWindow: inMarketWindow(),
    nowIst: `${p.hour}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`,
    nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
  };
}

module.exports = { start, stop, getStatus };
