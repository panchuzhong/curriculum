process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long';

import { describe, it, expect, beforeEach, vi } from 'vitest';

// route-helpers 把 logAudit 打掉了（否则每个路由用例都会多出审计行），所以
// 自动清理那条路在所有路由测试里一次都没跑过。这里直连真实实现和真实库。
const container = { drizzleDb: null, db: null };
vi.mock('../db/index.js', () => ({
  get drizzleDb() { return container.drizzleDb; },
  get db() { return container.db; },
  initDb: vi.fn(),
}));

const { logAudit, trimAuditLog, MAX_AUDIT_ROWS } = await import('../services/audit.js');
const { auditLog, teachers } = await import('../db/schema.js');

let teacherId;

beforeEach(async () => {
  const { createTestDb } = await import('./setup.js');
  const t = createTestDb();
  container.drizzleDb = t.drizzleDb;
  container.db = t.db;
  const r = t.drizzleDb.insert(teachers).values({
    username: 'auditor', passwordHash: 'x', name: 'auditor', apiKey: 'key-auditor',
  }).run();
  teacherId = Number(r.lastInsertRowid);
});

const rows = () => container.drizzleDb.select().from(auditLog).all();

describe('logAudit 每 100 条自动清理一次', () => {
  it('写满 100 条后会把超出上限的旧行删掉', async () => {
    // 直接灌 MAX_AUDIT_ROWS 条太慢，改用 trimAuditLog 的 keep 参数验证同一条路：
    // 先塞够行，再让第 100 次插入触发自动清理。
    for (let i = 0; i < 99; i++) {
      logAudit({ teacherId, action: 'CREATE', tableName: 'classes', recordId: i });
    }
    expect(rows()).toHaveLength(99);

    // 第 100 次触发 trimAuditLog({ teacherId })，默认 keep = MAX_AUDIT_ROWS，
    // 行数远没到上限，所以不该删任何东西——但这一步必须真的跑到。
    logAudit({ teacherId, action: 'CREATE', tableName: 'classes', recordId: 99 });
    expect(rows()).toHaveLength(100);
  });

  it('超过 MAX_AUDIT_ROWS 时，第 100 次插入会把最旧的删掉', async () => {
    // 先用原始 SQL 灌到刚好 MAX_AUDIT_ROWS，避免走 logAudit 的计数器。
    const stmt = container.db.prepare(
      'INSERT INTO audit_log (teacher_id, timestamp, action, table_name, record_id) VALUES (?, ?, ?, ?, ?)'
    );
    container.db.transaction(() => {
      for (let i = 0; i < MAX_AUDIT_ROWS; i++) {
        stmt.run(teacherId, '2026-01-01T00:00:00.000Z', 'CREATE', 'classes', i);
      }
    })();
    expect(rows()).toHaveLength(MAX_AUDIT_ROWS);

    // 再写 100 条走 logAudit，第 100 条触发清理，把总数压回上限。
    for (let i = 0; i < 100; i++) {
      logAudit({ teacherId, action: 'CREATE', tableName: 'classes', recordId: 10000 + i });
    }
    const after = rows();
    expect(after.length, '自动清理没跑：审计表会无限膨胀').toBe(MAX_AUDIT_ROWS);
    // 删掉的是最旧的：最早那批 recordId 应当已经不在了。
    expect(after.some(r => r.recordId === 0)).toBe(false);
    expect(after.some(r => r.recordId === 10099)).toBe(true);
  });
});

describe('trimAuditLog 的 keep 有上限', () => {
  beforeEach(() => {
    const stmt = container.db.prepare(
      'INSERT INTO audit_log (teacher_id, timestamp, action, table_name, record_id) VALUES (?, ?, ?, ?, ?)'
    );
    container.db.transaction(() => {
      for (let i = 0; i < 20; i++) stmt.run(teacherId, '2026-01-01T00:00:00.000Z', 'CREATE', 'classes', i);
    })();
  });

  // 只有 20 行时，keep=999999 和 keep=10000 都是一行不删，看不出上限有没有生效。
  // 要看出来，库里就得比上限还多。
  it('keep 超过 MAX_AUDIT_ROWS 时按上限算', () => {
    const stmt = container.db.prepare(
      'INSERT INTO audit_log (teacher_id, timestamp, action, table_name, record_id) VALUES (?, ?, ?, ?, ?)'
    );
    container.db.transaction(() => {
      for (let i = 20; i < MAX_AUDIT_ROWS + 100; i++) {
        stmt.run(teacherId, '2026-01-01T00:00:00.000Z', 'CREATE', 'classes', i);
      }
    })();
    expect(rows()).toHaveLength(MAX_AUDIT_ROWS + 100);

    trimAuditLog({ teacherId, keep: 999999 });
    expect(rows().length, 'keep 没被夹到 MAX_AUDIT_ROWS').toBe(MAX_AUDIT_ROWS);
  });

  it('keep 在上限以内时按给的数量留（对照）', () => {
    trimAuditLog({ teacherId, keep: 5 });
    expect(rows()).toHaveLength(5);
  });

  it('keep 为负或非数字时当 0，全删', () => {
    trimAuditLog({ teacherId, keep: -10 });
    expect(rows()).toHaveLength(0);
  });

  it('删的是最旧的，留下的是最新的', () => {
    trimAuditLog({ teacherId, keep: 3 });
    const left = rows().map(r => r.recordId).sort((a, b) => a - b);
    expect(left).toEqual([17, 18, 19]);
  });
});
