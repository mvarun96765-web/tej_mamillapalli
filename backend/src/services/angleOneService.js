const { SmartAPI, WebSocketV2 } = require('smartapi-javascript');
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

// ── Live SmartStream (Angel One WebSocket) ─────────────────────
// Index tokens (Angel One's own token space): NIFTY 26000, BANKNIFTY 26009 (NSE),
// SENSEX 26017 (BSE). Catalog stock tokens are resolved from the `scrips` DB table.
const INDEX_META = {
  '26000': { symbol: 'NIFTY', exchange: 'NSE', exchangeType: 1 },
  '26009': { symbol: 'BANKNIFTY', exchange: 'NSE', exchangeType: 1 },
  '26017': { symbol: 'SENSEX', exchange: 'BSE', exchangeType: 3 },
};
const EXCHANGE_TYPE_NAME = { 1: 'NSE', 2: 'NFO', 3: 'BSE' };
const LIVE_QUOTE_TTL_MS = 15_000; // a stream quote is considered fresh for 15s
const BROADCAST_INTERVAL_MS = 1000; // push a snapshot to clients at most 1x/second

const liveQuotes = new Map();    // `${exchangeType}:${token}` -> { ts, value: quote }
const liveListeners = new Set(); // snapshot broadcast callbacks (SSE clients)
let liveSnapshot = null;
let lastBroadcastAt = 0;
let streamSocket = null;
let streamStarted = false;
const tokenBySymbol = new Map(); // catalog symbol -> token (NSE)
const symbolByToken = new Map(); // catalog token -> symbol (NSE)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function currentTotp() {
  if (!config.angelone.totpSecret) return '';
  return authenticator.generate(config.angelone.totpSecret);
}

let loginPromise = null;

