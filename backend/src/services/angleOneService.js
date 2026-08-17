const { SmartAPI } = require('smartapi-javascript');
const { authenticator } = require('otplib');
const config = require('../config');
const db = require('../db');

// Symbol NAMES only — tokens are resolved live from Angel One via searchScrip
// (never hardcoded) and cached for 24h.
const CATALOG_SYMBOLS = [
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
];

const QUOTE_CACHE_TTL_MS = 2000;
const SCRIP_TTL_MS = 24 * 60 * 60 * 1000;
const OPTION_CHAIN_TTL_MS = 15 * 60 * 1000;   // refresh option chain every 15 min
const SEARCH_GAP_MS = 2600;                   // searchScrip rate limit ~1 req / few seconds

const quoteCache = new Map();
let optionChainCache = { ts: 0, list: [] };

let smartApi = null;
let session = null;
let lastLoginError = '';
let lastSearchAt = 0;
let warmupDone = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function currentTotp() {
  if (!config.angelone.totpSecret) return '';
  return authenticator.generate(config.angelone.totpSecret);
}

/** Ensure we have a live Angel One session (login once, auto-reissue on expiry). */
async function ensureSession(force = false) {
  if (smartApi && session && !force && Date.now() < session.expiresAt - 60_000) return smartApi;

  const { apiKey, clientCode, pin, totpSecret } = config.angelone;
  if (!apiKey || !clientCode || !pin || !totpSecret) {
    const err = new Error('Angel One credentials are not configured in backend/.env');
    lastLoginError = err.message;
    throw err;
  }

  const client = new SmartAPI({ api_key: apiKey });
  const totp = currentTotp();
  const data = await client.generateSession(clientCode, pin, totp);
  if (!data || data.status !== true || !data.data) {
    lastLoginError = (data && data.message) || 'Angel One login failed';
    throw new Error(lastLoginError);
  }

  client.setSessionExpiryHook(() => {
    session = null;
    smartApi = null;
    console.warn('[angelone] session expired, will re-login on next request');
  });

  smartApi = client;
  session = {
    jwt: data.data.jwtToken,
    refresh: data.data.refreshToken,
    feedToken: data.data.feedToken,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
  lastLoginError = '';
  console.log('[angelone] session established');
  return client;
}

/** searchScrip respecting the broker's rate limit (sequential, spaced, retry once). */
async function searchScrip(exchange, query) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const wait = lastSearchAt + SEARCH_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastSearchAt = Date.now();
    try {
      const api = await ensureSession();
      const res = await api.searchScrip({ exchange, searchscrip: query });
      if (Array.isArray(res)) return res;
      if (res && (res.status === 403 || res.status === 429)) {
        await sleep(8000); // rate limited -> back off and retry
        continue;
      }
      return [];
    } catch (e) {
      await sleep(4000);
    }
  }
  return [];
}

function normalizeQuote(raw) {
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    symbol: String(raw.tradingSymbol || raw.tradingsymbol || raw.symbol || '').replace(/-EQ$/, ''),
    token: String(raw.symbolToken || raw.symboltoken || ''),
    exchange: raw.exchange || '',
    open: num(raw.open),
    high: num(raw.high),
    low: num(raw.low),
    close: num(raw.close),
    ltp: num(raw.ltp),
    netchange: num(raw.netChange !== undefined ? raw.netChange : raw.netchange),
    percentChange: num(raw.percentChange !== undefined ? raw.percentChange : raw.percentagechange),
    volume: num(raw.tradeVolume !== undefined ? raw.tradeVolume : raw.volume),
    oi: num(raw.opnInterest !== undefined ? raw.opnInterest : raw.openinterest),
    previousClose: num(raw.previousClose),
    week52High: num(raw['52WeekHigh']),
    week52Low: num(raw['52WeekLow']),
    lowerCircuit: num(raw.lowerCircuit),
    upperCircuit: num(raw.upperCircuit),
    buyQty: num(raw.totBuyQuan),
    sellQty: num(raw.totSellQuan),
    lastTradedTime: raw.exchFeedTime || '',
  };
}

