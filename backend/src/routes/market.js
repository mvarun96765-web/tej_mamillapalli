const express = require('express');
const angleOne = require('../services/angleOneService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── Live stream (SSE) ──────────────────────────────────────────
// Pushes the 1-second Angel One SmartStream snapshot to connected apps.
const sseClients = new Set();

function sseSend(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch (_) {}
}

function broadcast(payload) {
  for (const res of sseClients) sseSend(res, payload);
}

angleOne.onLiveTick(broadcast);

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const snap = angleOne.getLiveSnapshot();
  if (snap) sseSend(res, snap);
  sseClients.add(res);

  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 15_000);
  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

async function wrap(fn, res) {
  try {
    const data = await fn();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
}

router.get('/indices', (req, res) => wrap(() => angleOne.getIndices(), res));

router.get('/gainers/stocks', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 25);
  wrap(() => angleOne.getTopStockGainers(limit), res);
});

router.get('/gainers/options', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 25);
  wrap(() => angleOne.getTopOptionGainers(limit), res);
});

router.get('/losers/stocks', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 25);
  wrap(() => angleOne.getTopStockLosers(limit), res);
});

router.get('/losers/options', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 25);
  wrap(() => angleOne.getTopOptionLosers(limit), res);
});

/**
 * Combined payload the Dashboard loads in one call. Indices and stock movers
 * come from the live WebSocket snapshot (instant); option movers need the
 * rate-limited option-chain search, so they're bounded by a short timeout and
 * degrade gracefully to `{ error }` instead of hanging the dashboard.
 */
const settle = (p, ms = 7000) => Promise.race([
  p.then((value) => ({ ok: true, value }), (e) => ({ ok: false, error: e.message })),
  new Promise((r) => setTimeout(() => r({ ok: false, error: 'Timed out' }), ms)),
]);

router.get('/dashboard', async (req, res) => {
  try {
    const [indices, stockGainers, optionGainers, stockLosers, optionLosers] = await Promise.all([
      settle(angleOne.getIndices()),
      settle(angleOne.getTopStockGainers(10)),
      settle(angleOne.getTopOptionGainers(10), 9000),
      settle(angleOne.getTopStockLosers(10)),
      settle(angleOne.getTopOptionLosers(10), 9000),
    ]);
    const pick = (r) => (r.ok ? r.value : { error: r.error });
    res.json({
      ok: true,
      data: {
        indices: pick(indices),
        topStocks: pick(stockGainers),
        topOptions: pick(optionGainers),
        topStockLosers: pick(stockLosers),
        topOptionLosers: pick(optionLosers),
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/search', (req, res) => wrap(() => angleOne.searchInstruments(req.query.q), res));

/** Candlestick history for a stock or option (live graph data). */
router.get('/candles', (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 120, 500);
  wrap(() => angleOne.getCandles({
    symbol: req.query.symbol, kind: req.query.kind || 'stock',
    interval: req.query.interval || 'ONE_DAY', days,
  }), res);
});

/** Detail screen payload: live quote + today's range + 52-week range + fundamentals. */
router.get('/details', (req, res) => {
  wrap(() => angleOne.getInstrumentDetails({
    symbol: req.query.symbol, kind: req.query.kind || 'stock',
  }), res);
});

router.get('/status', (req, res) => {
  res.json({ ok: true, data: angleOne.getLoginStatus() });
});

module.exports = router;
