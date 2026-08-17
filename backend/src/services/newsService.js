const axios = require('axios');
const db = require('../db');
const config = require('../config');
const { sha256 } = require('../crypto');

// NSE F&O-eligible companies tracked by the app. Marketaux entity symbols are
// normalized (e.g. "RELIANCE.NS" -> "RELIANCE") before matching.
const TRACKED_COMPANIES = new Set([
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'HINDUNILVR', 'ITC', 'SBIN',
  'BHARTIARTL', 'KOTAKBANK', 'LT', 'AXISBANK', 'ASIANPAINT', 'MARUTI', 'TITAN', 'HCLTECH',
  'SUNPHARMA', 'ULTRACEMCO', 'BAJFINANCE', 'ADANIENT', 'ADANIPORTS', 'NTPC', 'POWERGRID',
  'TATAMOTORS', 'TATASTEEL', 'WIPRO', 'ONGC', 'COALINDIA', 'M&M', 'NESTLEIND', 'HDFCLIFE',
  'SBILIFE', 'DRREDDY', 'CIPLA', 'APOLLOHOSP', 'BAJAJFINSV', 'GRASIM', 'TECHM', 'TATAPOWER',
  'INDUSINDBK', 'EICHERMOT', 'HEROMOTOCO', 'DIVISLAB', 'BRITANNIA', 'BAJAJ-AUTO',
  'TATACONSUM', 'JSWSTEEL', 'HINDALCO', 'VEDL', 'UPL', 'SHREECEM', 'DLF', 'IOC', 'BPCL',
  'GAIL', 'HAL', 'SIEMENS', 'ABB', 'PIDILITIND', 'DABUR', 'COLPAL', 'HAVELLS', 'AMBUJACEM',
  'ACC', 'PAGEIND', 'DMART', 'ZOMATO', 'PAYTM', 'JIOFIN', 'TRENT', 'PERSISTENT', 'LTIM',
  'MPHASIS', 'TATAELXSI', 'INDIGO', 'GODREJCP', 'MARICO', 'TORNTPHARM', 'AUROPHARMA',
  'LUPIN', 'ALKEM', 'GLENMARK', 'BIOCON', 'ZYDUSLIFE', 'MUTHOOTFIN', 'CHOLAFIN',
  'SHRIRAMFIN', 'BAJAJHFL', 'SJVN', 'PFC', 'RECLTD', 'BEL', 'BHEL', 'IDEA', 'YESBANK',
  'PNB', 'BANKBARODA', 'CANBK', 'UNIONBANK', 'IDFCFIRSTB', 'FEDERALBNK', 'AUBANK', 'HUDCO',
  'LICHSGFIN', 'SBICARD', 'ICICIGI', 'ICICIPRULI', 'HDFCAMC', 'NYKAA', 'VBL', 'JUBLFOOD',
  'UNITDSPR', 'PGHH', 'AMBER', 'WHIRLPOOL', 'BLUESTARCO', 'VOLTAS', 'CROMPTON', 'BOSCHLTD',
  'MOTHERSON', 'TVSMOTOR', 'ASHOKLEY', 'ESCORTS', 'CUMMINSIND', 'THERMAX', 'KAYNES',
  'POLYCAB', 'SUPREMEIND', 'KALPATPOWR',
]);

const OVERLAP_MS = 30 * 60 * 1000; // overlap each incremental window to catch late-indexed articles
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000; // News API history kept for 24h
const OPTION_NEWS_KEEP = 10; // latest N articles retained per company

function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.market.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { year: get('year'), month: get('month'), day: get('day'), hour: parseInt(get('hour'), 10), minute: parseInt(get('minute'), 10), second: parseInt(get('second'), 10) };
}

function toIso(d) {
  return new Date(d).toISOString();
}

/** UTC ISO string for IST midnight -> convert IST wall-clock to a Date. */
function istWallClockToUtc(p) {
  return new Date(`${p.year}-${p.month}-${p.day}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:00+05:30`).toISOString();
}

/**
 * Catch-up start: previous day at 02:00 PM IST (config.news.prevDayCatchupHour).
 * News published between this moment and the window open is the overnight gap
 * that the first request of the day must cover.
 */
function prevDayCatchupStart() {
  const now = new Date();
  const p = istParts(now);
  const todayIst = new Date(`${p.year}-${p.month}-${p.day}T00:00:00+05:30`);
  const prevDay = new Date(todayIst.getTime() - 24 * 60 * 60 * 1000);
  const pp = istParts(prevDay);
  return istWallClockToUtc({
    year: pp.year, month: pp.month, day: pp.day,
    hour: config.news.prevDayCatchupHour, minute: config.news.prevDayCatchupMinute, second: 0,
  });
}

