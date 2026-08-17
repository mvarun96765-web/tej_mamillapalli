const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { sha256, randomToken } = require('../crypto');
const { requireAuth } = require('../middleware/auth');
const wrap = require('../asyncHandler');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

function passwordIssues(pw) {
  const issues = [];
  if (pw.length < 8) issues.push('At least 8 characters required');
  if (!/[a-z]/.test(pw)) issues.push('At least one lowercase letter');
  if (!/[A-Z]/.test(pw)) issues.push('At least one uppercase letter');
  if (/\d/.test(pw) === false) issues.push('At least one number');
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push('At least one special character');
  return issues;
}

/** Validate YYYY-MM-DD, real calendar date, not in the future. */
function validDob(value) {
  if (!DOB_RE.test(String(value))) return false;
  const [y, m, d] = String(value).split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false;
  if (date.getTime() > Date.now()) return false; // no future dates
  return true;
}

async function createSession(userId) {
  const ttl = 30 * 24 * 60 * 60 * 1000; // 30 days
  const accessToken = jwt.sign({ sub: userId, type: 'access' }, config.jwtSecret, { expiresIn: '30d' });
  const refresh = randomToken(32);
  await db.prepare(
    `INSERT INTO sessions (user_id, token_hash, refresh_hash, expires_at) VALUES (?, ?, ?, ?)`
  ).run(userId, sha256(accessToken), sha256(refresh), Date.now() + ttl);
  return { accessToken, refreshToken: refresh, expiresInMs: ttl };
}

// ── Signup (Username, Email, Date of Birth, Password, Confirm) ─
router.post('/signup', wrap(async (req, res) => {
  const { username, email, dob, password, confirmPassword } = req.body;

  const usernameStr = String(username || '').trim().toLowerCase();
  const emailStr = String(email || '').trim().toLowerCase();
  const dobStr = String(dob || '').trim();
  const passwordStr = String(password || '');

  if (!usernameStr || !emailStr || !dobStr || !passwordStr) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!USERNAME_RE.test(usernameStr)) {
    return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers or underscore only' });
  }
  if (!EMAIL_RE.test(emailStr)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (!validDob(dobStr)) {
    return res.status(400).json({ error: 'Enter a valid date of birth (YYYY-MM-DD)' });
  }
  if (passwordStr !== String(confirmPassword || '')) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }
  const issues = passwordIssues(passwordStr);
  if (issues.length) return res.status(400).json({ error: issues.join('. ') + '.' });

  if (await db.prepare('SELECT id FROM users WHERE username = ?').get(usernameStr)) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  if (await db.prepare('SELECT id FROM users WHERE email = ?').get(emailStr)) {
    return res.status(409).json({ error: 'This email is already registered' });
  }

  const hash = bcrypt.hashSync(passwordStr, 10);
  const info = await db.prepare(
    `INSERT INTO users (email, username, name, dob, password_hash) VALUES (?, ?, ?, ?, ?)`
  ).run(emailStr, usernameStr, usernameStr, dobStr, hash);

  await db.prepare(`INSERT INTO notification_preferences (user_id) VALUES (?) ON CONFLICT DO NOTHING`).run(info.lastInsertRowid);
  await db.prepare(`INSERT INTO app_settings (user_id) VALUES (?) ON CONFLICT DO NOTHING`).run(info.lastInsertRowid);

  res.json({ ok: true, message: 'Account created successfully' });
}));

// ── Username availability (inline check on the signup form) ────
router.post('/signup/username/check', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return res.json({ available: false, message: '3-20 characters: letters, numbers or underscore only' });
  }
  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  res.json({ available: !existing, message: existing ? 'Username already exists' : 'Username available' });
}));

// ── Login (Username + Password only) ───────────────────────────
router.post('/login', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Enter username and password' });

  const user = await db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const session = await createSession(user.id);
  const { password_hash, security_pin_hash, ...safe } = user;
  res.json({ ok: true, session, user: safe });
}));

// ── Forgot password: verify identity with date of birth ────────
// Step 1: identify the account by username/email and confirm the
// user-supplied date of birth exactly matches the stored DOB.
// On success a short-lived reset token is returned (no OTP involved).
router.post('/forgot/verify', wrap(async (req, res) => {
  const identifier = String(req.body.identifier || '').trim().toLowerCase();
  const dob = String(req.body.dob || '').trim();
  if (!identifier) return res.status(400).json({ error: 'Enter your username or email' });
  if (!validDob(dob)) return res.status(400).json({ error: 'Enter your date of birth (YYYY-MM-DD)' });

  const user = await db.prepare('SELECT id, dob FROM users WHERE username = ? OR email = ?').get(identifier, identifier);
  // Security-safe: do not reveal whether the account exists or which field was wrong.
  if (!user || !user.dob || user.dob !== dob) {
    return res.status(401).json({ error: 'The details you entered do not match our records. Please try again.' });
  }

  // Short-lived reset token bound to the account.
  const resetToken = jwt.sign({ sub: user.id, type: 'password_reset' }, config.jwtSecret, { expiresIn: '15m' });
  res.json({ ok: true, resetToken });
}));

// Step 2: set the new password with the reset token.
router.post('/forgot/reset', wrap(async (req, res) => {
  const { resetToken, newPassword, confirmPassword } = req.body;
  const passwordStr = String(newPassword || '');
  if (!resetToken) return res.status(400).json({ error: 'Reset token missing. Start again.' });
  if (passwordStr !== String(confirmPassword || '')) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }
  const issues = passwordIssues(passwordStr);
  if (issues.length) return res.status(400).json({ error: issues.join('. ') + '.' });

  let payload;
  try {
    payload = jwt.verify(String(resetToken), config.jwtSecret);
  } catch (e) {
    return res.status(401).json({ error: 'Reset link expired or invalid. Start again.' });
  }
  if (!payload || payload.type !== 'password_reset') {
    return res.status(401).json({ error: 'Invalid reset token. Start again.' });
  }

  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(payload.sub);
  if (!user) return res.status(404).json({ error: 'Account not found' });

  const hash = bcrypt.hashSync(passwordStr, 10);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  await db.prepare(`UPDATE sessions SET revoked = 1 WHERE user_id = ?`).run(user.id);
  res.json({ ok: true, message: 'Password updated successfully' });
}));

// ── Session management ─────────────────────────────────────────
router.get('/me', requireAuth, wrap(async (req, res) => {
  const user = await db.prepare(
    'SELECT id, email, phone, username, name, dob, profile_pic, email_verified, phone_verified, biometric_enabled FROM users WHERE id = ?'
  ).get(req.user.id);
  if (user) user.security_pin_set = !!req.user.security_pin_hash;
  res.json({ user });
}));

router.post('/logout', requireAuth, wrap(async (req, res) => {
  await db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(req.session.id);
  res.json({ ok: true });
}));

// Re-issue a session from a refresh token (session persistence across app restarts).
router.post('/refresh', wrap(async (req, res) => {
  const refresh = String(req.body.refreshToken || '');
  const session = await db.prepare('SELECT * FROM sessions WHERE refresh_hash = ? AND revoked = 0').get(sha256(refresh));
  if (!session || session.expires_at < Date.now()) {
    return res.status(401).json({ error: 'Session expired' });
  }
  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found' });

  await db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(session.id);
  const fresh = await createSession(user.id);
  res.json({ ok: true, session: fresh });
}));

module.exports = router;
