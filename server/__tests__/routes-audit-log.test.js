import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

let app, drizzleDb, token, teacherId;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/audit-log', '../routes/audit-log.js'));
  ({ id: teacherId, token } = await makeUser(drizzleDb));
});

describe('GET /api/audit-log', () => {
  it('returns empty array when no logs', async () => {
    const res = await request(app).get('/api/audit-log').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns logs with table filter', async () => {
    const { auditLog } = await import('../db/schema.js');
    drizzleDb.insert(auditLog).values({
      teacherId: 1, action: 'CREATE', tableName: 'classes', recordId: 1, timestamp: new Date().toISOString(),
      afterData: JSON.stringify({ name: 'test' }),
    }).run();
    drizzleDb.insert(auditLog).values({
      teacherId: 1, action: 'DELETE', tableName: 'schedules', recordId: 2, timestamp: new Date().toISOString(),
    }).run();

    const res = await request(app).get('/api/audit-log?table=classes').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].tableName).toBe('classes');
    expect(res.body[0].afterData).toEqual({ name: 'test' });
  });

  it('returns logs with action filter', async () => {
    const { auditLog } = await import('../db/schema.js');
    drizzleDb.insert(auditLog).values({
      teacherId: 1, action: 'CREATE', tableName: 'classes', recordId: 1, timestamp: new Date().toISOString(),
    }).run();
    drizzleDb.insert(auditLog).values({
      teacherId: 1, action: 'DELETE', tableName: 'schedules', recordId: 2, timestamp: new Date().toISOString(),
    }).run();

    const res = await request(app).get('/api/audit-log?action=DELETE').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].action).toBe('DELETE');
  });

  it('respects limit parameter', async () => {
    const { auditLog } = await import('../db/schema.js');
    for (let i = 0; i < 5; i++) {
      drizzleDb.insert(auditLog).values({
        teacherId: 1, action: 'CREATE', tableName: 'classes', recordId: i, timestamp: new Date().toISOString(),
      }).run();
    }

    const res = await request(app).get('/api/audit-log?limit=2').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/audit-log');
    expect(res.status).toBe(401);
  });

  it('rejects invalid table value', async () => {
    const res = await request(app).get('/api/audit-log?table=invalid_table').set(auth(token));
    expect(res.status).toBe(400);
  });

  it('rejects invalid action value', async () => {
    const res = await request(app).get('/api/audit-log?action=HACK').set(auth(token));
    expect(res.status).toBe(400);
  });

  it('filters with both table and action', async () => {
    const { auditLog } = await import('../db/schema.js');
    drizzleDb.insert(auditLog).values({
      teacherId: 1, action: 'CREATE', tableName: 'classes', recordId: 1, timestamp: new Date().toISOString(),
    }).run();
    drizzleDb.insert(auditLog).values({
      teacherId: 1, action: 'DELETE', tableName: 'classes', recordId: 2, timestamp: new Date().toISOString(),
    }).run();
    drizzleDb.insert(auditLog).values({
      teacherId: 1, action: 'CREATE', tableName: 'schedules', recordId: 3, timestamp: new Date().toISOString(),
    }).run();
    const res = await request(app).get('/api/audit-log?table=classes&action=CREATE').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].tableName).toBe('classes');
    expect(res.body[0].action).toBe('CREATE');
  });

  // 这两条原来只断言 status 200，而名字说的是"按默认值处理"和"负数被夹"——
  // 200 跟夹没夹没关系。夹取是真的承重：cap 直接传给 SQL 的 LIMIT，
  // 而 SQLite 的 LIMIT -1 表示不限，于是 ?limit=-1 就能把整本审计日志一次端走。
  async function seedLogs(n) {
    const { auditLog } = await import('../db/schema.js');
    for (let i = 0; i < n; i++) {
      drizzleDb.insert(auditLog).values({
        teacherId, action: 'CREATE', tableName: 'classes', recordId: i,
        timestamp: new Date().toISOString(),
      }).run();
    }
  }

  // 要看出"回落到默认的 100"，库里就得多于 100 条，否则"全返回"和"返回 100 条"
  // 长得一样——把 || 换成 ??（NaN ?? 100 还是 NaN，等于不限）也察觉不到。
  it('handles NaN limit as default', async () => {
    await seedLogs(105);
    const res = await request(app).get('/api/audit-log?limit=abc').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(100);
  });

  it('clamps negative limit', async () => {
    await seedLogs(3);
    const res = await request(app).get('/api/audit-log?limit=-5').set(auth(token));
    expect(res.status).toBe(200);
    // 夹到 1；没有下界的话 LIMIT -5 会把三条全返回
    expect(res.body).toHaveLength(1);
  });

  it('isolates logs between teachers', async () => {
    const { auditLog } = await import('../db/schema.js');
    const { id: teacherId1 } = await makeUser(drizzleDb, 'teacherA');
    drizzleDb.insert(auditLog).values({
      teacherId: teacherId1, action: 'CREATE', tableName: 'classes', recordId: 1, timestamp: new Date().toISOString(),
    }).run();

    const { token: tokenB } = await makeUser(drizzleDb, 'teacherB');
    const res = await request(app).get('/api/audit-log').set(auth(tokenB));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('cleanup keeps newest logs for the current teacher only', async () => {
    const { auditLog } = await import('../db/schema.js');
    const { id: teacherId1, token: tokenA } = await makeUser(drizzleDb, 'teacherA');
    const { id: teacherId2, token: tokenB } = await makeUser(drizzleDb, 'teacherB');

    for (let i = 0; i < 5; i++) {
      drizzleDb.insert(auditLog).values({
        teacherId: teacherId1, action: 'CREATE', tableName: 'classes', recordId: i, timestamp: new Date().toISOString(),
      }).run();
    }
    for (let i = 0; i < 2; i++) {
      drizzleDb.insert(auditLog).values({
        teacherId: teacherId2, action: 'CREATE', tableName: 'classes', recordId: i, timestamp: new Date().toISOString(),
      }).run();
    }

    const cleanup = await request(app).delete('/api/audit-log/cleanup?keep=2').set(auth(tokenB));
    expect(cleanup.status).toBe(200);
    expect(cleanup.body.deleted).toBe(0);
    expect(cleanup.body.remaining).toBe(2);

    const cleanupA = await request(app).delete('/api/audit-log/cleanup?keep=2').set(auth(tokenA));
    expect(cleanupA.status).toBe(200);
    expect(cleanupA.body.deleted).toBe(3);
    expect(cleanupA.body.remaining).toBe(2);

    // 用例名说「保留最新的」，就得真去看留下的是哪两条。只比数字的话，把
    // ORDER BY id ASC 换成 DESC（删最新、留最旧）返回的 deleted/remaining 一模一样。
    // 而 trimAuditLog 每插 100 条就自动跑一次：方向反了，审计日志会永远停在
    // 最早写下的那一批，界面上看却完全正常。
    const left = await request(app).get('/api/audit-log').set(auth(tokenA));
    expect(left.body.map(r => r.recordId).sort((a, b) => a - b)).toEqual([3, 4]);
  });

  it.each([['-1'], ['abc'], ['']])('cleanup 拒绝 keep=%j 并说明要求', async (keep) => {
    const res = await request(app).delete(`/api/audit-log/cleanup?keep=${keep}`).set(auth(token));
    expect(res.status).toBe(400);
    // 光看 400 分不出是被这条守卫拦的还是别的地方出错；而 keep 直接决定删多少条，
    // 报错必须说清要求，调用方才改得动。
    expect(res.body.error).toBe('keep 须为非负整数');
  });

  // 对照：keep=0 是合法的（全清），不能被上面的判据误伤。
  it('cleanup 接受 keep=0 并清空', async () => {
    await seedLogs(3);
    const res = await request(app).delete('/api/audit-log/cleanup?keep=0').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.remaining).toBe(0);

    const left = await request(app).get('/api/audit-log').set(auth(token));
    expect(left.body).toHaveLength(0);
  });
});

