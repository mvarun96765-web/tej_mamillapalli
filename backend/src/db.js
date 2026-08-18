// MongoDB-backed data layer for VARUN TEJ.
//
// The application code was written against a SQLite/PostgreSQL prepared-
// statement API (`db.prepare(sql).run/get/all` with `?` placeholders). This
// module keeps that exact call shape but executes against MongoDB Atlas,
// translating the small, closed SQL dialect the app actually uses:
//
//   SELECT [DISTINCT] cols FROM t [WHERE ...] [ORDER BY ...] [LIMIT ?] [OFFSET ?]
//   SELECT COUNT(*)::int AS c FROM t [WHERE ...]
//   SELECT ... GROUP BY col                       (with COUNT(*)::int AS c)
//   SELECT n.* FROM news_articles n JOIN option_news on ON ...   (the one JOIN)
//   SELECT ... WHERE id > (SELECT COALESCE(MAX(x),0) FROM ...)   (the one subquery)
//   INSERT [OR IGNORE] INTO t (cols) VALUES (...) [ON CONFLICT ... DO UPDATE ...]
//   UPDATE t SET col = ?, col = 'lit', col = datetime('now'), col = COALESCE(col, '') WHERE ...
//   DELETE FROM t WHERE ...
//
// Each SQL table maps to a collection. Integer `id` columns keep a SERIAL-like
// auto-increment via a `counters` collection, so existing code that relies on
// numeric ids (JWT `sub`, `lastInsertRowid`, `id IN (...)`, ...) keeps working
// unchanged. Timestamps keep the old UTC text format ('YYYY-MM-DD HH24:MI:SS'),
// and boolean-ish flags stay 0/1 numbers.

const { MongoClient } = require('mongodb');
const config = require('./config');

const client = new MongoClient(config.databaseUrl, {
  appName: 'varun-tej-backend',
  serverSelectionTimeoutMS: 15_000,
  connectTimeoutMS: 15_000,
});

let db;
const coll = (name) => db.collection(name);

// ── Schema metadata ────────────────────────────────────────────
// unique: unique-key column sets (used by INSERT OR IGNORE / ON CONFLICT)
// defaults: column defaults applied on INSERT when not provided
// timestamps: UTC-text columns defaulting to now
// hasId: true when the table has a SERIAL-style integer `id` column
const TABLES = {
  users: {
    hasId: true,
    // NOTE: `phone` is intentionally NOT unique — signup never sets it, so a
    // unique index would store phone:null for every user and block the second
    // signup ever (E11000). The old SQLite unique index allowed multiple NULLs.
    unique: [['email'], ['username']],
    timestamps: ['created_at', 'updated_at'],
    defaults: { name: '', dob: '', email_verified: 0, phone_verified: 0, profile_pic: '', security_pin_hash: '', biometric_enabled: 0 },
  },
  sessions: {
    hasId: true,
    unique: [['token_hash'], ['refresh_hash']],
    timestamps: ['created_at'],
    defaults: { revoked: 0 },
  },
  ai_keys: {
    hasId: true,
    unique: [['user_id', 'work', 'slot']],
    timestamps: ['created_at'],
    defaults: { provider: 'google', model: '', key_hint: '', status: 'UNKNOWN', last_error: '', last_tested_at: '', enabled: 1 },
  },
  ai_models: {
    hasId: true,
    timestamps: ['created_at'],
    defaults: { endpoint: '', key_hint: '', status: 'VERIFICATION_REQUIRED', verified_at: '', is_primary: 0, enabled: 1, last_error: '', last_error_category: '', latency_ms: 0 },
  },
  news_articles: {
    hasId: true,
    unique: [['fingerprint']],
    timestamps: ['collected_at'],
    defaults: { source: '', url: '', company: '', content_hash: '', raw: '' },
  },
  news_checkpoint: {
    unique: [['id']],
    defaults: { last_checkpoint: '', last_published_from: '' },
  },
  news_history: {
    hasId: true,
    timestamps: ['created_at'],
    defaults: { requested_from: '', requested_to: '', returned: 0, added: 0, article_uuid: '', title: '', main_point: '', source: '', url: '', published_at: '', companies: '' },
  },
  option_news: {
    hasId: true,
    unique: [['company', 'article_id']],
    timestamps: ['created_at'],
  },
  trade_history: {
    hasId: true,
    timestamps: ['closed_at'],
    defaults: { instrument: '', entry_price: '', target: '', stop_loss: '', confidence: 0, reason: '', generated_at: '', highest_price: '', lowest_price: '', final_price: '', timeframe: '', risk: '' },
  },
  ai_reports: {
    hasId: true,
    timestamps: ['created_at'],
  },
  trades: {
    hasId: true,
    timestamps: ['created_at', 'updated_at'],
    defaults: { instrument: '', entry_zone: '', entry_price: '', target: '', stop_loss: '', timeframe: '', risk: '', confidence: 0, reason: '', status: 'ACTIVE', highest_price: '', lowest_price: '', final_price: '', closed_at: '', result: '', high_confidence: 0 },
  },
  analyses: {
    hasId: true,
    timestamps: ['created_at'],
    defaults: { current_price: '', market_trend: '', news_sentiment: '', ai_signal: '', target: '', stop_loss: '', timeframe: '', risk: '', reason: '' },
  },
  notification_preferences: {
    unique: [['user_id']],
    defaults: {
      new_trade: 1, high_confidence_trade: 1, trade_update: 1, target_reached: 1,
      stop_loss_alert: 1, new_stock_opportunity: 1, new_option_opportunity: 1,
      market_alert: 1, important_news: 1, major_company_news: 1, bullish_news: 0,
      bearish_news: 0, news_analysis_completed: 1, ai_analysis_completed: 1,
      daily_market_summary: 1, market_open: 0, market_close: 0,
    },
  },
  notifications: {
    hasId: true,
    timestamps: ['created_at'],
    defaults: { body: '', read: 0 },
  },
  scrips: {
    unique: [['symbol']],
  },
  app_settings: {
    unique: [['user_id']],
    defaults: { theme: 'system', server_url: '' },
  },
};

