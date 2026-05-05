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
app.use(express.json({ limit: '10mb' }));

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
  app.get('{*path}', (req, res) => res.sendFile('index.html', { root: './dist' }));
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
