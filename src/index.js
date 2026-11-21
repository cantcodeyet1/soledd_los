require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { testConnection } = require('./models/supabase');
const webhookRoutes = require('./routes/webhook.routes');
const adminRoutes = require('./routes/admin.routes');
const authRoutes = require('./routes/auth.routes');
const { authenticate } = require('./middleware/auth');
const keepAlive = require('./services/keepAlive.service');
const weeklySummary = require('./services/weeklySummary.service');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  // Health pings arrive every few minutes - keep them out of the logs.
  if (!req.path.startsWith('/health')) console.log(`${req.method} ${req.path}`);
  next();
});

// Meta has been observed posting to both paths depending on how the
// webhook subscription was configured — mount both to be safe.
app.use('/api/webhook', webhookRoutes);
app.use('/webhook', webhookRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/admin', authenticate, adminRoutes);

// Cheap liveness check - no database. Wakes the server from a Render sleep.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Liveness + a real database round trip. Point a free external pinger
// (UptimeRobot / cron-job.org, every 5 min) at this: it keeps Render awake
// AND counts as Supabase activity, and returns 503 if the database is down.
app.get('/health/db', async (req, res) => {
  const db = await keepAlive.pingDatabase();
  res.status(db.ok ? 200 : 503).json({
    status: db.ok ? 'ok' : 'degraded',
    database: db.ok ? 'ok' : 'unreachable',
    db_ms: db.ms,
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.json({ name: 'Soledd LOS WhatsApp Bot', version: '1.0.0', status: 'running' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.warn('⚠️  Database connection failed, but server will start anyway');
  }

  app.listen(PORT, () => {
    console.log(`\nSoledd LOS WhatsApp Bot running on http://localhost:${PORT}\n`);
    keepAlive.start();
    weeklySummary.start();
  });
}

start();