/** Column names that hold numbers (int ids, 0/1 flags, BIGINT ms, ...). */
const NUMERIC = new Set(
  ['id', 'user_id', 'article_id', 'trade_id', 'work', 'slot', 'expires_at', 'read',
   'revoked', 'enabled', 'is_primary', 'email_verified', 'phone_verified',
   'biometric_enabled', 'high_confidence', 'returned', 'added', 'latency_ms',
   'ts', 'confidence', 'stage']
);

// ── Small helpers ──────────────────────────────────────────────
const utcNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** Coerce a value to a number when it looks numeric (string params vs int ids). */
const toNum = (v) =>
  typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v;

/** SERIAL-style auto-increment per table. */
async function nextId(table) {
  const doc = await coll('counters').findOneAndUpdate(
    { _id: table },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return doc.seq;
}

/** Escape a SQL LIKE pattern into a case-insensitive RegExp. */
function likeRegex(p) {
  let s = String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  s = s.replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(s, 'i');
}

/** Strip Mongo's _id so rows look exactly like the old SQL rows. */
function strip(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

/** Split a string on top-level commas, respecting parens (VALUES / SET lists). */
function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Parse an SQL literal (`'text'`, 42, 4.5, NULL). */
function literalValue(raw) {
  const t = String(raw).trim();
  if (t === 'NULL') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const s = t.match(/^'([^']*)'$/);
  if (s) return s[1];
  throw new Error(`Unsupported SQL literal: ${t}`);
}

// ── WHERE clause parser ────────────────────────────────────────
// Supported: col = ? | != | > | >= | < | <= | LIKE ? | IN (?,..) | NOT IN (?,..),
// plus literal values, joined with AND and/or OR (no nested parens).
const COND_RE = /^([\w.]+)\s*(NOT IN|IN|LIKE|!=|>=|<=|=|>|<)\s*(.+)$/i;

function parseCond(text, ctx) {
  const m = text.trim().match(COND_RE);
  if (!m) throw new Error(`Unsupported WHERE condition: ${text.trim()}`);
  const col = m[1].replace(/^.*\./, ''); // strip table alias (`on.company`)
  const op = m[2].toUpperCase();
  const raw = m[3].trim();
  const numCol = NUMERIC.has(col);

  if (op === 'IN' || op === 'NOT IN') {
    const inner = raw.match(/^\(([^)]*)\)$/);
    const n = (inner[1].match(/\?/g) || []).length;
    const vals = [];
    for (let k = 0; k < n; k += 1) {
      const v = ctx.params[ctx.i++];
      vals.push(numCol ? toNum(v) : v);
    }
    return { [col]: op === 'IN' ? { $in: vals } : { $nin: vals } };
  }
  if (op === 'LIKE') {
    return { [col]: { $regex: likeRegex(ctx.params[ctx.i++]) } };
  }

  let v = raw === '?' ? ctx.params[ctx.i++] : literalValue(raw);
  if (numCol && v !== null) v = toNum(v);
  switch (op) {
    case '=': return { [col]: v };
    case '!=': return { [col]: { $ne: v } };
    case '>': return { [col]: { $gt: v } };
    case '>=': return { [col]: { $gte: v } };
    case '<': return { [col]: { $lt: v } };
    case '<=': return { [col]: { $lte: v } };
    default: throw new Error(`Unsupported operator ${op}`);
  }
}

