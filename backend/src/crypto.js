const crypto = require('crypto');
const config = require('./config');

const KEY = crypto.createHash('sha256').update(config.encryptionKey).digest();

/** Encrypt a secret with AES-256-GCM. Returns "iv:tag:ciphertext" (base64). */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/** Decrypt a value produced by encrypt(). */
function decrypt(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

/** Show only last 4 chars of a secret, e.g. "************42" */
function maskKey(secret) {
  const s = String(secret || '');
  if (!s) return '';
  if (s.length <= 6) return '*'.repeat(s.length);
  return '*'.repeat(s.length - 4) + s.slice(-4);
}

module.exports = { encrypt, decrypt, sha256, randomToken, maskKey };
