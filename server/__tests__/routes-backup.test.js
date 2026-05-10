import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return { ...actual, writeFileSync: vi.fn() };
});

let app, drizzleDb, token, teacherId;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/backup', '../routes/backup.js'));
  ({ id: teacherId, token } = await makeUser(drizzleDb));
});

describe('GET /api/backup', () => {
  it('exports empty data', async () => {
    const res = await request(app).get('/api/backup').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.classes).toEqual([]);
    expect(res.body.students).toEqual([]);
    expect(res.body.schedules).toEqual([]);
  });

  it('exports data with classes and schedules', async () => {
    const { classes, schedules } = await import('../db/schema.js');
    const cls = drizzleDb.insert(classes).values({
      teacherId, name: '数学班', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();
    const classId = Number(cls.lastInsertRowid);
    drizzleDb.insert(schedules).values({
      classId, date: '2026-05-01', startTime: '09:00', endTime: '11:00', durationBilling: 120,
    }).run();

    const res = await request(app).get('/api/backup').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.classes).toHaveLength(1);
    expect(res.body.schedules).toHaveLength(1);
    expect(res.body.classes[0].name).toBe('数学班');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/backup');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/backup/restore', () => {
  it('rejects invalid data', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send('not json');
    expect(res.status).toBe(400);
  });

  it('rejects wrong version', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 99, classes: [], students: [], schedules: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('版本');
  });

  it('rejects missing required tables', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('缺少');
  });

  it('restores data atomically', async () => {
    const { classes, schedules } = await import('../db/schema.js');
    const cls = drizzleDb.insert(classes).values({
      teacherId, name: '旧班级', grade: '初三', subject: '数学', studentCount: 2, unitPrice: 600,
    }).run();
    const oldClassId = Number(cls.lastInsertRowid);
    drizzleDb.insert(schedules).values({
      classId: oldClassId, date: '2026-04-01', startTime: '08:00', endTime: '10:00', durationBilling: 120,
    }).run();

    const backup = {
      version: 1,
      classes: [{ id: 10, teacherId, name: '新班级', grade: '高三', subject: '物理', studentCount: 1, unitPrice: 900 }],
      students: [],
      schedules: [{ id: 20, classId: 10, date: '2026-05-01', startTime: '14:00', endTime: '16:00', durationBilling: 120 }],
      classStudents: [],
      holidays: [],
      semesters: [],
      pricingTiers: [],
    };

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(backup);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.restored.classes).toBe(1);
    expect(res.body.restored.schedules).toBe(1);

    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.classes).toHaveLength(1);
    expect(exported.classes[0].name).toBe('新班级');
    expect(exported.schedules).toHaveLength(1);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/backup/restore')
      .send({ version: 1, classes: [], students: [], schedules: [] });
    expect(res.status).toBe(401);
  });

  it('skips schedules with invalid classId references', async () => {
    const backup = {
      version: 1,
      classes: [{ id: 1, teacherId, name: '班', grade: '高三', subject: '数学', studentCount: 1, unitPrice: 100 }],
      students: [],
      schedules: [
        { id: 1, classId: 1, date: '2026-05-01', startTime: '09:00', endTime: '11:00', durationBilling: 120 },
        { id: 2, classId: 999, date: '2026-05-02', startTime: '09:00', endTime: '11:00', durationBilling: 120 },
      ],
      classStudents: [],
      holidays: [],
      semesters: [],
      pricingTiers: [],
    };

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(backup);
    expect(res.status).toBe(200);
    expect(res.body.restored.classes).toBe(1);
    expect(res.body.restored.schedules).toBe(1);

    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.schedules).toHaveLength(1);
    expect(exported.schedules[0].date).toBe('2026-05-01');
  });

  it('exports and restores audit log', async () => {
    const { auditLog } = await import('../db/schema.js');
    drizzleDb.insert(auditLog).values({
      teacherId, action: 'CREATE', tableName: 'classes', recordId: 1,
      timestamp: new Date().toISOString(), afterData: JSON.stringify({ name: 'audited' }),
    }).run();

    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.auditLog).toHaveLength(1);
    expect(exported.auditLog[0].action).toBe('CREATE');

    // Restore with the audit log preserved
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      ...exported,
      classes: [], students: [], schedules: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.restored.auditLog).toBe(1);
  });
});
