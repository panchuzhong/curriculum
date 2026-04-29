import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import { initDb } from './db/index.js';
import authRoutes from './routes/auth.js';
import agentHelpRoutes from './routes/agent-help.js';

const app = express();
app.use(cors());
app.use(express.json());

// Init DB
initDb();

// Public routes
app.use('/api', agentHelpRoutes);
app.use('/api/auth', authRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Serve static files in production
if (existsSync('./dist')) {
  app.use(express.static('./dist'));
  app.get('{*path}', (req, res) => res.sendFile('index.html', { root: './dist' }));
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
