const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { sha256 } = require('../crypto');

/** Verify Bearer token against stored session. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const session = await db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0').get(sha256(token));
    if (!session || session.expires_at < Date.now()) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    const user = await db.prepare(
      'SELECT id, email, phone, username, name, profile_pic, security_pin_hash, biometric_enabled FROM users WHERE id = ?'
    ).get(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    req.session = session;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }
}

module.exports = { requireAuth };
