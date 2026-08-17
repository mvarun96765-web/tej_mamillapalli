const db = require('../db');
const { encrypt, decrypt, maskKey } = require('../crypto');
const { chat, PROVIDERS, safeCategory } = require('./aiProviders');

const WORKS = { 1: 'News Intelligence', 2: 'Market Impact Analysis', 3: 'Final Trading Intelligence' };
const MAX_KEYS_PER_WORK = 10;

/** The preferred healthy key for a work (kept stable until it errors). */
const activeKeyId = { 1: null, 2: null, 3: null };

async function listKeys(userId, work) {
  return db.prepare(
    'SELECT id, work, slot, provider, model, key_hint, status, last_error, last_tested_at, enabled FROM ai_keys WHERE user_id = ? AND work = ? ORDER BY slot'
  ).all(userId, work);
}

async function listAllKeys(userId) {
  return db.prepare(
    'SELECT id, work, slot, provider, model, key_hint, status, last_error, last_tested_at, enabled FROM ai_keys WHERE user_id = ? ORDER BY work, slot'
  ).all(userId);
}

async function saveKeys(userId, work, slots) {
  if (!WORKS[work]) return { error: 'Invalid work' };
  if (!Array.isArray(slots)) return { error: 'slots must be an array' };

  const upsert = db.prepare(
    `INSERT INTO ai_keys (user_id, work, slot, provider, model, encrypted_key, key_hint, status, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
     ON CONFLICT(user_id, work, slot) DO UPDATE SET
       provider = excluded.provider,
       model = excluded.model,
       encrypted_key = CASE WHEN excluded.encrypted_key = '' THEN ai_keys.encrypted_key ELSE excluded.encrypted_key END,
       key_hint = CASE WHEN excluded.encrypted_key = '' THEN ai_keys.key_hint ELSE excluded.key_hint END,
       status = CASE WHEN excluded.encrypted_key = '' THEN ai_keys.status ELSE 'ACTIVE' END,
       last_error = '',
       enabled = excluded.enabled`
  );

  for (const s of slots) {
    const slot = parseInt(s.slot, 10);
    if (slot < 1 || slot > MAX_KEYS_PER_WORK) continue;
    const provider = s.provider || 'google';
    const model = s.model || '';
    const enabled = s.enabled === false ? 0 : 1;
    const key = String(s.key || '').trim();
    const enc = key ? encrypt(key) : '';
    const hint = key ? maskKey(key) : '';
    await upsert.run(userId, work, slot, provider, model, enc, hint, enabled);
  }
  return { ok: true };
}

async function deleteKey(userId, keyId) {
  const row = await db.prepare('SELECT id, work FROM ai_keys WHERE id = ? AND user_id = ?').get(keyId, userId);
  if (!row) return { error: 'Key not found' };
  await db.prepare('DELETE FROM ai_keys WHERE id = ?').run(keyId);
  if (activeKeyId[row.work] === keyId) activeKeyId[row.work] = null;
  return { ok: true };
}

