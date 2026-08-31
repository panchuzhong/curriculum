import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';
import { clearReportCache, getReportCache, setReportCache } from '../services/report-cache.js';

const fsMocks = vi.hoisted(() => ({
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ mtimeMs: 0 })),
  unlinkSync: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    readdirSync: fsMocks.readdirSync,
    statSync: fsMocks.statSync,
    unlinkSync: fsMocks.unlinkSync,
  };
});

let app, drizzleDb, token, teacherId;

beforeEach(async () => {
  clearReportCache();
  fsMocks.readdirSync.mockClear();
  fsMocks.statSync.mockClear();
  fsMocks.unlinkSync.mockClear();
  fsMocks.readdirSync.mockReturnValue([]);
  fsMocks.statSync.mockImplementation(() => ({ mtimeMs: 0 }));
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

  it('replaces an existing class that has pricing history', async () => {
    const { classes, classPricing } = await import('../db/schema.js');
    const cls = drizzleDb.insert(classes).values({
      teacherId, name: '旧班级', grade: '初三', subject: '数学', studentCount: 2, unitPrice: 600,
    }).run();
    const oldClassId = Number(cls.lastInsertRowid);
    drizzleDb.insert(classPricing).values({
      classId: oldClassId, studentCount: 2, unitPrice: 600, effectiveFrom: '2026-01-01',
    }).run();

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1,
      classes: [{ id: 10, teacherId, name: '新班级', grade: '高三', subject: '物理', studentCount: 1, unitPrice: 900 }],
      students: [], schedules: [], classStudents: [], holidays: [], semesters: [], pricingTiers: [],
      classPricing: [{ id: 20, classId: 10, studentCount: 1, unitPrice: 900, effectiveFrom: '2026-02-01' }],
    });

    expect(res.status).toBe(200);
    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.classes.map(c => c.name)).toEqual(['新班级']);
    expect(exported.classPricing).toHaveLength(1);
    expect(exported.classPricing[0].classId).toBe(exported.classes[0].id);
  });

  it('remaps IDs that collide with another teacher while preserving relationships', async () => {
    const { classes } = await import('../db/schema.js');
    const { id: teacherId2, token: token2 } = await makeUser(drizzleDb, 'collision-owner');
    const other = drizzleDb.insert(classes).values({
      id: 50, teacherId: teacherId2, name: '他人班级', grade: '高一', subject: '数学', studentCount: 1, unitPrice: 100,
    }).run();
    expect(Number(other.lastInsertRowid)).toBe(50);

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1,
      classes: [{ id: 50, teacherId, name: '恢复班级', grade: '高三', subject: '物理', studentCount: 1, unitPrice: 900 }],
      students: [],
      schedules: [{ id: 70, classId: 50, date: '2026-05-01', startTime: '14:00', endTime: '16:00', durationBilling: 120 }],
      classStudents: [], holidays: [], semesters: [], pricingTiers: [], classPricing: [],
    });

    expect(res.status).toBe(200);
    const mine = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(mine.classes[0].id).not.toBe(50);
    expect(mine.schedules[0].classId).toBe(mine.classes[0].id);
    const theirs = (await request(app).get('/api/backup').set(auth(token2))).body;
    expect(theirs.classes).toEqual([expect.objectContaining({ id: 50, name: '他人班级' })]);
  });

  it('rejects duplicate relationship IDs before replacing current data', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1,
      classes: [
        { id: 1, name: 'A', grade: '高一', subject: '数学', studentCount: 1, unitPrice: 100 },
        { id: 1, name: 'B', grade: '高二', subject: '物理', studentCount: 1, unitPrice: 100 },
      ],
      students: [], schedules: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('唯一正整数');
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

  it('restore does not affect other teacher data', async () => {
    const { classes } = await import('../db/schema.js');
    // Teacher A has a class
    drizzleDb.insert(classes).values({
      teacherId, name: 'A的班级', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();

    // Teacher B has a class
    const { id: teacherId2, token: token2 } = await makeUser(drizzleDb, 'teacherB');
    drizzleDb.insert(classes).values({
      teacherId: teacherId2, name: 'B的班级', grade: '高二', subject: '物理', studentCount: 2, unitPrice: 600,
    }).run();

    // Teacher A restores empty backup
    await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1, classes: [], students: [], schedules: [],
      classStudents: [], holidays: [], semesters: [], pricingTiers: [],
    });

    // Teacher B's data should be intact
    const exportB = await request(app).get('/api/backup').set(auth(token2));
    expect(exportB.body.classes).toHaveLength(1);
    expect(exportB.body.classes[0].name).toBe('B的班级');
  });

  it('clears report cache after restore', async () => {
    const cacheKey = { teacherId, start: '2026-05-01', end: '2026-05-31' };
    setReportCache(cacheKey, { count: 99 });
    expect(getReportCache(cacheKey)).toEqual({ count: 99 });

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1,
      classes: [],
      students: [],
      schedules: [],
      classStudents: [],
      holidays: [],
      semesters: [],
      pricingTiers: [],
    });

    expect(res.status).toBe(200);
    expect(getReportCache(cacheKey)).toBeNull();
  });
});

describe('pre-restore snapshot retention', () => {
  it('keeps only the 5 newest snapshots and unlinks the rest', async () => {
    // Seven existing snapshots with descending mtimes: snap-0 newest ... snap-6 oldest
    const names = Array.from({ length: 7 }, (_, i) => `.backup_pre_restore_${i}.json`);
    fsMocks.readdirSync.mockReturnValue(names);
    fsMocks.statSync.mockImplementation((p) => {
      const idx = names.findIndex(n => p.endsWith(n));
      return { mtimeMs: 1000 - idx }; // lower index = newer
    });

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1,
      classes: [],
      students: [],
      schedules: [],
      classStudents: [],
      holidays: [],
      semesters: [],
      pricingTiers: [],
    });
    expect(res.status).toBe(200);

    expect(fsMocks.unlinkSync).toHaveBeenCalledTimes(2);
    const unlinked = fsMocks.unlinkSync.mock.calls.map(c => c[0]);
    expect(unlinked.some(p => p.endsWith(names[5]))).toBe(true);
    expect(unlinked.some(p => p.endsWith(names[6]))).toBe(true);
    expect(unlinked.some(p => p.endsWith(names[0]))).toBe(false);
  });

  it('never unlinks unrelated files in the data directory', async () => {
    fsMocks.readdirSync.mockReturnValue(['data.db', '.backup_pre_restore_a.json']);
    fsMocks.statSync.mockImplementation((p) => ({
      mtimeMs: p.endsWith('.backup_pre_restore_a.json') ? 1 : 2,
    }));

    await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1, classes: [], students: [], schedules: [],
      classStudents: [], holidays: [], semesters: [], pricingTiers: [],
    });

    const unlinked = fsMocks.unlinkSync.mock.calls.map(c => c[0]);
    expect(unlinked.some(p => p.endsWith('data.db'))).toBe(false);
  });
});
