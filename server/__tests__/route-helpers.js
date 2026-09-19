// Must set JWT_SECRET before any import that triggers auth.js module-level check
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long';

import { vi, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import errorHandler from '../error-handler.js';

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
// 用真的：这里原本把 getDefaultPrice 打成固定返回 100，于是唯一一条
// 「按定价阶梯自动填单价」的用例断言的其实是这个 100 本身——阶梯逻辑一行都没跑过，
// 把 getDefaultPrice 的区间判断放宽成开区间（每档默认阶梯都是 min===max）也全绿。
vi.mock('../db/seed.js', async () => ({
  ...(await vi.importActual('../db/seed.js')),
}));
vi.mock('../services/audit.js', async () => ({
  // trimAuditLog 用真的：它此前被这里手抄了一份 SQL，于是每条清理用例验的都是
  // 抄件，生产实现一行都没跑过（把它的 ORDER BY 改反，整个套件照样全绿）。
  ...(await vi.importActual('../services/audit.js')),
  // logAudit 仍然打掉：它会往每个路由用例里写审计行，而那些用例在数各自表的条数。
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
  // 和 server/index.js 挂同一个：不挂的话测试里的 500 是 Express 默认的 HTML 错误页，
  // 跟生产返回的 JSON 不是一回事，这个处理器也就没有任何用例盯得住。
  app.use(errorHandler);
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
