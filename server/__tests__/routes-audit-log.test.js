import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/audit-log', '../routes/audit-log.js'));
  ({ token } = await makeUser(drizzleDb));
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

  it('handles NaN limit as default', async () => {
    const res = await request(app).get('/api/audit-log?limit=abc').set(auth(token));
    expect(res.status).toBe(200);
  });

  it('clamps negative limit', async () => {
    const res = await request(app).get('/api/audit-log?limit=-5').set(auth(token));
    expect(res.status).toBe(200);
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
});
