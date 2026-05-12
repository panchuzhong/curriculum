// Must set JWT_SECRET before any import that triggers auth.js module-level check
process.env.JWT_SECRET = 'test-secret-key';

import { vi } from 'vitest';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const container = { drizzleDb: null, db: null };

vi.mock('../db/index.js', () => ({
  get drizzleDb() { return container.drizzleDb; },
  get db() { return container.db; },
  initDb: vi.fn(),
}));
vi.mock('../db/seed.js', () => ({
  seedPricingTiers: vi.fn(),
  getDefaultPrice: vi.fn(() => 100),
}));
vi.mock('../services/audit.js', () => ({
  logAudit: vi.fn(),
}));

function signToken(teacherId) {
  return jwt.sign({ teacherId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

export async function setupApp(routePath, routeModuleImport) {
  const { createTestDb } = await import('./setup.js');
  const t = createTestDb();
  container.drizzleDb = t.drizzleDb;
  container.db = t.db;
  // Clear module-level caches when a new test DB is created (stale data from prior test DBs)
  const { clearSemesterCache } = await import('../services/schedule-helpers.js');
  clearSemesterCache();
  const routes = (await import(routeModuleImport)).default;
  const app = express();
  app.use(express.json());
  app.use(routePath, routes);
  return { app, drizzleDb: t.drizzleDb };
}

export async function makeUser(drizzleDb, username = 'testuser') {
  const { teachers } = await import('../db/schema.js');
  const hash = bcrypt.hashSync('pass123', 10);
  const r = drizzleDb.insert(teachers).values({
    username, passwordHash: hash, name: username, apiKey: `key-${username}`,
    subjects: JSON.stringify(['数学', '物理']),
  }).run();
  const id = Number(r.lastInsertRowid);
  return { id, token: signToken(id) };
}

export function auth(token) {
  return { Authorization: `Bearer ${token}` };
}
