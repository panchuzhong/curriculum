// Must set JWT_SECRET before any import that triggers auth.js module-level check
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long';

import { vi, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const container = { drizzleDb: null, db: null };
const snapshotDir = mkdtempSync(join(tmpdir(), 'curriculum-route-test-'));
afterAll(() => rmSync(snapshotDir, { recursive: true, force: true }));

vi.mock('../db/index.js', () => ({
  get drizzleDb() { return container.drizzleDb; },
  get db() { return container.db; },
  initDb: vi.fn(),
  // backup.js writes pre-restore snapshots beside the database file.
  get dbDir() { return snapshotDir; },
}));
vi.mock('../db/seed.js', () => ({
  seedPricingTiers: vi.fn(),
  getDefaultPrice: vi.fn(() => 100),
}));
vi.mock('../services/audit.js', () => ({
  logAudit: vi.fn(),
  MAX_AUDIT_ROWS: 10000,
  trimAuditLog: vi.fn(({ teacherId, keep = 10000 }) => {
    const keepCount = Math.max(0, Math.min(Number(keep) || 0, 10000));
    const count = container.db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE teacher_id = ?').get(teacherId).c;
    const deleteCount = Math.max(0, count - keepCount);
    if (deleteCount > 0) {
      container.db.prepare(
        `DELETE FROM audit_log
         WHERE id IN (
           SELECT id FROM audit_log
           WHERE teacher_id = ?
           ORDER BY id ASC
           LIMIT ?
         )`
      ).run(teacherId, deleteCount);
    }
    return { keep: keepCount, before: count, deleted: deleteCount, remaining: count - deleteCount };
  }),
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
