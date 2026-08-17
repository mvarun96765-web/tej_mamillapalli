const db = require('../db');
const keyManager = require('./aiKeyManager');
const { extractJson } = require('./aiProviders');
const newsService = require('./newsService');
const notificationEngine = require('./notificationEngine');
const angleOne = require('./angleOneService');

// In-memory historical-analysis job registry (status surface for the app).
const jobs = new Map();

// A trade is only surfaced when the AI finds an OPTION opportunity with at least
// this potential-profit confidence. The app never forces a trade.
const MIN_TRADE_CONFIDENCE = 50;

function optionsEligible(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/\.(NS|NSE|BSE|BO)$/i, '').trim();
  return newsService.TRACKED_COMPANIES.has(s);
}

/** Parse the first number out of an AI-provided price string (single value rule). */
function firstPrice(value) {
  const m = String(value || '').match(/\d+(?:\.\d+)?/);
  return m ? m[0] : '';
}

function jsonPrompt(schema, content) {
  return `Respond with ONLY a valid JSON object, no markdown, no extra text.\nExpected shape: ${JSON.stringify(schema)}\n\nInput data:\n${content}`;
}

function jobStatus(jobId) {
  return jobs.get(jobId) || null;
}

function setJob(jobId, state) {
  jobs.set(jobId, { ...jobs.get(jobId), ...state, updatedAt: new Date().toISOString() });
}

async function stage(pipeline, userId, work, system, user) {
  const out = await keyManager.runWithRotation(userId, work, system, user);
  if (!out.configured) return { configured: false };
  if (out.error) throw new Error(out.error);
  try {
    return { configured: true, data: extractJson(out.text) };
  } catch (e) {
    throw new Error(`AI returned unparseable output for Work ${work}`);
  }
}

