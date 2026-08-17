const express = require('express');
const keyManager = require('../services/aiKeyManager');
const pipeline = require('../services/aiPipeline');
const tradeMonitor = require('../services/tradeMonitor');
const { requireAuth } = require('../middleware/auth');
const wrap = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth);

// ── API keys ───────────────────────────────────────────────────
router.get('/keys', wrap(async (req, res) => {
  const work = parseInt(req.query.work, 10);
  const keys = work ? await keyManager.listKeys(req.user.id, work) : await keyManager.listAllKeys(req.user.id);
  res.json({ keys, works: keyManager.WORKS, maxPerWork: keyManager.MAX_KEYS_PER_WORK, providers: keyManager.PROVIDERS });
}));

router.put('/keys', wrap(async (req, res) => {
  const work = parseInt(req.body.work, 10);
  const out = await keyManager.saveKeys(req.user.id, work, req.body.slots || []);
  if (out.error) return res.status(400).json(out);
  res.json({ ok: true });
}));

router.delete('/keys/:id', wrap(async (req, res) => {
  const out = await keyManager.deleteKey(req.user.id, parseInt(req.params.id, 10));
  if (out.error) return res.status(404).json(out);
  res.json({ ok: true });
}));

router.post('/keys/:id/test', wrap(async (req, res) => {
  const out = await keyManager.testKey(req.user.id, parseInt(req.params.id, 10));
  if (out.error) return res.status(404).json(out);
  res.json(out);
}));

// ── AI models ──────────────────────────────────────────────────
router.get('/models', wrap(async (req, res) => {
  const models = await keyManager.listModels(req.user.id);
  res.json({ models, providers: keyManager.PROVIDERS });
}));

router.post('/models/verify', wrap(async (req, res) => {
  const out = await keyManager.verifyModel(req.user.id, req.body);
  res.json(out);
}));

router.post('/models/:id/test', wrap(async (req, res) => {
  const out = await keyManager.testModel(req.user.id, parseInt(req.params.id, 10));
  if (out.error) return res.status(404).json(out);
  res.json(out);
}));

router.post('/models', wrap(async (req, res) => {
  const out = await keyManager.saveModel(req.user.id, req.body);
  if (out.error) return res.status(400).json(out);
  res.json({ ok: true, id: out.id });
}));

router.put('/models/:id/primary', wrap(async (req, res) => {
  const out = await keyManager.setPrimary(req.user.id, parseInt(req.params.id, 10));
  if (out.error) return res.status(404).json(out);
  res.json({ ok: true });
}));

router.put('/models/:id/enabled', wrap(async (req, res) => {
  const out = await keyManager.setModelEnabled(req.user.id, parseInt(req.params.id, 10), !!req.body.enabled);
  if (out.error) return res.status(404).json(out);
  res.json({ ok: true });
}));

router.delete('/models/:id', wrap(async (req, res) => {
  const out = await keyManager.removeModel(req.user.id, parseInt(req.params.id, 10));
  if (out.error) return res.status(404).json(out);
  res.json({ ok: true });
}));

// ── Trades / analyses ──────────────────────────────────────────
router.get('/trades', wrap(async (req, res) => {
  const kind = req.query.kind;
  const trades = await pipeline.listTrades(req.user.id, kind ? { kind } : {});
  res.json({ trades });
}));

/** Closed trade records (last 24h by default) for performance tracking. */
router.get('/trades/history', wrap(async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours, 10) || 24, 720);
  const history = await tradeMonitor.listHistory(req.user.id, { hours });
  res.json({ history });
}));

/** 24h performance summary for the Settings -> Trade Performance screen. */
router.get('/trades/performance', wrap(async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours, 10) || 24, 720);
  const performance = await tradeMonitor.performanceStats(req.user.id, { hours });
  res.json({ performance });
}));

/** Manually trigger one monitoring pass (useful for testing). */
router.post('/trades/monitor', wrap(async (req, res) => {
  const out = await tradeMonitor.monitorOnce();
  res.json({ ok: true, ...out });
}));

router.get('/analyses', wrap(async (req, res) => {
  const kind = req.query.kind || 'stock';
  const analyses = await pipeline.listAnalyses(req.user.id, kind);
  res.json({ analyses });
}));

// ── Analysis jobs ──────────────────────────────────────────────
router.post('/analyze/historical', (req, res) => {
  const { symbol, companyName, query } = req.body;
  if (!symbol && !companyName && !query) return res.status(400).json({ error: 'Provide a symbol or company name' });
  const { jobId } = pipeline.startHistoricalAnalysis({ userId: req.user.id, symbol, companyName, query });
  res.json({ ok: true, jobId });
});

router.post('/analyze/symbol', (req, res) => {
  const { kind, symbol, companyName, currentPrice } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
  const k = kind === 'option' ? 'option' : 'stock';
  const { jobId } = pipeline.analyzeSymbol(req.user.id, { kind: k, symbol, companyName, currentPrice });
  res.json({ ok: true, jobId });
});

router.get('/jobs/:id', (req, res) => {
  const status = pipeline.jobStatus(`${req.user.id}:${req.params.id}`);
  if (!status) {
    const s = pipeline.jobStatus(req.params.id);
    if (!s) return res.status(404).json({ error: 'Job not found' });
    return res.json({ job: s });
  }
  res.json({ job: status });
});

// ── Manual news-pipeline trigger (for testing before scheduler) ─
router.post('/news/process', wrap(async (req, res) => {
  const out = await pipeline.processPendingNews(req.user.id);
  res.json({ ok: true, results: out });
}));

module.exports = router;