function parseWhere(whereSql, ctx) {
  if (!whereSql) return {};
  const parts = whereSql.trim().split(/\s+(AND|OR)\s+/i);
  const conds = [];
  const joiners = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 0) conds.push(parseCond(parts[i], ctx));
    else joiners.push(parts[i].toUpperCase());
  }
  if (conds.length === 1) return conds[0];
  if (joiners.every((j) => j === 'AND')) return Object.assign({}, ...conds);
  return { $or: conds };
}

// ── ORDER BY / LIMIT / OFFSET ──────────────────────────────────
function parseOrderBy(sql) {
  const m = sql.match(/ORDER\s+BY\s+(.+?)(?=\s+LIMIT\b|\s+OFFSET\b|$)/i);
  if (!m) return null;
  return m[1].split(',').map((part) => {
    const mm = part.trim().match(/^([\w.]+)(?:\s+(ASC|DESC))?$/i);
    if (!mm) throw new Error(`Unsupported ORDER BY: ${part}`);
    return [mm[1].replace(/^.*\./, ''), (mm[2] || 'ASC').toUpperCase() === 'DESC' ? -1 : 1];
  });
}

function parseLimitOffset(sql, ctx) {
  let limit;
  const lm = sql.match(/LIMIT\s+(\?|\d+)/i);
  if (lm) limit = lm[1] === '?' ? Number(ctx.params[ctx.i++]) : Number(lm[1]);
  let skip;
  const om = sql.match(/OFFSET\s+(\?|\d+)/i);
  if (om) skip = om[1] === '?' ? Number(ctx.params[ctx.i++]) : Number(om[1]);
  return { limit, skip };
}

const whereOf = (sql, lookahead) => {
  const m = sql.match(new RegExp(`WHERE\\s+(.+?)(?=\\s+${lookahead}|$)`, 'i'));
  return m ? m[1] : null;
};

// ── SELECT handlers ────────────────────────────────────────────
async function execSelect(sql, ctx) {
  const colsM = sql.match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)/i);
  const table = colsM[2];
  const cols = colsM[1].trim() === '*'
    ? null
    : colsM[1].split(',').map((c) => c.trim().replace(/^[\w]+\./, '').replace(/::\w+$/, ''));
  const filter = parseWhere(whereOf(sql, 'ORDER\\s+BY\\b|LIMIT\\b|OFFSET\\b'), ctx);
  const sort = parseOrderBy(sql);
  const { limit, skip } = parseLimitOffset(sql, ctx);

  const cursor = coll(table).find(
    filter,
    cols ? { projection: { _id: 0, ...Object.fromEntries(cols.map((c) => [c, 1])) } } : {}
  );
  if (sort) cursor.sort(Object.fromEntries(sort));
  if (skip) cursor.skip(skip);
  if (limit !== undefined) cursor.limit(limit);
  const rows = await cursor.toArray();
  return rows.map(strip);
}

async function execDistinct(sql, ctx) {
  const m = sql.match(/^SELECT\s+DISTINCT\s+(\w+)\s+FROM\s+(\w+)/i);
  const filter = parseWhere(whereOf(sql, 'ORDER\\s+BY\\b|LIMIT\\b'), ctx);
  const vals = await coll(m[2]).distinct(m[1], filter);
  return vals.map((v) => ({ [m[1]]: v }));
}