// 列表必须是最新在前。写成正序的话 ?limit=100 返回的是最旧的 100 条，
// 审计页从此看不到刚发生的改动——而这正是打开这个页面的唯一理由。
// 原有那条名字里带"newest"的用例先 .sort() 再比较，把要验的顺序本身抹掉了。
describe('GET /api/audit-log 的顺序', () => {
  async function seed(n) {
    const { auditLog } = await import('../db/schema.js');
    for (let i = 0; i < n; i++) {
      drizzleDb.insert(auditLog).values({
        teacherId, timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        action: 'CREATE', tableName: 'classes', recordId: i,
      }).run();
    }
  }

  it('最新的排在最前面', async () => {
    await seed(5);
    const res = await request(app).get('/api/audit-log').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.map(r => r.recordId)).toEqual([4, 3, 2, 1, 0]);
  });

  // limit 截断的必须是"最新的 N 条"，而不是"最旧的 N 条"。
  it('limit 截取的是最新的那几条', async () => {
    await seed(10);
    const res = await request(app).get('/api/audit-log').query({ limit: 3 }).set(auth(token));
    expect(res.body.map(r => r.recordId)).toEqual([9, 8, 7]);
  });

  it('limit 有 500 的上限', async () => {
    await seed(3);
    const res = await request(app).get('/api/audit-log').query({ limit: 100000 }).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });
});