// ── News pipeline: one article through AI 1 -> AI 2 -> AI 3 ───
async function processNewsArticle(article, userId) {
  const record = await db.prepare('SELECT * FROM news_articles WHERE id = ?').get(article.id || article);
  if (!record) return { error: 'Article not found' };

  // ── AI MODEL 1: News Intelligence ──
  const s1 = await stage(
    { work: 1 }, userId, 1,
    'You are AI Model 1: News Intelligence. You classify market news. Decide if the news is duplicate, irrelevant, or relevant. If relevant, extract the company, sentiment (positive/negative/neutral), and potential impact.',
    jsonPrompt(
      { duplicate: 'bool', irrelevant: 'bool', relevant: 'bool', company: 'string', sentiment: '"positive"|"negative"|"neutral"', impact: 'string (short)', reason: 'string (short)' },
      JSON.stringify({ title: record.title, source: record.source, publishedAt: record.published_at, content: (record.raw || '').slice(0, 3000) })
    )
  );
  if (!s1.configured) return { configured: false };
  if (s1.data.duplicate || s1.data.irrelevant || !s1.data.relevant) {
    await db.prepare("INSERT INTO ai_reports (user_id, article_id, stage, kind, payload) VALUES (?, ?, 1, 'news', ?)")
      .run(userId, record.id, JSON.stringify({ ...s1.data, dropped: true }));
    return { dropped: true, reason: s1.data.reason };
  }
  // News must relate to a company that actually has available options.
  if (!optionsEligible(s1.data.company)) {
    await db.prepare("INSERT INTO ai_reports (user_id, article_id, stage, kind, payload) VALUES (?, ?, 1, 'news', ?)")
      .run(userId, record.id, JSON.stringify({ ...s1.data, dropped: true, reason: `Company ${s1.data.company} has no available options — filtered out` }));
    return { dropped: true, reason: `Company ${s1.data.company} has no available options` };
  }
  await db.prepare("INSERT INTO ai_reports (user_id, article_id, stage, kind, payload) VALUES (?, ?, 1, 'news', ?)")
    .run(userId, record.id, JSON.stringify(s1.data));

  // ── AI MODEL 2: Market Impact Analysis ──
  const s2 = await stage(
    { work: 2 }, userId, 2,
    'You are AI Model 2: Market Impact Analysis. Deeply analyze this market-relevant news. Determine why it matters, company impact, bullish/bearish potential, expected market reaction, impact strength, related stocks/options, risk factors, and supporting market context.',
    jsonPrompt(
      {
        company: 'string', whyItMatters: 'string', companyImpact: 'string',
        bullishPotential: 'string', bearishPotential: 'string', expectedReaction: 'string',
        impactStrength: '"low"|"medium"|"high"', relatedStocks: ['string'], relatedOptions: ['string'],
        riskFactors: ['string'], marketContext: 'string',
      },
      JSON.stringify(s1.data)
    )
  );
  if (!s2.configured) return { configured: false };
  await db.prepare("INSERT INTO ai_reports (user_id, article_id, stage, kind, payload) VALUES (?, ?, 2, 'news', ?)")
    .run(userId, record.id, JSON.stringify(s2.data));

  // ── AI MODEL 3: Final Trading Intelligence ──
  const s3 = await stage(
    { work: 3 }, userId, 3,
    'You are AI Model 3: Final Trading Intelligence. From the structured analysis, produce the final trading intelligence. Decide if this is a BUY or AVOID opportunity. Consider underlying, strike, expiry, option type, volatility, liquidity, trend, news impact. Provide entry zone, EXACTLY ONE target price, EXACTLY ONE stop-loss price, expected timeframe, risk level, confidence score (0-100), and reasoning summary. A trade is only worth surfacing when the potential profit is at least 50% — if the opportunity is weaker, too risky, or the potential profit is below 50%, set signal to AVOID. Never invent a trade. These are decision-support outputs, never guarantees.',
    jsonPrompt(
      {
        signal: '"BUY"|"AVOID"', opportunityType: '"option"',
        symbol: 'string', instrument: 'string', entryZone: 'string (single price)', target: 'string (single price)', stopLoss: 'string (single price)',
        timeframe: 'string', risk: '"low"|"medium"|"high"', confidence: 'number (0-100, potential profit probability)',
        highConfidence: 'bool', reasoning: 'string (2-3 sentences)',
      },
      JSON.stringify({ model1: s1.data, model2: s2.data })
    )
  );
  if (!s3.configured) return { configured: false };
  await db.prepare("INSERT INTO ai_reports (user_id, article_id, stage, kind, payload) VALUES (?, ?, 3, 'news', ?)")
    .run(userId, record.id, JSON.stringify(s3.data));

  const confidence = Math.max(0, Math.min(100, parseInt(s3.data.confidence, 10) || 0));
  const isTrade = s3.data.signal === 'BUY'
    && s3.data.opportunityType === 'option'
    && confidence >= MIN_TRADE_CONFIDENCE;

  if (isTrade) {
    const entry = firstPrice(s3.data.entryZone);
    const info = await db.prepare(
      `INSERT INTO trades (user_id, kind, symbol, instrument, signal, entry_zone, entry_price, target, stop_loss, timeframe, risk, confidence, reason, high_confidence)
       VALUES (?, 'option', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      s3.data.symbol || s1.data.company || 'UNKNOWN',
      s3.data.instrument || '', s3.data.signal, s3.data.entryZone || '', entry,
      firstPrice(s3.data.target), firstPrice(s3.data.stopLoss),
      s3.data.timeframe || '', s3.data.risk || 'medium',
      confidence,
      s3.data.reasoning || '', s3.data.highConfidence ? 1 : 0
    );
    const tradeId = info.lastInsertRowid;

    // Notifications (respect user preferences; disabled types are skipped).
    await notificationEngine.notify(userId, 'new_trade', 'New Trade', `${s3.data.symbol || s1.data.company} — AI identified a new options opportunity with ${confidence}% potential profit.`, { tradeId });
    if (s3.data.highConfidence) {
      await notificationEngine.notify(userId, 'high_confidence_trade', 'High-Confidence Trade', `${s3.data.symbol} — high-confidence signal detected.`, { tradeId });
    }
    await notificationEngine.notify(userId, 'new_option_opportunity', 'New Option Opportunity', `${s3.data.symbol} — Signal: ${s3.data.signal} · Confidence ${confidence}%`, { tradeId });
    return { tradeId, signal: s3.data.signal, symbol: s3.data.symbol, confidence, kind: 'option' };
  }

  await notificationEngine.notify(userId, 'important_news', 'Important News', `${s1.data.company || 'Market'} news detected: ${String(record.title).slice(0, 80)}`, { articleId: record.id });
  return { signal: 'AVOID', symbol: s3.data.symbol || s1.data.company };
}

/** Run the pipeline over all unprocessed stored news. */
async function processPendingNews(userId) {
  const pending = await db.prepare(
    "SELECT id FROM news_articles WHERE id > (SELECT COALESCE(MAX(article_id),0) FROM ai_reports WHERE user_id = ? AND kind = 'news') ORDER BY id LIMIT 20"
  ).all(userId);
  const results = [];
  for (const p of pending) {
    try {
      results.push(await processNewsArticle(p.id, userId));
    } catch (e) {
      results.push({ error: e.message });
    }
  }
  return results;
}

// ── Historical one-year analysis (async job with status) ──────
async function startHistoricalAnalysis({ userId, symbol, companyName, query }) {
  const jobId = `${userId}:${Date.now()}`;
  setJob(jobId, { status: 'preparing', message: 'Preparing historical analysis...' });

  (async () => {
    try {
      setJob(jobId, { status: 'collecting', message: 'Collecting data...' });
      const res = await newsService.collectCompanyNews(query || companyName || symbol);
      if (!res.configured) {
        setJob(jobId, { status: 'error', message: 'News API key not configured. Add MARKETAUX_API_KEY to backend/.env.' });
        return;
      }

      setJob(jobId, { status: 'filtering', message: 'Filtering news...' });
      const stored = await db.prepare(
        `SELECT * FROM news_articles WHERE title LIKE ? OR raw LIKE ? ORDER BY published_at DESC LIMIT 500`
      ).all(`%${query || companyName || symbol}%`, `%${query || companyName || symbol}%`);

      // Group into manageable batches (design rule: never one giant request).
      const batches = [];
      for (let i = 0; i < stored.length; i += 10) batches.push(stored.slice(i, i + 10));

      const stageResults = { model1: [], model2: [], model3: [] };
      let idx = 0;
      for (const batch of batches) {
        idx += 1;
        setJob(jobId, { status: 'analyzing', message: `AI Analysis 1/3 — batch ${idx}/${batches.length}...`, progress: idx / batches.length });
        try {
          const s1 = await stage(
            { work: 1 }, userId, 1,
            'You are AI Model 1: News Intelligence for historical analysis. For each article, classify relevance and sentiment. Output an array of results.',
            jsonPrompt({ results: [{ title: 'string', relevant: 'bool', sentiment: 'string', company: 'string', impact: 'string' }] },
              JSON.stringify(batch.map((a) => ({ title: a.title, source: a.source, publishedAt: a.published_at, content: (a.raw || '').slice(0, 1500) }))))
          );
          if (s1.configured) {
            stageResults.model1.push(...(Array.isArray(s1.data.results) ? s1.data.results : [s1.data]));
            await db.prepare("INSERT INTO ai_reports (user_id, article_id, stage, kind, payload) VALUES (?, NULL, 1, 'historical', ?)")
              .run(userId, JSON.stringify(s1.data));
          }
        } catch (e) { stageResults.model1.push({ error: e.message }); }
      }

      setJob(jobId, { status: 'analyzing', message: 'AI Analysis 2/3...' });
      const s2 = await stage(
        { work: 2 }, userId, 2,
        'You are AI Model 2: Market Impact Analysis for a historical news set. Summarize the company impact, trend drivers, bullish/bearish evidence and risk factors over the past year.',
        jsonPrompt({ companyImpact: 'string', keyDrivers: ['string'], bullishEvidence: 'string', bearishEvidence: 'string', riskFactors: ['string'], overallTrend: '"bullish"|"bearish"|"mixed"' },
          JSON.stringify(stageResults.model1.slice(0, 40)))
      );
      if (s2.configured) {
        stageResults.model2.push(s2.data);
        await db.prepare("INSERT INTO ai_reports (user_id, article_id, stage, kind, payload) VALUES (?, NULL, 2, 'historical', ?)")
          .run(userId, JSON.stringify(s2.data));
      }

      setJob(jobId, { status: 'analyzing', message: 'Final Analysis...' });
      const s3 = await stage(
        { work: 3 }, userId, 3,
        'You are AI Model 3: Final Trading Intelligence for a one-year historical analysis. Produce the final report with signal, entry zone, target, stop-loss, expected timeframe (1-3 months for stocks), risk, confidence and reasoning. These are decision-support outputs, never guarantees.',
        jsonPrompt({
          signal: '"BUY"|"WATCH"|"AVOID"', symbol: 'string', entryZone: 'string', target: 'string', stopLoss: 'string',
          timeframe: 'string', risk: 'string', confidence: 'number', reasoning: 'string', summary: 'string',
        }, JSON.stringify({ company: query || companyName || symbol, model1Summary: stageResults.model1, model2: stageResults.model2 }))
      );

      setJob(jobId, { status: 'saving', message: 'Saving final report...' });
      if (s3.configured) {
        stageResults.model3.push(s3.data);
        await db.prepare("INSERT INTO ai_reports (user_id, article_id, stage, kind, payload) VALUES (?, NULL, 3, 'historical', ?)")
          .run(userId, JSON.stringify(s3.data));
        await db.prepare(
          `INSERT INTO analyses (user_id, kind, symbol, current_price, market_trend, news_sentiment, ai_signal, target, stop_loss, timeframe, risk, confidence, reason)
           VALUES (?, 'stock', ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          userId, s3.data.symbol || query || companyName || symbol,
          s3.data.overallTrend || (s2.configured ? s2.data.overallTrend : '') || '',
          s3.data.signal || '', s3.data.target || '', s3.data.stopLoss || '',
          s3.data.timeframe || '', s3.data.risk || 'medium', Math.max(0, Math.min(100, parseInt(s3.data.confidence, 10) || 0)),
          s3.data.reasoning || ''
        );
        setJob(jobId, { status: 'completed', message: 'Completed', report: s3.data });
        await notificationEngine.notify(userId, 'ai_analysis_completed', 'AI Analysis Completed', `Historical analysis for ${query || companyName || symbol} is ready.`);
      } else {
        setJob(jobId, { status: 'error', message: 'AI keys not configured for Work 3.' });
      }
    } catch (e) {
      setJob(jobId, { status: 'error', message: e.message });
    }
  })();

  return { jobId };
}

