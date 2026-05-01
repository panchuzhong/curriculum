import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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
app.use(cors());
app.use(express.json());

// Init DB
initDb();

// Public routes
app.use('/api', agentHelpRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/pricing-tiers', pricingTierRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/classes', studentRoutes);
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