async function doLogin() {
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

/**
 * Ensure we have a live Angel One session. Concurrent logins are deduped: the
 * chain build, the live stream and market-data requests all start at boot and
 * Angel One rejects simultaneous generateSession calls for the same client code.
 */
async function ensureSession(force = false) {
  if (smartApi && session && !force && Date.now() < session.expiresAt - 60_000) return smartApi;
  if (!loginPromise) loginPromise = doLogin().finally(() => { loginPromise = null; });
  return loginPromise;
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
    netchange: (() => {
      const n = raw.netChange !== undefined ? raw.netChange : raw.netchange;
      if (n !== undefined && n !== null && Number.isFinite(Number(n))) return num(n);
      const c = num(raw.close);
      const l = num(raw.ltp);
      if (l > 0 && c > 0) return l - c;
      return 0;
    })(),
    percentChange: (() => {
      const p = raw.percentChange !== undefined ? raw.percentChange : raw.percentagechange;
      if (p !== undefined && p !== null && Number.isFinite(Number(p))) return num(p);
      // Angel One's REST feed omits percentagechange; derive it from previous close.
      const c = num(raw.close);
      const l = num(raw.ltp);
      if (c > 0 && l > 0) return ((l - c) / c) * 100;
      return 0;
    })(),
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
    const t = await cachedToken(s);
    if (t) {
      resolved += 1;
      tokenBySymbol.set(s, t);
      symbolByToken.set(t, s);
    }
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

/** Background warm-up: resolve catalog + option chain so the first load is fast. */
function startWarmup() {
  if (warmupDone) return;
  warmupDone = true;
  setTimeout(() => {
    ensureSession()
      .then(() => Promise.all([resolveCatalogTokens(), refreshOptionChain()]))
      .catch((e) => console.warn('[angelone] warmup:', e.message));
  }, 2000);
}

// ── Option chain (whole options market: indices + liquid stock underlyings) ──
// Index underlyings are searched on NFO (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY)
// and BFO (SENSEX); stock underlyings are searched on NFO. Each search returns
// every contract across expiries; we keep the active expiry per underlying and
// spread-sample its strike ladder, so top option gainers/losers cover the entire
// options market instead of just NIFTY.
const OPTION_INDICES = [
  { symbol: 'NIFTY', exchange: 'NFO' },
  { symbol: 'BANKNIFTY', exchange: 'NFO' },
  { symbol: 'FINNIFTY', exchange: 'NFO' },
  { symbol: 'MIDCPNIFTY', exchange: 'NFO' },
  { symbol: 'SENSEX', exchange: 'BFO' },
];

const OPTION_STOCKS = [
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'AXISBANK',
  'KOTAKBANK', 'LT', 'ITC', 'BHARTIARTL', 'HINDUNILVR', 'BAJFINANCE',
  'TATAMOTORS', 'TATASTEEL', 'MARUTI', 'SUNPHARMA', 'TITAN', 'WIPRO',
  'HCLTECH', 'ASIANPAINT', 'ULTRACEMCO', 'ADANIENT', 'ADANIPORTS',
];

const OPTION_UNDERLYINGS = [
  ...OPTION_INDICES,
  ...OPTION_STOCKS.map((symbol) => ({ symbol, exchange: 'NFO' })),
];

/** Underlying names longest-first, so regex alternation matches FINNIFTY before NIFTY. */
const UNDERLYING_RE = [...OPTION_UNDERLYINGS.map((u) => u.symbol)].sort((a, b) => b.length - a.length).join('|');

function parseOptionRows(rows, underlying, exchange) {
  const parsed = [];
  for (const r of rows) {
    const sym = String(r.tradingsymbol || r.symbol || '').toUpperCase();
    // NFO: <UNDERLYING><DDMMMYY><STRIKE><CE|PE>  e.g. RELIANCE25AUG261000CE
    // BFO: <UNDERLYING><6-digit expiry code><STRIKE><CE|PE>  e.g. SENSEX2682069100CE
    const re = exchange === 'BFO'
      ? new RegExp(`^${underlying}(\\d{6})(\\d+)(CE|PE)$`)
      : new RegExp(`^${underlying}(\\d{2}[A-Z]{3}\\d{2})(\\d+)(CE|PE)$`);
    const m = sym.match(re);
    if (!m || !r.symboltoken) continue;
    parsed.push({
      symbol: sym,
      underlying,
      expiry: m[1],
      strike: parseInt(m[2], 10),
      optionType: m[3],
      token: String(r.symboltoken),
      exchange,
    });
  }
  return parsed;
}

/** Active expiry for a set of contracts = the one with the most strikes. */
function activeExpiryFor(contracts) {
  const counts = new Map();
  for (const c of contracts) counts.set(c.expiry, (counts.get(c.expiry) || 0) + 1);
  let best = '';
  let bestN = -1;
  for (const [e, n] of counts) {
    if (n > bestN) { best = e; bestN = n; }
  }
  return best;
}

/**
 * Pick a bounded sample of contracts across the whole market: for each
 * underlying, the active expiry, with strikes spread evenly over the ladder
 * (so movers anywhere in the chain are captured, not just near-the-money).
 */
function selectOptionPicks(chain, perUnderlying = 16) {
  const byUnderlying = new Map();
  for (const c of chain) {
    if (!byUnderlying.has(c.underlying)) byUnderlying.set(c.underlying, []);
    byUnderlying.get(c.underlying).push(c);
  }
  const picks = [];
  for (const contracts of byUnderlying.values()) {
    const active = activeExpiryFor(contracts);
    const activeContracts = active ? contracts.filter((c) => c.expiry === active) : contracts;
    const strikes = [...new Set(activeContracts.map((c) => c.strike))].sort((a, b) => a - b);
    const targetStrikes = Math.max(4, Math.floor(perUnderlying / 4)); // ~4 strikes x CE/PE
    const step = Math.max(1, Math.floor(strikes.length / targetStrikes));
    const chosen = new Set(strikes.filter((_, i) => i % step === 0));
    for (const c of activeContracts) {
      if (chosen.has(c.strike)) picks.push(c);
    }
  }
  return picks;
}

let chainBuildPromise = null;

/** Full scan of every underlying (rate-limited, so it runs in the background). */
async function buildOptionChain() {
  const t0 = Date.now();
  const parsed = [];
  for (const u of OPTION_UNDERLYINGS) {
    try {
      const rows = await searchScrip(u.exchange, u.symbol);
      const contracts = parseOptionRows(rows, u.symbol, u.exchange);
      parsed.push(...contracts);
      console.log(`[angelone] chain ${u.symbol} (${u.exchange}): ${contracts.length} contracts`);
    } catch (e) {
      console.warn(`[angelone] chain search ${u.symbol} failed:`, e.message);
    }
  }
  optionChainCache = { ts: Date.now(), list: parsed };
  console.log(`[angelone] option chain: ${parsed.length} contracts across ${OPTION_UNDERLYINGS.length} underlyings (${Date.now() - t0}ms)`);
  return parsed;
}

/** Kick off a background chain build (deduped); never blocks callers. */
function refreshOptionChain() {
  if (chainBuildPromise) return chainBuildPromise;
  chainBuildPromise = buildOptionChain().finally(() => { chainBuildPromise = null; });
  chainBuildPromise.catch(() => {});
  return chainBuildPromise;
}

/**
 * Return the cached chain immediately (serving stale data while a refresh runs).
 * `force` awaits a full rebuild — only used for rare lookups of uncached contracts.
 */
async function getOptionChain(force = false) {
  if (force) return refreshOptionChain();
  const stale = Date.now() - optionChainCache.ts >= OPTION_CHAIN_TTL_MS;
  if (!optionChainCache.list.length) {
    refreshOptionChain(); // first load: build in the background
    return optionChainCache.list;
  }
  if (stale) refreshOptionChain();
  return optionChainCache.list;
}

// ── Live SmartStream (Angel One WebSocket) ─────────────────────

function streamNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Normalize a SmartStream tick (mode 2 QUOTE) into the app's quote shape. */
function normalizeStreamTick(tick) {
  const exchangeType = streamNum(tick.exchange_type);
  const token = String(tick.token || '').replace(/"/g, '').trim();
  if (!token) return null;
  const scale = 100; // SmartStream sends all prices multiplied by 100
  const ltp = streamNum(tick.last_traded_price) / scale;
  const close = streamNum(tick.close_price) / scale;
  const open = streamNum(tick.open_price_day) / scale;
  const high = streamNum(tick.high_price_day) / scale;
  const low = streamNum(tick.low_price_day) / scale;
  const netchange = ltp > 0 && close > 0 ? ltp - close : 0;
  const percentChange = close > 0 ? (netchange / close) * 100 : 0;

  let symbol = '';
  let exchange = EXCHANGE_TYPE_NAME[exchangeType] || '';
  const meta = INDEX_META[token];
  if (meta) {
    symbol = meta.symbol;
    exchange = meta.exchange;
  } else if (symbolByToken.has(token)) {
    symbol = symbolByToken.get(token);
  }
  const ts = streamNum(tick.exchange_timestamp);
  return {
    symbol,
    token,
    exchange,
    open,
    high,
    low,
    close,
    ltp,
    netchange,
    percentChange,
    volume: streamNum(tick.vol_traded),
    oi: 0,
    lastTradedTime: ts > 0 ? new Date(ts).toISOString() : '',
  };
}

/** Live quote for an index token, or null if the stream hasn't delivered one. */
function liveIndexQuote(token) {
  const meta = INDEX_META[token];
  const hit = liveQuotes.get(`${meta.exchangeType}:${token}`);
  if (hit && Date.now() - hit.ts < LIVE_QUOTE_TTL_MS && hit.value.ltp > 0) return hit.value;
  return null;
}

/** Top N live gainers/losers from the streamed catalog quotes. */
function topLiveRows(exchangeType, gainers, limit) {
  const now = Date.now();
  const rows = [];
  for (const [token, symbol] of symbolByToken) {
    const q = liveQuotes.get(`${exchangeType}:${token}`);
    if (!q || now - q.ts > LIVE_QUOTE_TTL_MS || q.value.ltp <= 0) continue;
    rows.push({
      symbol: q.value.symbol || symbol,
      token,
      ltp: q.value.ltp,
      netchange: q.value.netchange,
      percentChange: q.value.percentChange,
      exchange: 'NSE',
    });
  }
  rows.sort((a, b) => (gainers ? b.percentChange - a.percentChange : a.percentChange - b.percentChange));
  return rows.filter((r) => (gainers ? r.percentChange > 0 : r.percentChange < 0)).slice(0, limit);
}

/** Dashboard-shaped snapshot built purely from stream data (same shape as /dashboard). */
function computeLiveSnapshot() {
  const nifty = liveIndexQuote('26000');
  const banknifty = liveIndexQuote('26009');
  return {
    stream: true,
    ts: Date.now(),
    indices: {
      nifty: nifty || { error: 'NIFTY quote unavailable' },
      sensex: liveIndexQuote('26017') || { error: 'SENSEX is not available on this SmartAPI account (BSE index feed). BANKNIFTY is shown as the second live index.' },
      banknifty: banknifty || { error: 'BANKNIFTY quote unavailable' },
    },
    topStocks: topLiveRows(1, true, 10),
    topStockLosers: topLiveRows(1, false, 10),
  };
}

function handleStreamTick(tick) {
  const q = normalizeStreamTick(tick);
  if (!q) return;
  const exchangeType = streamNum(tick.exchange_type);
  liveQuotes.set(`${exchangeType}:${q.token}`, { ts: Date.now(), value: q });
  // Coalesce rapid ticks (many symbols stream 1x/sec) into one 1-second push.
  const now = Date.now();
  if (now - lastBroadcastAt >= BROADCAST_INTERVAL_MS) {
    lastBroadcastAt = now;
    liveSnapshot = computeLiveSnapshot();
    for (const cb of liveListeners) {
      try { cb(liveSnapshot); } catch (_) {}
    }
  }
}

/** Subscribe the open socket to the NSE catalog tokens (in chunks of 100). */
function subscribeCatalog(ws) {
  const tokens = [...tokenBySymbol.values()].filter((t) => t);
  for (let i = 0; i < tokens.length; i += 100) {
    ws.fetchData({ correlationID: 'stk', action: 1, mode: 2, exchangeType: 1, tokens: tokens.slice(i, i + 100) });
  }
}

/** Open (or re-open after session refresh) the live socket and subscribe. */
async function openStreamSocket(handle) {
  if (handle.stopped) return;
  await ensureSession();
  const ws = new WebSocketV2({
    jwttoken: session.jwt,
    apikey: config.angelone.apiKey,
    clientcode: config.angelone.clientCode,
    feedtype: session.feedToken,
  });
  streamSocket = ws;
  ws.reconnection('simple', 3000); // library auto-reconnects + re-subscribes
  ws.on('tick', handleStreamTick);
  await ws.connect();
  ws.fetchData({ correlationID: 'idx', action: 1, mode: 2, exchangeType: 1, tokens: ['26000', '26009'] });
  ws.fetchData({ correlationID: 'bse', action: 1, mode: 2, exchangeType: 3, tokens: ['26017'] });
  subscribeCatalog(ws);
  console.log('[angelone-stream] live stream connected');

  // Re-login and rebuild the socket well before the 24h session expires.
  const refreshTimer = setTimeout(async () => {
    try {
      ws.close();
      await ensureSession(true);
      await openStreamSocket(handle);
    } catch (e) {
      console.warn('[angelone-stream] session refresh failed:', e.message);
    }
  }, 8 * 60 * 60 * 1000);
  if (refreshTimer.unref) refreshTimer.unref();
}

/** Load the resolved catalog tokens from the DB into memory (fast, no network). */
async function loadCatalogTokens() {
  try {
    const rows = await db.prepare('SELECT symbol, token FROM scrips WHERE exchange = ?').all('NSE');
    for (const r of rows) {
      tokenBySymbol.set(r.symbol, String(r.token));
      symbolByToken.set(String(r.token), r.symbol);
    }
  } catch (e) {
    console.warn('[angelone-stream] loadCatalogTokens:', e.message);
  }
}

/** Boot the live stream in the background; retries until Angel One accepts. */
function startStream() {
  if (streamStarted) return;
  streamStarted = true;
  const handle = { stopped: false };
  (async () => {
    while (!handle.stopped) {
      try {
        await loadCatalogTokens();
        refreshOptionChain(); // warm the whole-market option chain in the background
        await openStreamSocket(handle);
        return;
      } catch (e) {
        console.warn('[angelone-stream] connect failed, retry in 10s:', e.message);
        await sleep(10_000);
      }
    }
  })();
  return handle;
}

function getLiveSnapshot() {
  return liveSnapshot;
}

function getStreamStatus() {
  return { connected: !!streamSocket, tokens: liveQuotes.size };
}

/** Register a callback that receives each 1-second live snapshot. */
function onLiveTick(cb) {
  liveListeners.add(cb);
}

// ── Public API ─────────────────────────────────────────────────

async function getIndices() {
  const nifty = liveIndexQuote('26000');
  const banknifty = liveIndexQuote('26009');
  if (nifty && banknifty) {
    // Prefer the WebSocket stream (freshest, no REST cost).
    return {
      nifty,
      sensex: liveIndexQuote('26017') || { error: 'SENSEX is not available on this SmartAPI account (BSE index feed). BANKNIFTY is shown as the second live index.' },
      banknifty,
    };
  }
  // Stream not delivering yet -> REST fallback.
  const quotes = await getQuotesCached({ NSE: ['26000', '26009'], BSE: ['26017'] });
  const byToken = new Map(quotes.map((q) => [q.token, q]));
  return {
    nifty: byToken.get('26000') || { error: 'NIFTY quote unavailable' },
    sensex: byToken.get('26017') || { error: 'SENSEX is not available on this SmartAPI account (BSE index feed). BANKNIFTY is shown as the second live index.' },
    banknifty: byToken.get('26009') || { error: 'BANKNIFTY quote unavailable' },
  };
}

async function getTopStockGainers(limit = 10) {
  const live = topLiveRows(1, true, limit);
  if (live.length) return live;
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

/** Top option movers selected from the ENTIRE options market (not just NIFTY). */
async function getOptionMovers(limit = 10, gainers = true) {
  const chain = await getOptionChain();
  if (!chain.length) return [];
  const picks = selectOptionPicks(chain);
  if (!picks.length) return [];

  const tokens = { NFO: [], BFO: [] };
  for (const p of picks) tokens[p.exchange].push(p.token);
  const quotes = await getQuotesCached(tokens);
  const byToken = new Map();
  for (const p of picks) byToken.set(p.token, p);

  const rows = [];
  for (const q of quotes) {
    const meta = byToken.get(q.token);
    // ltp >= 1 filters near-zero dust contracts whose % move is just noise.
    if (!meta || q.ltp < 1) continue;
    rows.push({
      symbol: `${meta.underlying} ${meta.strike} ${meta.optionType}`, // display name
      instrument: q.symbol, // raw trading symbol (e.g. BHARTIARTL25AUG261940PE)
      token: q.token,
      underlying: meta.underlying,
      strike: String(meta.strike),
      expiry: meta.expiry,
      optionType: meta.optionType,
      ltp: q.ltp,
      netchange: q.netchange,
      percentChange: q.percentChange,
      oi: q.oi,
      volume: q.volume,
      exchange: meta.exchange,
    });
  }

  return rows
    .filter((r) => (gainers ? r.percentChange > 0 : r.percentChange < 0))
    .sort((a, b) => (gainers ? b.percentChange - a.percentChange : a.percentChange - b.percentChange))
    .slice(0, limit);
}

async function getTopOptionGainers(limit = 10) {
  return getOptionMovers(limit, true);
}

/** Persist a resolved NSE token so later detail loads are instant. */
async function rememberScrip(symbol, token) {
  try {
    await db.prepare(
      `INSERT INTO scrips (symbol, token, exchange, ts) VALUES (?, ?, ?, ?)
       ON CONFLICT (symbol) DO UPDATE SET token = EXCLUDED.token, exchange = EXCLUDED.exchange, ts = EXCLUDED.ts`
    ).run(symbol, token, 'NSE', Date.now());
    tokenBySymbol.set(symbol, token);
    symbolByToken.set(token, symbol);
  } catch (_) {}
}

async function searchInstruments(query) {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return [];

  if (/^(NIFTY|NIFTY50|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY)$/.test(q)) {
    const idx = q.startsWith('BANKNIFTY') ? { symbol: 'BANKNIFTY', token: '26009', exchange: 'NSE' }
      : q === 'SENSEX' ? { symbol: 'SENSEX', token: '26017', exchange: 'BSE' }
      : q === 'FINNIFTY' ? { symbol: 'FINNIFTY', token: '', exchange: 'NSE' }
      : q === 'MIDCPNIFTY' ? { symbol: 'MIDCPNIFTY', token: '', exchange: 'NSE' }
      : { symbol: 'NIFTY 50', token: '26000', exchange: 'NSE' };
    return [{ type: 'index', ...idx }];
  }

  // "NIFTY 26000 CE" style -> resolve the exact contract.
  const optionRe = new RegExp(`^(${UNDERLYING_RE})\\s+(\\d+)\\s+(CE|PE)$`, 'i');
  const m = q.match(optionRe);
  if (m) {
    const u = m[1].toUpperCase();
    const meta = OPTION_UNDERLYINGS.find((x) => x.symbol === u);
    return [{ type: 'option', symbol: `${u} ${m[2]} ${m[3].toUpperCase()}`, token: '', exchange: (meta && meta.exchange) || 'NFO' }];
  }

  // Live exchange search: NSE stocks (SYMBOL-EQ) + NFO contracts (CE/PE/FUT)
  // for ANY symbol, not just the hardcoded catalog (e.g. SUZLON).
  const results = [];
  const seen = new Set();

  const nseRows = await searchScrip('NSE', q);
  for (const r of nseRows) {
    const ts = String(r.tradingsymbol || r.symbol || '').toUpperCase();
    const eq = ts.match(/^([A-Z0-9-]+)-EQ$/);
    if (!eq || !r.symboltoken) continue;
    const base = eq[1];
    if (seen.has(`s:${base}`)) continue;
    seen.add(`s:${base}`);
    results.push({ type: 'stock', symbol: base, token: String(r.symboltoken), exchange: 'NSE' });
    await rememberScrip(base, String(r.symboltoken));
    if (results.length >= 25) return results;
  }

  const nfoRows = await searchScrip('NFO', q);
  for (const r of nfoRows) {
    const ts = String(r.tradingsymbol || r.symbol || '').toUpperCase();
    const opt = ts.match(/^([A-Z0-9]+)(\\d{2}[A-Z]{3}\\d{2})(\\d+)(CE|PE)$/);
    if (!opt || !r.symboltoken) continue;
    const [full, underlying, , strike, optType] = opt;
    const key = `o:${underlying}:${strike}:${optType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      type: 'option',
      symbol: `${underlying} ${strike} ${optType}`,
      token: String(r.symboltoken),
      exchange: 'NFO',
    });
    if (results.length >= 25) return results;
  }

  return results;
}

function getLoginStatus() {
  return { loggedIn: !!session, lastLoginError };
}

/** Resolve an instrument (stock or option) to { exchange, token, symbol }. */
async function resolveInstrument(symbol, kind) {
  if (kind === 'option') {
    const s = String(symbol || '').trim();
    const pretty = s.match(new RegExp(`^(${UNDERLYING_RE})\\s+(\\d+)\\s+(CE|PE)$`, 'i'));
    const raw = s.match(new RegExp(`^(${UNDERLYING_RE})(\\d{2}[A-Z]{3}\\d{2}|\\d{6})(\\d+)(CE|PE)$`, 'i'));
    let strike; let optType; let expiry = null; let underlying = '';
    if (pretty) { underlying = pretty[1].toUpperCase(); strike = parseInt(pretty[2], 10); optType = pretty[3].toUpperCase(); }
    else if (raw) { underlying = raw[1].toUpperCase(); expiry = raw[2]; strike = parseInt(raw[3], 10); optType = raw[4].toUpperCase(); }
    else return null;
    const match = (chain) => chain.find((p) =>
      p.strike === strike && p.optionType === optType && p.underlying === underlying && (!expiry || p.expiry === expiry));
    let chain = await getOptionChain();
    let hit = match(chain);
    if (!hit) {
      // Contract not in the cached chain (e.g. new expiry) -> refresh once.
      chain = await getOptionChain(true);
      hit = match(chain);
    }
    if (!hit) return null;
    return { exchange: hit.exchange, token: hit.token, symbol: hit.symbol };
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
  const live = topLiveRows(1, false, limit);
  if (live.length) return live;
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
  return getOptionMovers(limit, false);
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
  getStreamStatus,
  getLiveSnapshot,
  onLiveTick,
  startStream,
  startWarmup,
  resolveToken,
  resolveInstrument,
  getQuotesCached,
  getOptionChain,
  getCandles,
  getInstrumentDetails,
  CATALOG_SYMBOLS,
};
