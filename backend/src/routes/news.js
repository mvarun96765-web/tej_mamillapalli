const express = require('express');
const newsService = require('../services/newsService');
const { requireAuth } = require('../middleware/auth');
const wrap = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth);

router.get('/recent', wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const since = req.query.since;
  const articles = await newsService.listStoredNews(since ? { since, limit } : { limit });
  res.json({ articles });
}));

router.post('/collect', wrap(async (req, res) => {
  const out = await newsService.collectNews();
  res.json(out);
}));

/** News API request history (last 24h, older entries auto-deleted). */
router.get('/history', wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const history = await newsService.listNewsHistory({ limit });
  res.json({ history });
}));

/** Latest news for one option/company (latest 10 retained per company). */
router.get('/option/:company', wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || newsService.OPTION_NEWS_KEEP, 20);
  const news = await newsService.listOptionNews(req.params.company, { limit });
  res.json({ company: req.params.company, news });
}));

module.exports = router;
