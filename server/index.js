import 'dotenv/config';
import express from 'express';
import { existsSync } from 'fs';
import { initDb } from './db/index.js';
import authRoutes from './routes/auth.js';
import agentHelpRoutes from './routes/agent-help.js';
import classRoutes from './routes/classes.js';
import pricingTierRoutes from './routes/pricing-tiers.js';
import studentRoutes from './routes/students.js';
import scheduleRoutes from './routes/schedules.js';
import semesterRoutes from './routes/semesters.js';
import scheduleImageRoutes from './routes/schedule-image.js';
import holidayRoutes from './routes/holidays.js';
import auditLogRoutes from './routes/audit-log.js';
import backupRoutes from './routes/backup.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return origJson(body);
  };
  next();
});

// Init DB
initDb();

// Public routes
app.use('/api', agentHelpRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/pricing-tiers', pricingTierRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/semesters', semesterRoutes);
app.use('/api/schedule-image', scheduleImageRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/audit-log', auditLogRoutes);
app.use('/api/backup', backupRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Serve static files in production
if (existsSync('./dist')) {
  app.use(express.static('./dist'));
  app.get('*', (req, res) => res.sendFile('index.html', { root: './dist' }));
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 8443;
const HOST = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => console.log(`Server running on http://${HOST}:${PORT}`));

process.on('SIGTERM', async () => {
  const { closeBrowser } = await import('./services/browser.js');
  await closeBrowser();
  server.close();
});
process.on('SIGINT', async () => {
  const { closeBrowser } = await import('./services/browser.js');
  await closeBrowser();
  server.close();
});