/** The published_after boundary for the next request. */
async function getCheckpoint() {
  const row = await db.prepare('SELECT last_published_from, last_checkpoint FROM news_checkpoint WHERE id = 1').get();
  if (row && row.last_published_from) return row.last_published_from;
  const fallback = prevDayCatchupStart();
  await db.prepare('INSERT OR IGNORE INTO news_checkpoint (id, last_checkpoint, last_published_from) VALUES (1, ?, ?)')
    .run(toIso(new Date()), fallback);
  return fallback;
}

async function setCheckpoint({ publishedFrom, requestedAt }) {
  await db.prepare(
    `INSERT INTO news_checkpoint (id, last_checkpoint, last_published_from) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_checkpoint = EXCLUDED.last_checkpoint, last_published_from = EXCLUDED.last_published_from`
  ).run(requestedAt || toIso(new Date()), publishedFrom || '');
}

/** Marketaux date format: Y-m-d\TH:i:s (UTC). */
function marketauxDate(iso) {
  const d = new Date(iso);
  return d.toISOString().replace(/\.\d{3}Z$/, '');
}

function normalizeSymbol(s) {
  return String(s || '').toUpperCase().replace(/\.(NS|NSE|BSE|BO)$/i, '').trim();
}

function fingerprint(article) {
  if (article.uuid) return `mx:${article.uuid}`;
  return sha256(`${article.source || ''}|${article.url || ''}|${article.title || ''}|${article.published_at || ''}`);
}

function companiesFor(article) {
  const out = new Set();
  for (const e of (article.entities || [])) {
    const sym = normalizeSymbol(e.symbol);
    if (TRACKED_COMPANIES.has(sym)) out.add(sym);
    else {
      // Match by name words as a fallback (e.g. "Reliance Industries Ltd").
      const name = String(e.name || '').toUpperCase();
      for (const c of TRACKED_COMPANIES) {
        if (name.includes(c.replace('-', ' '))) out.add(c);
      }
    }
  }
  return [...out];
}

/** Strip stale history (older than 24h) and per-company news (keep latest 10). */
async function prune() {
  const cutoff = new Date(Date.now() - HISTORY_RETENTION_MS).toISOString();
  await db.prepare('DELETE FROM news_history WHERE request_time < ?').run(cutoff);
  const companies = (await db.prepare('SELECT DISTINCT company FROM option_news').all()).map((r) => r.company);
  for (const c of companies) {
    const ids = (await db.prepare(
      'SELECT id FROM option_news WHERE company = ? ORDER BY published_at DESC, id DESC OFFSET ?'
    ).all(c, OPTION_NEWS_KEEP)).map((r) => r.id);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      await db.prepare(`DELETE FROM option_news WHERE company = ? AND id NOT IN (${ph})`).run(c, ...ids);
    }
  }
}