async function marketData(exchangeTokens) {
  const api = await ensureSession();
  let res;
  try {
    res = await api.marketData({ mode: 'FULL', exchangeTokens });
  } catch (e) {
    if (String(e.message).toLowerCase().includes('token')) {
      await ensureSession(true);
      res = await api.marketData({ mode: 'FULL', exchangeTokens });
    } else {
      throw e;
    }
  }
  if (!res || res.status === false || !res.data) {
    throw new Error((res && res.message) || 'Market data unavailable');
  }
  return (res.data.fetched || []).map(normalizeQuote);
}

async function getQuotesCached(exchangeTokens) {
  const hits = [];
  const misses = {};
  for (const [ex, tokens] of Object.entries(exchangeTokens)) {
    for (const t of tokens) {
      const hit = quoteCache.get(`${ex}:${t}`);
      if (hit && Date.now() - hit.ts < QUOTE_CACHE_TTL_MS) hits.push(hit.value);
      else (misses[ex] = misses[ex] || []).push(t);
    }
  }
  const chunks = [];
  for (const [ex, tokens] of Object.entries(misses)) {
    for (let i = 0; i < tokens.length; i += 50) chunks.push({ [ex]: tokens.slice(i, i + 50) });
  }
  for (const chunk of chunks) {
    const fresh = await marketData(chunk);
    for (const q of fresh) {
      quoteCache.set(`${q.exchange}:${q.token}`, { ts: Date.now(), value: q });
      hits.push(q);
    }
  }
  return hits;
}

// ── Token resolution (data-driven; no hardcoded tokens) ────────
async function cachedToken(symbol) {
  const row = await db.prepare('SELECT token FROM scrips WHERE symbol = ? AND exchange = ? AND ts > ?')
    .get(symbol, 'NSE', Date.now() - SCRIP_TTL_MS);
  return row ? row.token : null;
}

/** Resolve catalog tokens using minimal prefix searches (rate-limited). */
async function resolveCatalogTokens() {
  const missing = [];
  for (const s of CATALOG_SYMBOLS) {
    if (!(await cachedToken(s))) missing.push(s);
  }
  if (!missing.length) return;

  // One search per unique 4-char prefix resolves whole symbol families.
  const prefixes = [...new Set(missing.map((s) => s.slice(0, 4).toUpperCase()))];
  const upsert = db.prepare(
    `INSERT INTO scrips (symbol, token, exchange, ts) VALUES (?, ?, ?, ?)
     ON CONFLICT (symbol) DO UPDATE SET token = EXCLUDED.token, exchange = EXCLUDED.exchange, ts = EXCLUDED.ts`
  );
  for (const prefix of prefixes) {
    const rows = await searchScrip('NSE', prefix);
    for (const row of rows) {
      const ts = String(row.tradingsymbol || row.symbol || '').toUpperCase();
      const m = ts.match(/^([A-Z0-9-]+)-EQ$/);
      if (!m || !row.symboltoken) continue;
      const base = m[1];
      if (!CATALOG_SYMBOLS.includes(base)) continue;
      await upsert.run(base, String(row.symboltoken), 'NSE', Date.now());
    }
  }
  let resolved = 0;
  for (const s of CATALOG_SYMBOLS) {
    if (await cachedToken(s)) resolved += 1;
  }
  console.log(`[angelone] resolved ${resolved}/${CATALOG_SYMBOLS.length} catalog tokens`);
}

async function resolveToken(symbol) {
  const cached = await cachedToken(symbol);
  if (cached) return cached;
  const rows = await searchScrip('NSE', symbol);
  const match = rows.find((r) => {
    const ts = String(r.tradingsymbol || r.symbol || '').toUpperCase();
    return ts === symbol || ts === `${symbol}-EQ`;
  });
  if (match && match.symboltoken) {
    await db.prepare(
      `INSERT INTO scrips (symbol, token, exchange, ts) VALUES (?, ?, ?, ?)
       ON CONFLICT (symbol) DO UPDATE SET token = EXCLUDED.token, exchange = EXCLUDED.exchange, ts = EXCLUDED.ts`
    ).run(symbol, String(match.symboltoken), 'NSE', Date.now());
    return String(match.symboltoken);
  }
  return null;
}

/** Background warm-up: resolve catalog so the first dashboard load is fast. */
function startWarmup() {
  if (warmupDone) return;
  warmupDone = true;
  setTimeout(() => {
    ensureSession().then(() => resolveCatalogTokens()).catch((e) => console.warn('[angelone] warmup:', e.message));
  }, 2000);
}