// ── Market-hours opportunity re-check ─────────────────────────
// Plan requirement: an option may dip right after market open and only become
// a 50%+ opportunity later, because of new news or changing market conditions.
// Every recheck cycle the final-intelligence stage re-evaluates the live top
// option movers with fresh prices + the day's analyzed news, and adds a trade
// the moment an opportunity reaches the 50% threshold.
const RECHECK_LIMIT = 3;

async function recheckOpportunities(userId) {
  let gainers;
  try {
    gainers = await angleOne.getTopOptionGainers(RECHECK_LIMIT);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!gainers.length) return { ok: true, candidates: 0, created: [] };

  // Compact context: today's analyzed news (model 1/2 outputs) + recent stored headlines.
  const recent = await db.prepare(
    'SELECT title, source, published_at, raw FROM news_articles ORDER BY published_at DESC LIMIT 8'
  ).all();
  const marketContext = recent.map((n) => ({ title: n.title, source: n.source, publishedAt: n.published_at }));

  const created = [];
  for (const g of gainers) {
    try {
      const existing = await db.prepare(
        'SELECT id FROM trades WHERE user_id = ? AND symbol = ? AND status = ?'
      ).get(userId, g.symbol, 'ACTIVE');
      if (existing) continue; // already tracked

      const s3 = await stage(
        { work: 3 }, userId, 3,
        'You are AI Model 3: Final Trading Intelligence (intraday re-evaluation). An option that may have dipped at market open is being re-checked with FRESH live prices and the latest market news. Decide if it is now a BUY or AVOID opportunity. Provide entry zone (current price), EXACTLY ONE target price, EXACTLY ONE stop-loss, expected timeframe, risk, confidence score (0-100 = potential profit probability), and reasoning. Only signal BUY when potential profit is at least 50% and the option is liquid. Never invent a trade. Decision-support only, never a guarantee.',
        jsonPrompt(
          {
            signal: '"BUY"|"AVOID"', opportunityType: '"option"', symbol: 'string', instrument: 'string',
            entryZone: 'string (single price = current ltp)', target: 'string (single price)', stopLoss: 'string (single price)',
            timeframe: 'string', risk: '"low"|"medium"|"high"', confidence: 'number (0-100)', highConfidence: 'bool', reasoning: 'string',
          },
          JSON.stringify({
            option: { symbol: g.symbol, strike: g.strike, expiry: g.expiry, optionType: g.optionType, ltp: g.ltp, percentChange: g.percentChange, oi: g.oi, volume: g.volume },
            marketContext,
          })
        )
      );
      if (!s3.configured) return { ok: true, candidates: gainers.length, created, configured: false };

      const confidence = Math.max(0, Math.min(100, parseInt(s3.data.confidence, 10) || 0));
      if (s3.data.signal === 'BUY' && confidence >= MIN_TRADE_CONFIDENCE) {
        const info = await db.prepare(
          `INSERT INTO trades (user_id, kind, symbol, instrument, signal, entry_zone, entry_price, target, stop_loss, timeframe, risk, confidence, reason, high_confidence)
           VALUES (?, 'option', ?, ?, 'BUY', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          userId, g.symbol, g.symbol || '', String(g.ltp), String(g.ltp),
          firstPrice(s3.data.target), firstPrice(s3.data.stopLoss),
          s3.data.timeframe || 'intraday', s3.data.risk || 'medium', confidence,
          (s3.data.reasoning || '') + ` Re-evaluated at market price ${g.ltp}.`, s3.data.highConfidence ? 1 : 0
        );
        const tradeId = info.lastInsertRowid;
        await notificationEngine.notify(userId, 'new_trade', 'New Trade', `${g.symbol} — AI re-evaluation found a ${confidence}% potential-profit opportunity.`, { tradeId });
        created.push({ tradeId, symbol: g.symbol, confidence });
      }
    } catch (e) {
      // one bad candidate must not abort the cycle
    }
  }
  return { ok: true, candidates: gainers.length, created };
}

// ── On-demand stock / option analysis ─────────────────────────
async function analyzeSymbol(userId, { kind, symbol, companyName, currentPrice }) {
  const jobId = `${userId}:${Date.now()}`;
  setJob(jobId, { status: 'preparing', message: 'Preparing analysis...' });

  (async () => {
    try {
      const newsRes = await newsService.collectCompanyNews(companyName || symbol);
      const recent = await db.prepare(
        `SELECT title, source, published_at, raw FROM news_articles WHERE title LIKE ? OR raw LIKE ? ORDER BY published_at DESC LIMIT 15`
      ).all(`%${companyName || symbol}%`, `%${companyName || symbol}%`);

      setJob(jobId, { status: 'analyzing', message: 'AI Analysis 1/3...' });
      const s1 = await stage(
        { work: 1 }, userId, 1,
        'You are AI Model 1: News Intelligence.',
        jsonPrompt({ relevant: 'bool', sentiment: 'string', company: 'string', summary: 'string' },
          JSON.stringify({ symbol, currentPrice, news: recent.map((n) => ({ title: n.title, publishedAt: n.published_at })) }))
      );

      setJob(jobId, { status: 'analyzing', message: 'AI Analysis 2/3...' });
      const s2 = await stage(
        { work: 2 }, userId, 2,
        'You are AI Model 2: Market Impact Analysis.',
        jsonPrompt({ marketTrend: '"bullish"|"bearish"|"neutral"', companyImpact: 'string', riskFactors: ['string'] },
          JSON.stringify(s1.configured ? s1.data : { sentiment: 'unknown' }))
      );

      setJob(jobId, { status: 'analyzing', message: 'Final Analysis...' });
      const s3 = await stage(
        { work: 3 }, userId, 3,
        'You are AI Model 3: Final Trading Intelligence for a stock/option. Provide signal, entry zone, target, stop-loss, timeframe (1-3 months for stocks), risk, confidence and reasoning. Decision-support only, never guarantees.',
        jsonPrompt({
          signal: '"BUY"|"WATCH"|"AVOID"', symbol: 'string', entryZone: 'string', target: 'string', stopLoss: 'string',
          timeframe: 'string', risk: 'string', confidence: 'number', reasoning: 'string',
        }, JSON.stringify({ kind, symbol, currentPrice, model1: s1.configured ? s1.data : {}, model2: s2.configured ? s2.data : {} }))
      );

      if (!s3.configured) {
        setJob(jobId, { status: 'error', message: 'AI keys not configured.' });
        return;
      }
      setJob(jobId, { status: 'saving', message: 'Saving result...' });
      await db.prepare(
        `INSERT INTO analyses (user_id, kind, symbol, current_price, market_trend, news_sentiment, ai_signal, target, stop_loss, timeframe, risk, confidence, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        userId, kind, s3.data.symbol || symbol, String(currentPrice ?? ''),
        s2.configured ? s2.data.marketTrend : '', s1.configured ? s1.data.sentiment : '',
        s3.data.signal, s3.data.target || '', s3.data.stopLoss || '', s3.data.timeframe || '',
        s3.data.risk || 'medium', Math.max(0, Math.min(100, parseInt(s3.data.confidence, 10) || 0)), s3.data.reasoning || ''
      );
      setJob(jobId, { status: 'completed', message: 'Completed', report: s3.data });
      await notificationEngine.notify(userId, 'ai_analysis_completed', 'AI Analysis Completed', `Analysis for ${symbol} is ready.`);
    } catch (e) {
      setJob(jobId, { status: 'error', message: e.message });
    }
  })();

  return { jobId };
}

// The active Trades section shows ONLY options the AI rated with >=50%
// potential profit, and only while the trade is still ACTIVE. Closed trades
// move to trade_history (performance tracking) and disappear from this list.
async function listTrades(userId, { kind } = {}) {
  return db.prepare(
    "SELECT * FROM trades WHERE user_id = ? AND status = 'ACTIVE' AND kind = 'option' AND signal = 'BUY' AND confidence >= ? ORDER BY id DESC"
  ).all(userId, MIN_TRADE_CONFIDENCE);
}

async function listAnalyses(userId, kind) {
  return db.prepare('SELECT * FROM analyses WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT 100').all(userId, kind);
}

module.exports = {
  processNewsArticle, processPendingNews, startHistoricalAnalysis, analyzeSymbol,
  recheckOpportunities,
  listTrades, listAnalyses, jobStatus,
};