async function execCount(sql, ctx) {
  const cm = sql.match(/COUNT\(\*\)::int\s+AS\s+(\w+)/i);
  const tm = sql.match(/FROM\s+(\w+)/i);
  const filter = parseWhere(whereOf(sql, 'ORDER\\s+BY\\b|LIMIT\\b'), ctx);
  const c = await coll(tm[1]).countDocuments(filter);
  return { [cm[1]]: c };
}

async function execGroupBy(sql, ctx) {
  const gm = sql.match(/GROUP\s+BY\s+(\w+)/i);
  const cm = sql.match(/COUNT\(\*\)::int\s+AS\s+(\w+)/i);
  const tm = sql.match(/FROM\s+(\w+)/i);
  const filter = parseWhere(whereOf(sql, 'GROUP\\s+BY\\b'), ctx);
  const rows = await coll(tm[1]).aggregate([
    { $match: filter },
    { $group: { _id: `$${gm[1]}`, [cm[1]]: { $sum: 1 } } },
  ]).toArray();
  return rows.map((r) => ({ [gm[1]]: r._id, [cm[1]]: r[cm[1]] }));
}

/** The single JOIN the app uses: news_articles <-> option_news. */
async function execJoin(sql, ctx) {
  const filter = parseWhere(whereOf(sql, 'ORDER\\s+BY\\b|LIMIT\\b'), ctx); // filters option_news
  const sort = parseOrderBy(sql);
  const { limit } = parseLimitOffset(sql, ctx);
  const links = await coll('option_news').find(filter).toArray();
  const ids = links.map((l) => l.article_id);
  if (!ids.length) return [];
  const cursor = coll('news_articles').find({ id: { $in: ids } });
  if (sort) cursor.sort(Object.fromEntries(sort));
  if (limit !== undefined) cursor.limit(limit);
  const rows = await cursor.toArray();
  return rows.map(strip);
}

/** The single subquery the app uses: `id > (SELECT COALESCE(MAX(x),0) ...)`. */
async function execSubquery(sql, ctx) {
  const inner = sql.match(/\(SELECT\s+COALESCE\(MAX\((\w+)\),\s*0\)\s+FROM\s+(\w+)\s+WHERE\s+(.+?)\)/i);
  const innerWhere = parseWhere(inner[3], ctx);
  const innerRows = await coll(inner[2]).find(innerWhere).toArray();
  let max = 0;
  for (const r of innerRows) {
    const v = r[inner[1]];
    if (typeof v === 'number' && v > max) max = v;
  }
  const outer = sql.match(/WHERE\s+(\w+)\s*>\s*\(SELECT/i);
  const sort = parseOrderBy(sql);
  const { limit } = parseLimitOffset(sql, ctx);
  const cursor = coll('news_articles').find({ [outer[1]]: { $gt: max } });
  if (sort) cursor.sort(Object.fromEntries(sort));
  if (limit !== undefined) cursor.limit(limit);
  const rows = await cursor.toArray();
  return rows.map(strip);
}

// ── INSERT handler ─────────────────────────────────────────────
const INSERT_RE = /^INSERT(?:\s+OR\s+IGNORE)?\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*(.*)$/is;

function resolveValue(raw, ctx) {
  const t = String(raw).trim();
  if (t === '?') return ctx.params[ctx.i++];
  if (/^'([^']*)'$/.test(t)) return t.slice(1, -1);
  if (t === 'NULL') return null;
  if (/^datetime\('now'\)$/i.test(t)) return utcNow();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  throw new Error(`Unsupported INSERT value: ${t}`);
}

