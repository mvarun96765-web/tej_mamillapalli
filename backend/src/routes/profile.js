const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const wrap = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth);

// ── Name ───────────────────────────────────────────────────────
router.put('/name', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 60) return res.status(400).json({ error: 'Enter a valid name (max 60 characters)' });
  await db.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, req.user.id);
  res.json({ ok: true, name });
}));

// ── Username (backend-enforced uniqueness) ─────────────────────
router.put('/username', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: '3-20 characters: letters, numbers or underscore only' });
  }
  const clash = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.user.id);
  if (clash) return res.status(409).json({ error: 'Username already exists' });
  await db.prepare("UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?").run(username, req.user.id);
  res.json({ ok: true, username });
}));

router.post('/username/check', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.json({ available: false, message: '3-20 characters: letters, numbers or underscore only' });
  }
  const clash = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.user.id);
  res.json({ available: !clash, message: clash ? 'Username already exists' : 'Username available' });
}));

// ── Profile picture (base64 image stored on the account) ───────
router.put('/picture', wrap(async (req, res) => {
  const pic = String(req.body.profilePic || '');
  // Limit stored size (~600 KB base64) to keep the DB lean.
  if (pic.length > 900_000) return res.status(400).json({ error: 'Image too large' });
  await db.prepare("UPDATE users SET profile_pic = ?, updated_at = datetime('now') WHERE id = ?").run(pic, req.user.id);
  res.json({ ok: true });
}));

router.delete('/picture', wrap(async (req, res) => {
  await db.prepare("UPDATE users SET profile_pic = ?, updated_at = datetime('now') WHERE id = ?").run('', req.user.id);
  res.json({ ok: true });
}));

// ── Security PIN (never stored as plain text) ──────────────────
router.put('/pin', wrap(async (req, res) => {
  const pin = String(req.body.pin || '');
  if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4-6 digits' });
  await db.prepare('UPDATE users SET security_pin_hash = ? WHERE id = ?').run(bcrypt.hashSync(pin, 10), req.user.id);
  res.json({ ok: true, message: 'Security PIN saved' });
}));

router.put('/biometric', wrap(async (req, res) => {
  const enabled = req.body.enabled ? 1 : 0;
  await db.prepare('UPDATE users SET biometric_enabled = ? WHERE id = ?').run(enabled, req.user.id);
  res.json({ ok: true, biometric_enabled: !!enabled });
}));

router.post('/pin/verify', wrap(async (req, res) => {
  const pin = String(req.body.pin || '');
  const row = await db.prepare('SELECT security_pin_hash FROM users WHERE id = ?').get(req.user.id);
  const ok = row && row.security_pin_hash && bcrypt.compareSync(pin, row.security_pin_hash);
  if (!ok) return res.status(401).json({ error: 'Incorrect PIN' });
  res.json({ ok: true });
}));

// ── App settings (appearance, server url) ──────────────────────
router.get('/settings', wrap(async (req, res) => {
  const s = await db.prepare('SELECT * FROM app_settings WHERE user_id = ?').get(req.user.id);
  res.json({ settings: s || { theme: 'system', server_url: '' } });
}));

router.put('/settings', wrap(async (req, res) => {
  const { theme, serverUrl } = req.body;
  await db.prepare(
    `INSERT INTO app_settings (user_id, theme, server_url) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET theme = COALESCE(?, theme), server_url = COALESCE(?, server_url)`
  ).run(req.user.id, theme || 'system', serverUrl || '', theme || null, serverUrl || null);
  res.json({ ok: true });
}));

module.exports = router;
