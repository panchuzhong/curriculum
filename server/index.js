import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
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
import geocodeRoutes from './routes/geocode.js';

const app = express();

// Backup restore payloads may be up to 50MB. That parser lives in backup.js
// behind its authMiddleware, so an anonymous client never gets a large body
// parsed; the global 1MB parser must skip the path or it would reject first.
const jsonParser = express.json({ limit: '1mb' });
// Strict routing is off, so "/api/backup/restore/" reaches the route too; the
// exemption must ignore trailing slashes or that spelling hits the 1MB parser.
const isRestorePath = (path) => path.replace(/\/+$/, '') === '/api/backup/restore';
app.use((req, res, next) => (isRestorePath(req.path) ? next() : jsonParser(req, res, next)));
// Express 5 leaves req.body undefined when no JSON body was sent; the update
// handlers iterate it (Object.entries), so a bodiless PUT must see {} and get
// the intended 400 instead of a TypeError 500.
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');
  next();
});

// CORS: restrict to same origin
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const { host } = new URL(origin);
      if (host === req.headers.host) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    } catch { /* malformed Origin (e.g. "null") — ignore */ }
  }
  next();
});

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

// Rate limiting for data-modifying endpoints
const writeLimiter = rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, legacyHeaders: false });

// Public routes
// auth routes must come before agentHelpRoutes to allow unauthenticated login/register
app.use('/api/auth', authRoutes);
app.use('/api/agent', agentHelpRoutes);

// Write rate limiting (POST/PUT/DELETE only)
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) return writeLimiter(req, res, next);
  next();
});

app.use('/api/classes', classRoutes);
app.use('/api/pricing-tiers', pricingTierRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/semesters', semesterRoutes);
app.use('/api/schedule-image', scheduleImageRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/audit-log', auditLogRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/geocode', geocodeRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Unknown API paths must return JSON 404, never the SPA fallback below
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve static files in production
if (existsSync('./dist')) {
  // CSP only applies to the SPA responses (mounted after all /api routes).
  // style-src needs 'unsafe-inline' for React style attributes.
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
      "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    next();
  });
  app.use(express.static('./dist'));
  app.get('/{*splat}', (req, res) => res.sendFile('index.html', { root: './dist' }));
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  // Honor parser/route error statuses (e.g. body-parser 413) instead of 500
  res.status(err.status || err.statusCode || 500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 8443;
const HOST = process.env.HOST || '127.0.0.1';
let server = null;
// Test suites import this module for supertest without binding a port
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, HOST, () => console.log(`Server running on http://${HOST}:${PORT}`));
  server.timeout = 300000; // 5 minutes for image generation and backup endpoints
}

if (server) {
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
}

export default app;