async function logHistory(row) {
  await db.prepare(
    `INSERT INTO news_history (request_time, requested_from, requested_to, returned, added, article_uuid, title, main_point, source, url, published_at, companies)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.requestTime, row.requestedFrom, row.requestedTo, row.returned || 0, row.added || 0,
    row.articleUuid || '', row.title || '', row.mainPoint || '', row.source || '', row.url || '',
    row.publishedAt || '', (row.companies || []).join(',')
  );
  await prune();
}

/** Store a collected article (dedupe by fingerprint) and link it to companies. */
async function storeArticle(a) {
  const fp = fingerprint(a);
  const contentHash = sha256(`${a.description || ''}|${a.snippet || ''}`.slice(0, 2000));
  const info = await db.prepare(
    `INSERT OR IGNORE INTO news_articles (fingerprint, source, url, title, published_at, content_hash, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(fp, a.source || '', a.url || '', a.title || '', a.published_at || '', contentHash, JSON.stringify(a));
  if (info.changes === 0) return null;

  const row = await db.prepare('SELECT id FROM news_articles WHERE fingerprint = ?').get(fp);
  const companies = companiesFor(a);
  const link = db.prepare('INSERT OR IGNORE INTO option_news (company, article_id, published_at) VALUES (?, ?, ?)');
  for (const c of companies) await link.run(c, row.id, a.published_at || '');
  return { id: row.id, companies };
}

/**
 * Collect news that became available since the last checkpoint (incremental).
 * - The first request of the day (08:00) covers the overnight gap: everything
 *   published after the previous day's 02:00 PM IST catch-up boundary.
 * - Later requests use a rolling window (previous `to` minus a 30-min overlap)
 *   so articles indexed late are not missed.
 * - Only articles relevant to F&O-eligible companies are stored; up to
 *   `NEWS_ARTICLES_PER_REQUEST` (3) articles are returned per request.
 */
async function collectNews() {
  if (!config.news.apiKey) {
    return { ok: true, configured: false, message: 'News API key not configured yet (set MARKETAUX_API_KEY in backend/.env)' };
  }

  const publishedFrom = await getCheckpoint();
  const publishedTo = toIso(new Date());
  // Rolling window: continue from the previous window end minus overlap, so we
  // never permanently skip the period if the provider indexes articles late.
  const windowFrom = publishedFrom < publishedTo ? publishedFrom : publishedTo;

  const url = `${config.news.baseUrl}/news/all`;
  const params = {
    api_token: config.news.apiKey,
    language: 'en',
    countries: 'in',
    must_have_entities: 'true',
    filter_entities: 'true',
    published_after: marketauxDate(windowFrom),
    published_before: marketauxDate(publishedTo),
    sort: 'published_at',
    limit: config.news.maxArticlesPerRequest,
  };

  let res;
  try {
    res = await axios.get(url, { params, timeout: 25_000 });
  } catch (e) {
    // A symbol filter could 400 on a symbol Marketaux doesn't know; fall back
    // to a country-wide fetch and filter locally.
    return { ok: true, configured: true, error: `Marketaux request failed: ${e.response?.status || e.code || e.message}` };
  }

  const articles = (res.data && Array.isArray(res.data.data)) ? res.data.data : [];
  const inserted = [];
  let added = 0;
  for (const a of articles) {
    if (!a || !a.title) continue;
    const stored = await storeArticle(a);
    if (stored) {
      added += 1;
      inserted.push({ article: a, companies: stored.companies });
    }
  }

  // Log every returned article into the News API history (Settings screen),
  // even duplicates — it shows what the API actually returned per request.
  const requestTime = toIso(new Date());
  for (const a of articles) {
    if (!a || !a.title) continue;
    await logHistory({
      requestTime,
      requestedFrom: marketauxDate(windowFrom),
      requestedTo: marketauxDate(publishedTo),
      returned: articles.length,
      added: 0,
      articleUuid: a.uuid || '',
      title: a.title,
      mainPoint: (a.description || a.snippet || '').slice(0, 300),
      source: a.source || '',
      url: a.url || '',
      publishedAt: a.published_at || '',
      companies: companiesFor(a),
    });
  }

  // Advance the checkpoint only on a successful request so a failure never
  // permanently skips the window.
  await setCheckpoint({ publishedFrom: publishedTo, requestedAt: requestTime });
  return {
    ok: true, configured: true,
    collected: articles.length, added,
    from: windowFrom, to: publishedTo,
    companies: [...new Set(inserted.flatMap((i) => i.companies))],
  };
}

/** On-demand news for one company (used by historical / symbol analysis jobs). */
async function collectCompanyNews(query, { from, to } = {}) {
  if (!config.news.apiKey) return { ok: true, configured: false, articles: [] };
  const symbol = normalizeSymbol(query);
  const toDate = to || toIso(new Date());
  const fromDate = from || toIso(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));

  const collected = [];
  const params = {
    api_token: config.news.apiKey,
    language: 'en',
    countries: 'in',
    symbols: symbol,
    filter_entities: 'true',
    must_have_entities: 'true',
    published_after: marketauxDate(fromDate),
    published_before: marketauxDate(toDate),
    sort: 'published_at',
    limit: config.news.maxArticlesPerRequest,
  };
  try {
    const res = await axios.get(`${config.news.baseUrl}/news/all`, { params, timeout: 25_000 });
    const articles = (res.data && Array.isArray(res.data.data)) ? res.data.data : [];
    for (const a of articles) {
      if (!a.title) continue;
      const stored = await storeArticle(a);
      collected.push({
        id: stored ? stored.id : fingerprint(a),
        title: a.title,
        source: a.source || '',
        url: a.url || '',
        publishedAt: a.published_at || '',
      });
    }
  } catch (e) {
    return { ok: true, configured: true, articles: [], error: e.response?.status || e.code || e.message };
  }
  return { ok: true, configured: true, articles: collected };
}

/** Recent stored news, optionally filtered by company (per-option news). */
async function listStoredNews({ limit = 50, since, company } = {}) {
  if (company) {
    return db.prepare(
      `SELECT n.* FROM news_articles n
       JOIN option_news on ON on.article_id = n.id
       WHERE on.company = ?
       ORDER BY n.published_at DESC LIMIT ?`
    ).all(company, limit);
  }
  if (since) {
    return db.prepare('SELECT * FROM news_articles WHERE published_at >= ? ORDER BY published_at DESC LIMIT ?')
      .all(since, limit);
  }
  return db.prepare('SELECT * FROM news_articles ORDER BY id DESC LIMIT ?').all(limit);
}

/** News API request history for the last 24 hours. */
async function listNewsHistory({ limit = 200 } = {}) {
  const cutoff = new Date(Date.now() - HISTORY_RETENTION_MS).toISOString();
  return db.prepare(
    'SELECT * FROM news_history WHERE request_time >= ? ORDER BY id DESC LIMIT ?'
  ).all(cutoff, limit);
}

/** Latest N news for a specific option/company. */
async function listOptionNews(company, { limit = OPTION_NEWS_KEEP } = {}) {
  return listStoredNews({ company, limit });
}

module.exports = {
  collectNews, collectCompanyNews, listStoredNews, listNewsHistory, listOptionNews,
  getCheckpoint, setCheckpoint, TRACKED_COMPANIES, OPTION_NEWS_KEEP,
};