// ── Option chain (data-driven from searchScrip NFO) ────────────
function parseOptionRows(rows, underlying) {
  const parsed = [];
  for (const r of rows) {
    const sym = String(r.tradingsymbol || r.symbol || '').toUpperCase();
    // <UNDERLYING><DDMMMYY><STRIKE><CE|PE>  e.g. NIFTY29SEP2624600PE
    const m = sym.match(new RegExp(`^${underlying}(\\d{2}[A-Z]{3}\\d{2})(\\d+)(CE|PE)$`));
    if (!m || !r.symboltoken) continue;
    parsed.push({ symbol: sym, expiry: m[1], strike: parseInt(m[2], 10), optionType: m[3], token: String(r.symboltoken) });
  }
  return parsed;
}

async function getOptionChain(force = false) {
  if (!force && optionChainCache.list.length && Date.now() - optionChainCache.ts < OPTION_CHAIN_TTL_MS) {
    return optionChainCache.list;
  }
  // Full scan of both index derivatives; the search API caps results, so we cache
  // everything we get across expiries and match contracts by expiry + strike + type.
  const niftyRows = await searchScrip('NFO', 'NIFTY');
  const bankRows = await searchScrip('NFO', 'BANKNIFTY');
  const parsed = [...parseOptionRows(niftyRows, 'NIFTY'), ...parseOptionRows(bankRows, 'BANKNIFTY')];
  const byExpiry = new Map();
  for (const p of parsed) {
    if (!byExpiry.has(p.expiry)) byExpiry.set(p.expiry, []);
    byExpiry.get(p.expiry).push(p);
  }
  // Active expiry = the one with the most strikes (near/current series).
  const active = [...byExpiry.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  optionChainCache = { ts: Date.now(), list: parsed, byExpiry, activeExpiry: active ? active[0] : '' };
  console.log(`[angelone] option chain: ${parsed.length} symbols (active ${optionChainCache.activeExpiry})`);
  return optionChainCache.list;
}

// ── Public API ─────────────────────────────────────────────────

async function getIndices() {
  const quotes = await getQuotesCached({ NSE: ['26000', '26009'], BSE: ['26017'] });
  const byToken = new Map(quotes.map((q) => [q.token, q]));
  return {
    nifty: byToken.get('26000') || { error: 'NIFTY quote unavailable' },
    sensex: byToken.get('26017') || { error: 'SENSEX is not available on this SmartAPI account (BSE index feed). BANKNIFTY is shown as the second live index.' },
    banknifty: byToken.get('26009') || { error: 'BANKNIFTY quote unavailable' },
  };
}

async function getTopStockGainers(limit = 10) {
  if (!warmupDone) startWarmup();
  await resolveCatalogTokens();

  const tokens = [];
  for (const s of CATALOG_SYMBOLS) {
    const t = await cachedToken(s);
    if (t) tokens.push(t);
  }
  const rows = await getQuotesCached({ NSE: tokens });
  return rows
    .filter((r) => r.ltp > 0 && r.percentChange > 0)
    .map((q) => ({ symbol: q.symbol, token: q.token, ltp: q.ltp, netchange: q.netchange, percentChange: q.percentChange, exchange: 'NSE' }))
    .sort((a, b) => b.percentChange - a.percentChange)
    .slice(0, limit);
}

async function getTopOptionGainers(limit = 10) {
  const indices = await getIndices();
  const spot = indices.nifty && indices.nifty.ltp;
  if (!spot) throw new Error('NIFTY spot unavailable for option chain');

  const chain = await getOptionChain();
  const active = optionChainCache.activeExpiry;
  // ATM band: strikes within +-1.5% of spot in the active expiry (liquid, meaningful moves).
  const band = chain.filter((p) => (!active || p.expiry === active) && p.strike >= spot * 0.985 && p.strike <= spot * 1.015);
  if (!band.length) return [];

  // Prefer the ATM region (closest 20 strikes each side) to limit request size.
  const sorted = band.sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
  const picks = sorted.slice(0, 24);

  const quotes = await getQuotesCached({ NFO: picks.map((p) => p.token) });
  const byToken = new Map(picks.map((p) => [p.token, p]));

  const rows = [];
  for (const q of quotes) {
    const meta = byToken.get(q.token);
    if (!meta || q.ltp <= 0) continue;
    rows.push({
      symbol: q.symbol,
      token: q.token,
      strike: String(meta.strike),
      expiry: active || meta.expiry,
      optionType: meta.optionType,
      ltp: q.ltp, netchange: q.netchange, percentChange: q.percentChange,
      oi: q.oi, volume: q.volume, exchange: 'NFO',
    });
  }

  return rows
    .filter((r) => r.percentChange > 0)
    .sort((a, b) => b.percentChange - a.percentChange)
    .slice(0, limit);
}

async function searchInstruments(query) {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return [];

  if (/^(NIFTY|NIFTY50|BANKNIFTY|SENSEX)$/.test(q)) {
    const idx = q.startsWith('BANKNIFTY') ? { symbol: 'BANKNIFTY', token: '26009', exchange: 'NSE' }
      : q === 'SENSEX' ? { symbol: 'SENSEX', token: '26017', exchange: 'BSE' }
      : { symbol: 'NIFTY 50', token: '26000', exchange: 'NSE' };
    return [{ type: 'index', ...idx }];
  }

  const optionRe = /^(NIFTY|BANKNIFTY)\s+(\d+)\s+(CE|PE)$/i;
  const m = q.match(optionRe);
  const optionMatches = m
    ? [{ type: 'option', symbol: `${m[1]} ${m[2]} ${m[3].toUpperCase()}`, token: '', exchange: 'NFO' }]
    : [];

  await resolveCatalogTokens();
  const stockMatches = CATALOG_SYMBOLS
    .filter((s) => s.includes(q))
    .slice(0, 25)
    .map((symbol) => ({ type: 'stock', symbol, token: cachedToken(symbol) || '', exchange: 'NSE' }));

  return [...optionMatches, ...stockMatches].slice(0, 25);
}

function getLoginStatus() {
  return { loggedIn: !!session, lastLoginError };
}

/** Resolve an instrument (stock or option) to { exchange, token, symbol }. */
async function resolveInstrument(symbol, kind) {
  if (kind === 'option') {
    const pretty = String(symbol || '').match(/^(NIFTY|BANKNIFTY)\s+(\d+)\s+(CE|PE)$/i);
    const raw = String(symbol || '').match(/^(NIFTY|BANKNIFTY)(\d{2}[A-Z]{3}\d{2})(\d+)(CE|PE)$/i);
    let strike; let optType; let expiry = null; let underlying = 'NIFTY';
    if (pretty) { underlying = pretty[1].toUpperCase(); strike = parseInt(pretty[2], 10); optType = pretty[3].toUpperCase(); }
    else if (raw) { underlying = raw[1].toUpperCase(); expiry = raw[2]; strike = parseInt(raw[3], 10); optType = raw[4].toUpperCase(); }
    else return null;
    const match = (chain) => chain.find((p) =>
      p.strike === strike && p.optionType === optType && p.symbol.startsWith(underlying) && (!expiry || p.expiry === expiry));
    let chain = await getOptionChain();
    let hit = match(chain);
    if (!hit) {
      // Contract not in the cached chain (e.g. new expiry) -> refresh once.
      chain = await getOptionChain(true);
      hit = match(chain);
    }
    if (!hit) return null;
    return { exchange: 'NFO', token: hit.token, symbol: hit.symbol };
  }
  const token = await resolveToken(String(symbol || '').toUpperCase());
  return token ? { exchange: 'NSE', token, symbol: String(symbol).toUpperCase() } : null;
}

const candleFmt = (d) => `${d.toISOString().slice(0, 10)} 09:15`;

/**
 * Daily candlesticks for an instrument (live last candle via quote not needed;
 * the API returns today's candle once the session is live).
 */
async function getCandles({ symbol, kind = 'stock', interval = 'ONE_DAY', days = 120 } = {}) {
  const inst = await resolveInstrument(symbol, kind);
  if (!inst) throw new Error(`Unable to resolve ${symbol} — search for the instrument first`);

  const api = await ensureSession();
  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const res = await api.getCandleData({
    exchange: inst.exchange,
    symboltoken: inst.token,
    interval,
    fromdate: candleFmt(from),
    todate: candleFmt(to),
  });
  if (!res || res.status !== true || !Array.isArray(res.data)) {
    throw new Error((res && res.message) || 'Candle data unavailable');
  }
  return {
    symbol: inst.symbol,
    kind,
    interval,
    candles: res.data.map((c) => ({
      time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
    })),
  };
}

/**
 * Full instrument view for the detail screens: live quote (today's high/low,
 * 52-week high/low for stocks, circuits, volume, OI) + derived fundamentals.
 */
async function getInstrumentDetails({ symbol, kind = 'stock' } = {}) {
  const inst = await resolveInstrument(symbol, kind);
  if (!inst) throw new Error(`Unable to resolve ${symbol} — search for the instrument first`);

  const quotes = await getQuotesCached({ [inst.exchange]: [inst.token] });
  const q = quotes.find((x) => x.token === inst.token);
  if (!q || q.ltp <= 0) throw new Error(`No live quote for ${inst.symbol} — market may be closed`);

  const week52 = q.week52High > 0
    ? { high: q.week52High, low: q.week52Low, rangePosition: q.week52High > q.week52Low ? ((q.ltp - q.week52Low) / (q.week52High - q.week52Low)) * 100 : 0 }
    : null;

  return {
    symbol: inst.symbol,
    kind,
    exchange: inst.exchange,
    quote: q,
    today: { open: q.open, high: q.high, low: q.low, ltp: q.ltp, netchange: q.netchange, percentChange: q.percentChange },
    week52,
    fundamentals: {
      previousClose: q.close, // market-data `close` = previous close (ltp - netchange)
      lowerCircuit: q.lowerCircuit,
      upperCircuit: q.upperCircuit,
      volume: q.volume,
      buyQuantity: q.buyQty,
      sellQuantity: q.sellQty,
      openInterest: q.oi,
      lastTradedTime: q.lastTradedTime,
    },
  };
}

async function getTopStockLosers(limit = 10) {
  if (!warmupDone) startWarmup();
  await resolveCatalogTokens();

  const tokens = [];
  for (const s of CATALOG_SYMBOLS) {
    const t = await cachedToken(s);
    if (t) tokens.push(t);
  }
  const rows = await getQuotesCached({ NSE: tokens });
  return rows
    .filter((r) => r.ltp > 0 && r.percentChange < 0)
    .map((q) => ({ symbol: q.symbol, token: q.token, ltp: q.ltp, netchange: q.netchange, percentChange: q.percentChange, exchange: 'NSE' }))
    .sort((a, b) => a.percentChange - b.percentChange)
    .slice(0, limit);
}

async function getTopOptionLosers(limit = 10) {
  const indices = await getIndices();
  const spot = indices.nifty && indices.nifty.ltp;
  if (!spot) throw new Error('NIFTY spot unavailable for option chain');

  const chain = await getOptionChain();
  const active = optionChainCache.activeExpiry;
  const band = chain.filter((p) => (!active || p.expiry === active) && p.strike >= spot * 0.985 && p.strike <= spot * 1.015);
  if (!band.length) return [];
  const sorted = band.sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
  const picks = sorted.slice(0, 24);
  const quotes = await getQuotesCached({ NFO: picks.map((p) => p.token) });
  const byToken = new Map(picks.map((p) => [p.token, p]));

  const rows = [];
  for (const q of quotes) {
    const meta = byToken.get(q.token);
    if (!meta || q.ltp <= 0) continue;
    rows.push({
      symbol: q.symbol, token: q.token, strike: String(meta.strike),
      expiry: active || meta.expiry, optionType: meta.optionType,
      ltp: q.ltp, netchange: q.netchange, percentChange: q.percentChange,
      oi: q.oi, volume: q.volume, exchange: 'NFO',
    });
  }
  return rows
    .filter((r) => r.percentChange < 0)
    .sort((a, b) => a.percentChange - b.percentChange)
    .slice(0, limit);
}

module.exports = {
  ensureSession,
  getIndices,
  getTopStockGainers,
  getTopStockLosers,
  getTopOptionGainers,
  getTopOptionLosers,
  searchInstruments,
  getLoginStatus,
  startWarmup,
  resolveToken,
  resolveInstrument,
  getQuotesCached,
  getOptionChain,
  getCandles,
  getInstrumentDetails,
  CATALOG_SYMBOLS,
};