/** Mark a key's status; rotates away from unhealthy keys. */
async function setKeyStatus(userId, work, keyId, status, error = '') {
  await db.prepare("UPDATE ai_keys SET status = ?, last_error = ?, last_tested_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(status, String(error).slice(0, 500), keyId, userId);
  if (activeKeyId[work] === keyId && ['RATE_LIMITED', 'QUOTA_EXCEEDED', 'INVALID'].includes(status)) {
    activeKeyId[work] = null;
  }
}

/**
 * Resolve the key to use for a work, rotating only when the current
 * healthy key is unavailable. Never rotates on every request.
 */
async function resolveKey(userId, work) {
  const rows = (await listKeys(userId, work)).filter((k) => k.enabled);
  if (!rows.length) return { configured: false };

  const usable = (k) => !['RATE_LIMITED', 'QUOTA_EXCEEDED', 'INVALID', 'DISABLED'].includes(k.status);

  let key = rows.find((k) => k.id === activeKeyId[work] && usable(k));
  if (!key) {
    key = rows.find((k) => usable(k)) || null;
    if (key) activeKeyId[work] = key.id;
  }
  if (!key) {
    const first = rows[0];
    const status = first.status === 'INVALID' ? 'INVALID' : 'QUOTA_EXCEEDED';
    return { configured: true, error: `All keys for AI Work ${work} (${WORKS[work]}) are currently ${status.toLowerCase()}.`, work };
  }

  const decrypted = decrypt(key.encrypted_key);
  return { configured: true, key: { id: key.id, apiKey: decrypted, provider: key.provider, model: key.model }, work };
}

/** Test a single stored key against its provider. */
async function testKey(userId, keyId) {
  const row = await db.prepare('SELECT * FROM ai_keys WHERE id = ? AND user_id = ?').get(keyId, userId);
  if (!row) return { error: 'Key not found' };

  const apiKey = decrypt(row.encrypted_key);
  const model = row.model || PROVIDERS[row.provider]?.models?.[0] || 'gemini-2.5-flash';
  try {
    const out = await chat({
      provider: row.provider, apiKey, model,
      system: 'You are a connectivity test.',
      user: 'Reply with exactly: OK',
    });
    await setKeyStatus(userId, row.work, row.id, 'ACTIVE');
    return { ok: true, message: 'API Key Working', latencyMs: out.latencyMs, provider: row.provider, model };
  } catch (e) {
    const category = safeCategory(e);
    const status = category === 'INVALID_KEY' ? 'INVALID'
      : category === 'RATE_LIMITED' ? 'RATE_LIMITED'
      : category === 'QUOTA_EXCEEDED' ? 'QUOTA_EXCEEDED'
      : 'UNKNOWN';
    await setKeyStatus(userId, row.work, row.id, status, e.message);
    const friendly = {
      INVALID_KEY: 'Invalid API Key', RATE_LIMITED: 'Rate Limited',
      QUOTA_EXCEEDED: 'Quota Exceeded', TIMEOUT: 'Request timed out',
      NETWORK: 'Network error', MODEL_UNAVAILABLE: 'Model unavailable', SERVER: 'Provider server error',
    }[category] || 'Verification failed';
    return { ok: false, message: friendly, category, detail: e.message };
  }
}

/** Run one chat call through the work's key pool with automatic rotation. */
async function runWithRotation(userId, work, system, user) {
  let resolved = await resolveKey(userId, work);
  if (!resolved.configured) return { configured: false, work };

  let attempts = 0;
  while (attempts < MAX_KEYS_PER_WORK) {
    if (resolved.error) return { configured: true, error: resolved.error, work };
    try {
      const out = await chat({ provider: resolved.key.provider, apiKey: resolved.key.apiKey, model: resolved.key.model, system, user });
      await setKeyStatus(userId, work, resolved.key.id, 'ACTIVE');
      return { configured: true, ...out, work };
    } catch (e) {
      const category = safeCategory(e);
      const status = category === 'INVALID_KEY' ? 'INVALID'
        : category === 'RATE_LIMITED' ? 'RATE_LIMITED'
        : category === 'QUOTA_EXCEEDED' ? 'QUOTA_EXCEEDED'
        : category === 'MODEL_UNAVAILABLE' ? 'UNKNOWN'
        : category === 'TIMEOUT' || category === 'NETWORK' || category === 'SERVER' ? 'RATE_LIMITED' // transient -> try next
        : 'UNKNOWN';
      await setKeyStatus(userId, work, resolved.key.id, status, e.message);
      attempts += 1;
      resolved = await resolveKey(userId, work);
    }
  }
  return { configured: true, error: 'All keys for this AI work are unavailable.', work };
}

// ── AI Models (add / verify / primary / disable / remove) ─────
async function listModels(userId) {
  return db.prepare(
    'SELECT id, provider, model, endpoint, key_hint, status, verified_at, is_primary, enabled, last_error, last_error_category, latency_ms, created_at FROM ai_models WHERE user_id = ? ORDER BY is_primary DESC, id DESC'
  ).all(userId);
}

async function verifyModel(userId, { provider, model, apiKey, endpoint }) {
  const p = String(provider || '').trim();
  const m = String(model || '').trim();
  const k = String(apiKey || '').trim();
  if (!PROVIDERS[p]) return { ok: false, category: 'SERVER', message: 'Unsupported provider' };
  if (!m) return { ok: false, category: 'MODEL_UNAVAILABLE', message: 'Model is required' };
  if (!k) return { ok: false, category: 'INVALID_KEY', message: 'API key is required' };

  const started = Date.now();
  try {
    await chat({ provider: p, apiKey: k, model: m, system: 'Connectivity test.', user: 'Reply with exactly: OK' });
    return { ok: true, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, category: safeCategory(e), message: e.message };
  }
}

async function saveModel(userId, data) {
  const enc = data.apiKey ? encrypt(data.apiKey) : '';
  if (!enc) return { error: 'API key is required' };
  const info = await db.prepare(
    `INSERT INTO ai_models (user_id, provider, model, endpoint, encrypted_key, key_hint, status, verified_at, is_primary, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, 'CONNECTED', datetime('now'), 0, ?)`
  ).run(userId, data.provider, data.model, data.endpoint || '', enc, maskKey(data.apiKey), data.latencyMs || 0);
  return { ok: true, id: info.lastInsertRowid };
}

/** Test a stored model using its encrypted key (fresh verification). */
async function testModel(userId, modelId) {
  const row = await db.prepare('SELECT * FROM ai_models WHERE id = ? AND user_id = ?').get(modelId, userId);
  if (!row) return { error: 'Model not found' };
  const apiKey = decrypt(row.encrypted_key);
  const started = Date.now();
  try {
    await chat({ provider: row.provider, apiKey, model: row.model, system: 'Connectivity test.', user: 'Reply with exactly: OK' });
    await db.prepare("UPDATE ai_models SET status = 'CONNECTED', verified_at = datetime('now'), latency_ms = ?, last_error = '', last_error_category = '' WHERE id = ?")
      .run(Date.now() - started, modelId);
    return { ok: true, message: 'Connection healthy', latencyMs: Date.now() - started };
  } catch (e) {
    const category = safeCategory(e);
    const status = category === 'INVALID_KEY' ? 'FAILED' : 'VERIFICATION_REQUIRED';
    await db.prepare('UPDATE ai_models SET status = ?, last_error = ?, last_error_category = ? WHERE id = ?')
      .run(status, String(e.message).slice(0, 500), category, modelId);
    return { ok: false, message: e.message, category };
  }
}

async function setPrimary(userId, modelId) {
  const row = await db.prepare('SELECT id FROM ai_models WHERE id = ? AND user_id = ?').get(modelId, userId);
  if (!row) return { error: 'Model not found' };
  await db.prepare('UPDATE ai_models SET is_primary = 0 WHERE user_id = ?').run(userId);
  await db.prepare('UPDATE ai_models SET is_primary = 1 WHERE id = ?').run(modelId);
  return { ok: true };
}

async function setModelEnabled(userId, modelId, enabled) {
  const row = await db.prepare('SELECT id FROM ai_models WHERE id = ? AND user_id = ?').get(modelId, userId);
  if (!row) return { error: 'Model not found' };
  await db.prepare('UPDATE ai_models SET enabled = ?, status = ? WHERE id = ?')
    .run(enabled ? 1 : 0, enabled ? 'CONNECTED' : 'DISABLED', modelId);
  return { ok: true };
}

async function removeModel(userId, modelId) {
  const row = await db.prepare('SELECT id FROM ai_models WHERE id = ? AND user_id = ?').get(modelId, userId);
  if (!row) return { error: 'Model not found' };
  await db.prepare('DELETE FROM ai_models WHERE id = ?').run(modelId);
  return { ok: true };
}

module.exports = {
  WORKS, MAX_KEYS_PER_WORK, PROVIDERS,
  listKeys, listAllKeys, saveKeys, deleteKey, setKeyStatus, resolveKey, testKey, runWithRotation,
  listModels, verifyModel, saveModel, testModel, setPrimary, setModelEnabled, removeModel,
};
