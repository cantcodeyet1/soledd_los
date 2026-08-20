require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { testConnection } = require('./models/supabase');
const webhookRoutes = require('./routes/webhook.routes');
const adminRoutes = require('./routes/admin.routes');
const authRoutes = require('./routes/auth.routes');
const { authenticate } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Meta has been observed posting to both paths depending on how the
// webhook subscription was configured — mount both to be safe.
app.use('/api/webhook', webhookRoutes);
app.use('/webhook', webhookRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/admin', authenticate, adminRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
  });
}

start();
