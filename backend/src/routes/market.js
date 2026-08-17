const express = require('express');
const angleOne = require('../services/angleOneService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

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

/** Combined payload the Dashboard loads in one call. */
router.get('/dashboard', async (req, res) => {
  try {
    const [indices, stockGainers, optionGainers, stockLosers, optionLosers] = await Promise.allSettled([
      angleOne.getIndices(),
      angleOne.getTopStockGainers(10),
      angleOne.getTopOptionGainers(10),
      angleOne.getTopStockLosers(10),
      angleOne.getTopOptionLosers(10),
    ]);
    res.json({
      ok: true,
      data: {
        indices: indices.status === 'fulfilled' ? indices.value : { error: indices.reason.message },
        topStocks: stockGainers.status === 'fulfilled' ? stockGainers.value : { error: stockGainers.reason.message },
        topOptions: optionGainers.status === 'fulfilled' ? optionGainers.value : { error: optionGainers.reason.message },
        topStockLosers: stockLosers.status === 'fulfilled' ? stockLosers.value : { error: stockLosers.reason.message },
        topOptionLosers: optionLosers.status === 'fulfilled' ? optionLosers.value : { error: optionLosers.reason.message },
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