/** Resolve one `ON CONFLICT ... DO UPDATE SET col = expr` assignment. */
function resolveUpsertExpr(expr, doc, existing, ctx) {
  const t = expr.trim();

  // CASE WHEN EXCLUDED.k = '' THEN <existing-ref> ELSE <new-value> END
  const caseM = t.match(/^CASE\s+WHEN\s+EXCLUDED\.(\w+)\s*=\s*''\s+THEN\s+(.+?)\s+ELSE\s+(.+?)\s+END$/i);
  if (caseM) {
    const keep = doc[caseM[1]] === '' || doc[caseM[1]] === null || doc[caseM[1]] === undefined;
    const branch = (keep ? caseM[2] : caseM[3]).trim();
    if (/^EXCLUDED\.(\w+)$/i.test(branch)) return doc[branch.match(/EXCLUDED\.(\w+)/i)[1]];
    const ref = branch.match(/^[\w]+\.(\w+)$/i);
    if (ref) return existing[ref[1]];
    return literalValue(branch);
  }
  // COALESCE(?, col) -> param unless null/empty (then keep existing)
  const coM = t.match(/^COALESCE\(\?,\s*(\w+)\)$/i);
  if (coM) {
    const p = ctx.params[ctx.i++];
    if (p === null || p === undefined || p === '') return existing[coM[1]];
    return NUMERIC.has(coM[1]) ? toNum(p) : p;
  }
  // COALESCE(col, '')
  const co2 = t.match(/^COALESCE\((\w+),\s*''\)$/i);
  if (co2) return existing[co2[1]] ?? '';
  // EXCLUDED.col
  const exM = t.match(/^EXCLUDED\.(\w+)$/i);
  if (exM) {
    const v = doc[exM[1]];
    return NUMERIC.has(exM[1]) ? toNum(v) : v;
  }
  // existing-table.col reference
  const refM = t.match(/^[\w]+\.(\w+)$/i);
  if (refM) return existing[refM[1]];

  return resolveValue(t, ctx);
}

function applyDefaults(table, doc) {
  const meta = TABLES[table];
  for (const [c, v] of Object.entries(meta.defaults || {})) {
    if (doc[c] === undefined) doc[c] = v;
  }
  for (const c of meta.timestamps || []) {
    if (doc[c] === undefined) doc[c] = utcNow();
  }
}

