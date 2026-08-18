const express = require('express');
const cors = require('cors');
const config = require('./config');
const db = require('./db');
const scheduler = require('./services/scheduler');
const angleOne = require('./services/angleOneService');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const marketRoutes = require('./routes/market');
const newsRoutes = require('./routes/news');
const aiRoutes = require('./routes/ai');
const notificationRoutes = require('./routes/notifications');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    name: 'VARUN TEJ API',
    time: new Date().toISOString(),
    scheduler: scheduler.getStatus(),
    angelOne: angleOne.getLoginStatus(),
    liveStream: angleOne.getStreamStatus(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/notifications', notificationRoutes);

// 404 + error handling
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('[server]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

db.ready()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`VARUN TEJ API listening on http://localhost:${config.port}`);
      scheduler.start();
      angleOne.startStream(); // Angel One WebSocket live quotes (non-blocking, self-retrying)
    });
  })
  .catch((e) => {
    console.error('[server] failed to initialize database:', e.message);
    process.exit(1);
  });
