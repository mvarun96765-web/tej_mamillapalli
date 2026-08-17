// override: true so backend/.env always wins over machine-level env vars
require('dotenv').config({ override: true });

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

module.exports = {
  port: int(process.env.PORT, 8080),
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  encryptionKey: process.env.ENCRYPTION_KEY || 'dev-insecure-encryption-key',
  // MongoDB (Atlas) connection string; the app stores data in the database named by mongoDbName.
  databaseUrl: process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/varuntej',
  mongoDbName: process.env.MONGO_DB_NAME || 'varuntej',

  // Angel One
  angelone: {
    apiKey: process.env.ANGELONE_API_KEY || '',
    clientCode: process.env.ANGELONE_CLIENT_CODE || '',
    totpSecret: process.env.ANGELONE_TOTP_SECRET || '',
    pin: process.env.ANGELONE_PIN || '',
  },

  // News (Marketaux — free plan ~100 req/day, max 3 articles/request)
  news: {
    apiKey: process.env.MARKETAUX_API_KEY || process.env.NEWS_API_KEY || '',
    baseUrl: process.env.NEWS_API_BASE || 'https://api.marketaux.com/v1',
    intervalSeconds: int(process.env.NEWS_INTERVAL_SECONDS, 220),
    maxArticlesPerRequest: int(process.env.NEWS_ARTICLES_PER_REQUEST, 3),
    // Collection window: 08:00 - 14:00 IST (~98 requests/day at 3m40s, fits the 100/day free cap)
    windowOpenHour: int(process.env.NEWS_WINDOW_OPEN_HOUR, 8),
    windowOpenMinute: int(process.env.NEWS_WINDOW_OPEN_MINUTE, 0),
    windowCloseHour: int(process.env.NEWS_WINDOW_CLOSE_HOUR, 14),
    windowCloseMinute: int(process.env.NEWS_WINDOW_CLOSE_MINUTE, 0),
    // Morning catch-up: news published between the previous day's 02:00 PM IST
    // and the current day's window open are collected as a priority at 08:00.
    prevDayCatchupHour: int(process.env.NEWS_CATCHUP_FROM_HOUR, 14),
    prevDayCatchupMinute: int(process.env.NEWS_CATCHUP_FROM_MINUTE, 0),
  },

  // AI
  ai: {
    work1: { provider: process.env.AI_WORK1_PROVIDER || 'google', model: process.env.AI_WORK1_MODEL || 'gemini-2.5-flash' },
    work2: { provider: process.env.AI_WORK2_PROVIDER || 'google', model: process.env.AI_WORK2_MODEL || 'gemini-2.5-flash' },
    work3: { provider: process.env.AI_WORK3_PROVIDER || 'google', model: process.env.AI_WORK3_MODEL || 'gemini-2.5-flash' },
  },

  // Market session (Asia/Kolkata)
  market: {
    openHour: int(process.env.MARKET_OPEN_HOUR, 9),
    openMinute: int(process.env.MARKET_OPEN_MINUTE, 0),
    closeHour: int(process.env.MARKET_CLOSE_HOUR, 15),
    closeMinute: int(process.env.MARKET_CLOSE_MINUTE, 0),
    timezone: 'Asia/Kolkata',
  },

  fcmServiceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON || '',
};