async function execInsert(sql, ctx) {
  const m = sql.match(INSERT_RE);
  const table = m[1];
  const meta = TABLES[table];
  const cols = m[2].split(',').map((c) => c.trim());
  const { vals: rawVals, tail } = parseValuesSection(m[3]);

  const conflict = tail.match(/ON\s+CONFLICT\s*(?:\(([^)]*)\))?\s+DO\s+(NOTHING|UPDATE\s+SET\s+(.+))$/is);
  const ignore = /INSERT\s+OR\s+IGNORE/i.test(sql) || (conflict && conflict[2] === 'NOTHING');
  const assignments = conflict && conflict[2].startsWith('UPDATE') ? conflict[3] : null;

  const doc = {};
  cols.forEach((c, i) => {
    let v = resolveValue(rawVals[i], ctx);
    if (NUMERIC.has(c) && v !== null) v = toNum(v);
    doc[c] = v;
  });
  applyDefaults(table, doc);

  if (assignments) {
    const conflictCols = (conflict[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
    const keyFilter = Object.fromEntries(conflictCols.map((c) => [c, doc[c]]));
    const existing = await coll(table).findOne(keyFilter);
    if (existing) {
      const set = {};
      for (const asg of splitTopLevel(assignments)) {
        const eq = asg.indexOf('=');
        const col = asg.slice(0, eq).trim();
        set[col] = resolveUpsertExpr(asg.slice(eq + 1), doc, existing, ctx);
      }
      if (Object.keys(set).length) await coll(table).updateOne({ _id: existing._id }, { $set: set });
      return { changes: 1, lastInsertRowid: existing.id };
    }
  }

  if (ignore) {
    for (const key of meta.unique || []) {
      const probe = Object.fromEntries(key.map((c) => [c, doc[c]]));
      if (await coll(table).findOne(probe)) return { changes: 0, lastInsertRowid: undefined };
    }
  }

  if (meta.hasId) doc.id = await nextId(table);
  await coll(table).insertOne(doc);
  return { changes: 1, lastInsertRowid: meta.hasId ? doc.id : undefined };
}

/** Split `(a, b, ...)` VALUES body into value tokens and the tail after ')'. */
function parseValuesSection(valuesStr) {
  const vals = [];
  let depth = 0;
  let cur = '';
  let tail = '';
  // valuesStr begins with '(' — walk chars tracking paren depth so commas
  // inside parens (e.g. datetime('now')) never split a value.
  for (let i = 1; i < valuesStr.length; i += 1) {
    const ch = valuesStr[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      if (depth === 0) {
        if (cur.trim()) vals.push(cur.trim());
        tail = valuesStr.slice(i + 1);
        break;
      }
      depth -= 1;
    }
    if (ch === ',' && depth === 0) { vals.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  return { vals, tail };
}

// ── UPDATE / DELETE handlers ───────────────────────────────────
const UPDATE_RE = /^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/is;

async function execUpdate(sql, ctx) {
  const m = sql.match(UPDATE_RE);
  const table = m[1];
  // SQL parameter order is SET first, WHERE last — parse SET before WHERE.
  const set = {};
  const ifNull = [];
  for (const asg of splitTopLevel(m[2])) {
    const eq = asg.indexOf('=');
    const col = asg.slice(0, eq).trim();
    const expr = asg.slice(eq + 1).trim();
    const co = expr.match(/^COALESCE\((\w+),\s*''\)$/i);
    if (co) { ifNull.push(co[1]); continue; }
    let v;
    if (expr === '?') v = ctx.params[ctx.i++];
    else if (/^datetime\('now'\)$/i.test(expr)) v = utcNow();
    else v = literalValue(expr);
    if (NUMERIC.has(col) && v !== null && v !== undefined) v = toNum(v);
    set[col] = v;
  }
  const filter = parseWhere(m[3], ctx);
  const update = ifNull.length
    ? [{ $set: { ...set, ...Object.fromEntries(ifNull.map((c) => [c, { $ifNull: [`$${c}`, ''] }])) } }]
    : { $set: set };
  const r = await coll(table).updateMany(filter, update);
  return { changes: r.modifiedCount, lastInsertRowid: undefined };
}

const DELETE_RE = /^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/is;

async function execDelete(sql, ctx) {
  const m = sql.match(DELETE_RE);
  const filter = parseWhere(m[2], ctx);
  const r = await coll(m[1]).deleteMany(filter);
  return { changes: r.deletedCount, lastInsertRowid: undefined };
}

// ── Statement dispatcher ───────────────────────────────────────
async function execute(sql, params, mode) {
  const ctx = { params, i: 0 };
  const t = sql.trim();
  try {
    let out;
    if (/^SELECT/i.test(t)) {
      if (/\(SELECT/i.test(t)) out = await execSubquery(t, ctx);
      else if (/JOIN\s+option_news/i.test(t)) out = await execJoin(t, ctx);
      else if (/GROUP\s+BY/i.test(t)) out = await execGroupBy(t, ctx);
      else if (/COUNT\(\*\)::int/i.test(t)) out = await execCount(t, ctx);
      else if (/^SELECT\s+DISTINCT/i.test(t)) out = await execDistinct(t, ctx);
      else out = await execSelect(t, ctx);
    } else if (/^INSERT/i.test(t)) out = await execInsert(t, ctx);
    else if (/^UPDATE/i.test(t)) out = await execUpdate(t, ctx);
    else if (/^DELETE/i.test(t)) out = await execDelete(t, ctx);
    else throw new Error(`Unsupported statement: ${t.slice(0, 80)}`);

    if (mode === 'run') return out;
    if (mode === 'get') return Array.isArray(out) ? out[0] : out;
    return Array.isArray(out) ? out : [out];
  } catch (e) {
    throw new Error(`[db] ${mode} ${t.slice(0, 140)} -> ${e.message}`);
  }
}

/**
 * Prepared-statement style wrapper. `.run()/.get()/.all()` are async and accept
 * positional params exactly like the old SQLite/PostgreSQL driver.
 */
function prepare(sql) {
  return {
    run: (...params) => execute(sql, params, 'run'),
    get: (...params) => execute(sql, params, 'get'),
    all: (...params) => execute(sql, params, 'all'),
  };
}

// ── Schema bootstrap ───────────────────────────────────────────
async function initSchema() {
  await client.connect();
  db = client.db(config.mongoDbName);
  for (const [t, meta] of Object.entries(TABLES)) {
    for (const key of meta.unique || []) {
      const spec = Object.fromEntries(key.map((c) => [c, 1]));
      await coll(t).createIndex(spec, { unique: true, name: `u_${key.join('_')}` });
    }
  }
  await coll('counters').createIndex({ _id: 1 }, { name: 'u__id' });
  // One-time self-heal: older schema versions created a unique index on
  // users.phone, which made every user (phone = null) collide. Drop it so
  // signup works for more than one account. Missing index -> no-op.
  try {
    await coll('users').dropIndex('u_phone');
  } catch (_) {}
}

let schemaReady = null;
function ready() {
  if (!schemaReady) {
    schemaReady = initSchema().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

module.exports = {
  client,
  pool: client,
  prepare,
  ready,
  convert: (sql) => sql,
};
