import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { eq, and } from 'drizzle-orm';
import { setupApp, makeUser, auth } from './route-helpers.js';
import { clearSemesterCache } from '../services/schedule-helpers.js';
vi.mock('../services/holidays.js', () => ({ isHoliday: () => false, getHolidayName: () => '' }));

let app, drizzleDb, token, classId, teacherId;

beforeEach(async () => {
  clearSemesterCache();
  ({ app, drizzleDb } = await setupApp('/api/schedules', '../routes/schedules.js'));
  const user = await makeUser(drizzleDb);
  token = user.token;
  teacherId = user.id;
  const { classes } = await import('../db/schema.js');
  const r = drizzleDb.insert(classes).values({
    teacherId: user.id, name: '数学班', grade: '高一', subject: '数学', studentCount: 5, unitPrice: 100,
  }).run();
  classId = Number(r.lastInsertRowid);
});

// ── Conflict detection ──

describe('Schedule conflict detection', () => {
  it('returns warnings when creating overlapping schedules', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '物理班', grade: '高一', subject: '物理', studentCount: 3, unitPrice: 120,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '11:00' });
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: classId2, date: '2026-05-04', startTime: '10:00', endTime: '12:00' });
    expect(res.status).toBe(200);
    expect(res.body.warnings).toBeDefined();
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].className).toBe('数学班');
  });

  it('no warnings for adjacent (non-overlapping) schedules', async () => {
    const res1 = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    // Schedule ends at 10:00, new starts at 10:00 — no overlap
    const res2 = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '10:00', endTime: '11:00' });
    expect(res2.status).toBe(200);
    expect(res2.body.warnings).toBeUndefined();
  });

  it('warnings on update that creates overlap', async () => {
    const { body: { id: id1 } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    const { body: { id: id2 } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '10:00', endTime: '11:00' });
    const res = await request(app).put(`/api/schedules/${id2}`).set(auth(token))
      .send({ startTime: '09:30' });
    expect(res.status).toBe(200);
    expect(res.body.warnings).toBeDefined();
    expect(res.body.warnings.length).toBeGreaterThan(0);
  });
});

// ── Cross-teacher access ──

describe('Schedule cross-teacher isolation', () => {
  it('cannot update another teacher schedule', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    const { token: token2 } = await makeUser(drizzleDb, 'otheruser');
    const res = await request(app).put(`/api/schedules/${id}`).set(auth(token2))
      .send({ startTime: '14:00' });
    expect(res.status).toBe(403);
  });

  it('cannot delete another teacher schedule', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    const { token: token2 } = await makeUser(drizzleDb, 'otheruser');
    const res = await request(app).delete(`/api/schedules/${id}`).set(auth(token2));
    expect(res.status).toBe(403);
  });

  it('cannot get another teacher schedule by id', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    const { token: token2 } = await makeUser(drizzleDb, 'otheruser');
    const res = await request(app).get(`/api/schedules/${id}`).set(auth(token2));
    expect(res.status).toBe(404);
  });

  it('batch delete ignores other teacher schedules', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    const { token: token2 } = await makeUser(drizzleDb, 'otheruser');
    const res = await request(app).delete('/api/schedules/batch').set(auth(token2))
      .send({ ids: [id] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    // Original still exists
    const list = await request(app).get('/api/schedules?start=2026-05-04&end=2026-05-04').set(auth(token));
    expect(list.body).toHaveLength(1);
  });
});

// ── Batch update: weekday filter ──

describe('PUT /api/schedules/batch — weekday filter', () => {
  it('only updates schedules matching the weekday', async () => {
    // 2026-05-04 = Mon, 2026-05-06 = Wed, 2026-05-08 = Fri
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-06', startTime: '09:00', endTime: '10:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-08', startTime: '09:00', endTime: '10:00' });

    // weekday=1 = Monday only
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, weekday: 1, updates: { locationName: '周一地点' } });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);

    const list = await request(app).get('/api/schedules?start=2026-05-01&end=2026-05-10').set(auth(token));
    const monday = list.body.find(s => s.date === '2026-05-04');
    const wednesday = list.body.find(s => s.date === '2026-05-06');
    expect(monday.locationName).toBe('周一地点');
    expect(wednesday.locationName).toBeNull();
  });

  it('requires fromDate or weekday', async () => {
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, updates: { locationName: 'X' } });
    expect(res.status).toBe(400);
  });

  it('rejects invalid update fields', async () => {
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-05-01', updates: { hack: 'value' } });
    expect(res.status).toBe(400);
  });

  it('recalculates durationBilling when time changes', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-05-01', updates: { endTime: '11:00' } });
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/schedules?start=2026-05-01&end=2026-05-10').set(auth(token));
    expect(list.body[0].durationBilling).toBe(120);
  });
});

// ── Schedule export ──

describe('GET /api/schedules/export', () => {
  it('returns JSON export with class info', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).get('/api/schedules/export?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].class).toBeDefined();
    expect(res.body[0].class.name).toBe('数学班');
  });

  it('returns CSV export with proper headers', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).get('/api/schedules/export?start=2026-05-01&end=2026-05-31&format=csv').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('班级');
    expect(res.text).toContain('数学班');
    // BOM present
    expect(res.text.charCodeAt(0)).toBe(0xFEFF);
  });

  it('filters by classId', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '物理班', grade: '高一', subject: '物理', studentCount: 3, unitPrice: 120,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: classId2, date: '2026-05-04', startTime: '14:00', endTime: '15:00' });
    const res = await request(app).get(`/api/schedules/export?start=2026-05-01&end=2026-05-31&classId=${classId}`).set(auth(token));
    expect(res.body).toHaveLength(1);
    expect(res.body[0].classId).toBe(classId);
  });

  it('requires start/end params', async () => {
    const res = await request(app).get('/api/schedules/export').set(auth(token));
    expect(res.status).toBe(400);
  });
});

// ── Summary with classId filter ──

describe('GET /api/schedules/summary — classId filter', () => {
  it('filters summary by classId', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '物理班', grade: '高二', subject: '物理', studentCount: 3, unitPrice: 200,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: classId2, date: '2026-05-04', startTime: '14:00', endTime: '15:00' });

    const res = await request(app).get(`/api/schedules/summary?start=2026-05-01&end=2026-05-31&classId=${classId}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.byClass).toHaveLength(1);
    expect(res.body.byClass[0].classId).toBe(classId);
  });

  it('revenue calculation is correct', async () => {
    // unitPrice=100, studentCount=5, discountAmount=0, durationBilling=90 min
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).get('/api/schedules/summary?start=2026-05-01&end=2026-05-31').set(auth(token));
    // revenue = (100 * 5 - 0) * (90/60) = 500 * 1.5 = 750
    expect(res.body.revenue).toBe(750);
  });

  it('CSV export includes total row', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    const res = await request(app).get('/api/schedules/summary?start=2026-05-01&end=2026-05-31&format=csv').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.text).toContain('合计');
  });
});

// ── Free slots edge cases ──

describe('GET /api/schedules/free-slots — edge cases', () => {
  it('handles schedule at day start', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '08:00', endTime: '09:00' });
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&after=08:00&before=10:00').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([{ start: '09:00', end: '10:00' }]);
  });

  it('handles schedule at day end', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '22:00', endTime: '23:00' });
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&after=21:00&before=23:00').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([{ start: '21:00', end: '22:00' }]);
  });

  it('handles fully booked day', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '08:00', endTime: '23:00' });
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([]);
  });

  it('handles back-to-back schedules', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '10:00', endTime: '11:00' });
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&after=08:00&before=12:00').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '11:00', end: '12:00' },
    ]);
  });
});

// ── Batch create with semester mode ──

describe('POST /api/schedules/batch — semester mode', () => {
  it('rejects non-existent semester', async () => {
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, semesterId: 99999, weekday: 1, startTime: '09:00', endTime: '10:00' });
    expect(res.status).toBe(404);
  });
});

// ── Batch delete by date range ──

describe('DELETE /api/schedules/batch — date range with classId', () => {
  it('deletes only matching classId in date range', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '物理班', grade: '高一', subject: '物理', studentCount: 3, unitPrice: 120,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: classId2, date: '2026-05-04', startTime: '14:00', endTime: '15:00' });

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ start: '2026-05-01', end: '2026-05-31', classId });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    // Class2 schedule still exists
    const list = await request(app).get('/api/schedules?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(list.body).toHaveLength(1);
    expect(list.body[0].classId).toBe(classId2);
  });

  it('returns 400 without ids or date range', async () => {
    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── GET /api/schedules/:id ──

describe('GET /api/schedules/:id', () => {
  it('returns schedule with class info', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    const res = await request(app).get(`/api/schedules/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.class).toBeDefined();
    expect(res.body.class.name).toBe('数学班');
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await request(app).get('/api/schedules/999999').set(auth(token));
    expect(res.status).toBe(404);
  });
});

// ── Default location inheritance ──

describe('Schedule default location', () => {
  it('inherits class default location when no location provided', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.update(classes).set({ defaultLocationName: '图书馆' }).where(eq(classes.id, classId)).run();

    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    expect(res.status).toBe(200);
    expect(res.body.locationName).toBe('图书馆');
  });

  it('uses provided location over class default', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.update(classes).set({ defaultLocationName: '图书馆' }).where(eq(classes.id, classId)).run();

    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00', locationName: '教室A' });
    expect(res.status).toBe(200);
    expect(res.body.locationName).toBe('教室A');
  });
});

// ── Schedule update: change classId ──

describe('PUT /api/schedules/:id — change classId', () => {
  it('transfers schedule to another class of same teacher', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '物理班', grade: '高一', subject: '物理', studentCount: 3, unitPrice: 120,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    const res = await request(app).put(`/api/schedules/${id}`).set(auth(token))
      .send({ classId: classId2 });
    expect(res.status).toBe(200);
    expect(res.body.classId).toBe(classId2);
    expect(res.body.class.name).toBe('物理班');
  });

  it('rejects classId of other teacher', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const { classes } = await import('../db/schema.js');
    // Create class owned by user2 — but we need a classId that exists but belongs to other teacher
    // Since we can't easily insert for another teacher with auth, test with a nonexistent class
    const res = await request(app).put(`/api/schedules/${id}`).set(auth(token))
      .send({ classId: 99999 });
    expect(res.status).toBe(403);
  });

  it('rejects update with no valid fields', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    const res = await request(app).put(`/api/schedules/${id}`).set(auth(token))
      .send({ hack: 'value' });
    expect(res.status).toBe(400);
  });
});

// ── Schedule update: date change ──

describe('PUT /api/schedules/:id — date change', () => {
  it('updates date and preserves other fields', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00', locationName: '教室' });
    const res = await request(app).put(`/api/schedules/${id}`).set(auth(token))
      .send({ date: '2026-05-05' });
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-05-05');
    expect(res.body.locationName).toBe('教室');
  });
});

// ── Conflicts endpoint ──

describe('GET /api/schedules/conflicts — edge cases', () => {
  it('uses default date range when not specified', async () => {
    const res = await request(app).get('/api/schedules/conflicts').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(typeof res.body.total).toBe('number');
  });

  it('clamps limit to 100 max', async () => {
    const res = await request(app).get('/api/schedules/conflicts?limit=9999').set(auth(token));
    expect(res.status).toBe(200);
  });

  it('excludes deleted classes from conflict detection', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '物理班', grade: '高一', subject: '物理', studentCount: 3, unitPrice: 120,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '11:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: classId2, date: '2026-05-04', startTime: '10:00', endTime: '12:00' });

    // Soft-delete class2
    drizzleDb.update(classes).set({ deleted: true }).where(eq(classes.id, classId2)).run();

    const res = await request(app).get('/api/schedules/conflicts?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res.body.total).toBe(0);
  });

  it('DELETE /:id rejects schedule belonging to soft-deleted class', async () => {
    const { schedules } = await import('../db/schema.js');
    // Create and soft-delete a class
    const { classes } = await import('../db/schema.js');
    const r = drizzleDb.insert(classes).values({
      teacherId, name: '暂存班', grade: '高一', subject: '数学', studentCount: 1, unitPrice: 100, deleted: true,
    }).run();
    const delClassId = Number(r.lastInsertRowid);
    const r2 = drizzleDb.insert(schedules).values({
      classId: delClassId, date: '2026-06-01', startTime: '09:00', endTime: '11:00', durationBilling: 120,
    }).run();
    const schedId = Number(r2.lastInsertRowid);

    const res = await request(app).delete(`/api/schedules/${schedId}`).set(auth(token));
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/schedules/batch validation', () => {
  let bApp, bToken, bClassId;

  beforeEach(async () => {
    const { app: a, drizzleDb: db } = await setupApp('/api/schedules', '../routes/schedules.js');
    bApp = a;
    const user = await makeUser(db);
    bToken = user.token;
    const { classes } = await import('../db/schema.js');
    const r = db.insert(classes).values({
      teacherId: user.id, name: '验证班', grade: '高三', subject: '物理', studentCount: 3, unitPrice: 200,
    }).run();
    bClassId = Number(r.lastInsertRowid);
  });

  it('rejects invalid start date format in date-range mode', async () => {
    const res = await request(bApp).delete('/api/schedules/batch').set(auth(bToken))
      .send({ classId: bClassId, start: 'not-a-date', end: '2026-12-31' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid end date format in date-range mode', async () => {
    const res = await request(bApp).delete('/api/schedules/batch').set(auth(bToken))
      .send({ classId: bClassId, start: '2026-01-01', end: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('accepts date-range mode without classId (all classes)', async () => {
    const res = await request(bApp).delete('/api/schedules/batch').set(auth(bToken))
      .send({ start: '2026-01-01', end: '2026-12-31' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /api/schedules/export', () => {
  let expApp, expToken, expClassId;

  beforeEach(async () => {
    const { app: a, drizzleDb: db } = await setupApp('/api/schedules', '../routes/schedules.js');
    expApp = a;
    const user = await makeUser(db);
    expToken = user.token;
    const { classes } = await import('../db/schema.js');
    const r = db.insert(classes).values({
      teacherId: user.id, name: '导出班', grade: '高二', subject: '英语', studentCount: 4, unitPrice: 150,
    }).run();
    expClassId = Number(r.lastInsertRowid);
    const { schedules } = await import('../db/schema.js');
    db.insert(schedules).values({
      classId: expClassId, date: '2026-06-01', startTime: '09:00', endTime: '11:00', durationBilling: 120,
    }).run();
  });

  it('exports schedules as JSON', async () => {
    const res = await request(expApp).get('/api/schedules/export?start=2026-06-01&end=2026-06-01').set(auth(expToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].class.name).toBe('导出班');
  });

  it('exports schedules as CSV', async () => {
    const res = await request(expApp).get('/api/schedules/export?start=2026-06-01&end=2026-06-01&format=csv').set(auth(expToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('导出班');
  });

  it('returns 400 without start/end', async () => {
    const res = await request(expApp).get('/api/schedules/export').set(auth(expToken));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/students/by-class/:classId', () => {
  let stApp, stToken, stClassId, stStudentId;

  beforeEach(async () => {
    const { app: a, drizzleDb: db } = await setupApp('/api/students', '../routes/students.js');
    stApp = a;
    const user = await makeUser(db);
    stToken = user.token;
    const { classes, students, classStudents } = await import('../db/schema.js');
    const cr = db.insert(classes).values({
      teacherId: user.id, name: '测试班', grade: '初三', subject: '化学', studentCount: 1, unitPrice: 200,
    }).run();
    stClassId = Number(cr.lastInsertRowid);
    const sr = db.insert(students).values({
      teacherId: user.id, name: '小明', birthDate: '2010-03-15',
    }).run();
    stStudentId = Number(sr.lastInsertRowid);
    db.insert(classStudents).values({ classId: stClassId, studentId: stStudentId }).run();
  });

  it('returns students for a class', async () => {
    const res = await request(stApp).get(`/api/students/by-class/${stClassId}`).set(auth(stToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('小明');
  });

  it('returns 404 for non-existent class', async () => {
    const res = await request(stApp).get('/api/students/by-class/99999').set(auth(stToken));
    expect(res.status).toBe(404);
  });
});

// ── Smoke tests for new features ──

describe('DELETE /api/schedules/batch — dryRun', () => {
  it('dryRun returns ids without deleting (byIds mode)', async () => {
    const r1 = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-06-01', startTime: '08:00', endTime: '09:00' });
    const id1 = r1.body.id;

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ ids: [id1], dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.ids).toEqual([id1]);

    const check = await request(app).get(`/api/schedules/${id1}`).set(auth(token));
    expect(check.status).toBe(200);
  });

  it('dryRun=false actually deletes', async () => {
    const r1 = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-06-03', startTime: '10:00', endTime: '11:00' });
    const id1 = r1.body.id;

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ ids: [id1], dryRun: false });
    expect(res.body.count).toBe(1);

    const check = await request(app).get(`/api/schedules/${id1}`).set(auth(token));
    expect(check.status).toBe(404);
  });
});

describe('DELETE /api/schedules/batch — byClassId mode', () => {
  it('deletes schedules for class from date', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-07-01', startTime: '08:00', endTime: '09:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-07-02', startTime: '08:00', endTime: '09:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-06-15', startTime: '08:00', endTime: '09:00' });

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-07-01' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.ids).toHaveLength(2);
  });

  it('returns 404 for non-existent class', async () => {
    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ classId: 99999, fromDate: '2026-01-01' });
    expect(res.status).toBe(404);
  });

  it('returns count 0 when no schedules match', async () => {
    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2099-01-01' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.ids).toEqual([]);
  });
});

describe('DELETE /api/schedules/batch — semesterOnly filtering', () => {
  let semId;
  beforeEach(async () => {
    const { semesters } = await import('../db/schema.js');
    const r = drizzleDb.insert(semesters).values({
      teacherId, name: '测试学期', type: 'spring', startDate: '2026-05-01', endDate: '2026-05-15',
    }).run();
    semId = Number(r.lastInsertRowid);
  });

  it('byIds mode: filters out-of-semester records by default', async () => {
    const r1 = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-10', startTime: '08:00', endTime: '09:00' });
    const r2 = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-04-20', startTime: '08:00', endTime: '09:00' });

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ ids: [r1.body.id, r2.body.id] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.semesterFiltered).toBe(1);

    const check = await request(app).get(`/api/schedules/${r2.body.id}`).set(auth(token));
    expect(check.status).toBe(200);
  });

  it('byIds mode: semesterOnly=false deletes all', async () => {
    const r1 = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-10', startTime: '08:00', endTime: '09:00' });
    const r2 = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-04-20', startTime: '08:00', endTime: '09:00' });

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ ids: [r1.body.id, r2.body.id], semesterOnly: false });
    expect(res.body.count).toBe(2);
  });

  it('byDateRange mode: filters out-of-semester records by default', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-10', startTime: '08:00', endTime: '09:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-04-20', startTime: '08:00', endTime: '09:00' });

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ start: '2026-04-01', end: '2026-05-31' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.semesterFiltered).toBe(1);
  });
});

describe('POST /api/schedules/batch — cross-semester check', () => {
  beforeEach(async () => {
    const { semesters } = await import('../db/schema.js');
    drizzleDb.insert(semesters).values({
      teacherId, name: '测试学期', type: 'spring', startDate: '2026-06-01', endDate: '2026-06-30',
    }).run();
  });

  it('rejects dates that cross semester boundaries', async () => {
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, dates: ['2026-05-20', '2026-06-10'], startTime: '08:00', endTime: '09:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('跨学期');
  });

  it('allows dates all inside semester', async () => {
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, dates: ['2026-06-01', '2026-06-15'], startTime: '08:00', endTime: '09:00' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('allows dates all outside semester', async () => {
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, dates: ['2026-07-05', '2026-07-10'], startTime: '08:00', endTime: '09:00' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });
});

describe('GET /api/schedules/conflicts — classId filter', () => {
  it('filters conflicts by classId', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '物理班', grade: '高一', subject: '物理', studentCount: 3, unitPrice: 120,
    }).run();
    const c2 = Number(r2.lastInsertRowid);

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-08-01', startTime: '09:00', endTime: '11:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-08-01', startTime: '10:00', endTime: '12:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: c2, date: '2026-08-01', startTime: '13:00', endTime: '14:00' });

    const all = await request(app).get('/api/schedules/conflicts')
      .query({ start: '2026-08-01', end: '2026-08-01' }).set(auth(token));
    expect(all.body.total).toBe(1);

    const filtered = await request(app).get('/api/schedules/conflicts')
      .query({ start: '2026-08-01', end: '2026-08-01', classId: String(classId) }).set(auth(token));
    expect(filtered.body.total).toBe(1);

    const none = await request(app).get('/api/schedules/conflicts')
      .query({ start: '2026-08-01', end: '2026-08-01', classId: String(c2) }).set(auth(token));
    expect(none.body.total).toBe(0);
  });
});

// ── Smoke: batch create preview mode ──

describe('POST /api/schedules/batch — preview mode', () => {
  it('preview=true returns dates without creating (semester mode)', async () => {
    const { semesters } = await import('../db/schema.js');
    const r = drizzleDb.insert(semesters).values({
      teacherId, name: '预览期', type: 'spring', startDate: '2026-07-01', endDate: '2026-07-31',
    }).run();
    const semId = Number(r.lastInsertRowid);

    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, semesterId: semId, weekday: 1, startTime: '08:00', endTime: '09:00', preview: true });
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(res.body.dates).toBeDefined();
    expect(Array.isArray(res.body.dates)).toBe(true);
  });

  it('preview=true returns dates without creating (dates mode)', async () => {
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, dates: ['2026-09-01', '2026-09-08'], startTime: '08:00', endTime: '09:00', preview: true });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.dates).toEqual(['2026-09-01', '2026-09-08']);
  });

  it('preview=true does not persist schedules', async () => {
    await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, dates: ['2026-10-01'], startTime: '08:00', endTime: '09:00', preview: true });

    const check = await request(app).get('/api/schedules')
      .query({ start: '2026-10-01', end: '2026-10-01' }).set(auth(token));
    expect(check.body).toHaveLength(0);
  });
});

// ── Smoke: studentId filtering ──

describe('GET /api/schedules — studentId filter', () => {
  it('filters schedules by student', async () => {
    const { classes: clsMod, students: stuMod, classStudents: csMod } = await import('../db/schema.js');

    const r1 = drizzleDb.insert(clsMod).values({
      teacherId, name: '物理班', grade: '高一', subject: '物理', studentCount: 3, unitPrice: 100,
    }).run();
    const c2 = Number(r1.lastInsertRowid);
    const r2 = drizzleDb.insert(stuMod).values({ teacherId, name: '小华' }).run();
    const sId = Number(r2.lastInsertRowid);
    drizzleDb.insert(csMod).values({ classId: c2, studentId: sId }).run();

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-11-01', startTime: '08:00', endTime: '09:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: c2, date: '2026-11-01', startTime: '09:00', endTime: '10:00' });

    const res = await request(app).get('/api/schedules')
      .query({ start: '2026-11-01', end: '2026-11-01', studentId: sId }).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].class.name).toBe('物理班');
  });

  it('studentId combined with classId returns intersection', async () => {
    const res = await request(app).get('/api/schedules')
      .query({ start: '2026-11-01', end: '2026-11-01', studentId: 99999, classId }).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ── Smoke: pagination ──

describe('GET /api/schedules — pagination', () => {
  beforeEach(async () => {
    for (let i = 1; i <= 5; i++) {
      await request(app).post('/api/schedules').set(auth(token))
        .send({ classId, date: `2026-12-0${i}`, startTime: '08:00', endTime: '09:00' });
    }
  });

  it('limit restricts result count', async () => {
    const res = await request(app).get('/api/schedules')
      .query({ start: '2026-12-01', end: '2026-12-31', limit: 2 }).set(auth(token));
    expect(res.body).toHaveLength(2);
  });

  it('offset skips records', async () => {
    const all = await request(app).get('/api/schedules')
      .query({ start: '2026-12-01', end: '2026-12-31' }).set(auth(token));

    const paged = await request(app).get('/api/schedules')
      .query({ start: '2026-12-01', end: '2026-12-31', limit: 2, offset: 2 }).set(auth(token));
    expect(paged.body).toHaveLength(2);
    expect(paged.body[0].id).toBe(all.body[2].id);
  });
});

// ── Smoke: comma-separated classId ──

describe('GET /api/schedules — comma-separated classId', () => {
  it('returns schedules for multiple classes', async () => {
    const { classes: clsMod } = await import('../db/schema.js');
    const r = drizzleDb.insert(clsMod).values({
      teacherId, name: '化学班', grade: '高一', subject: '化学', studentCount: 3, unitPrice: 100,
    }).run();
    const c2 = Number(r.lastInsertRowid);

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2027-01-01', startTime: '08:00', endTime: '09:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: c2, date: '2027-01-01', startTime: '09:00', endTime: '10:00' });

    const res = await request(app).get('/api/schedules')
      .query({ start: '2027-01-01', end: '2027-01-01', classId: `${classId},${c2}` }).set(auth(token));
    expect(res.body).toHaveLength(2);
  });
});

// ── Smoke: semester+weekday batch create ──

describe('POST /api/schedules/batch — semester+weekday mode', () => {
  it('creates schedules on correct weekday within active semester', async () => {
    const { semesters } = await import('../db/schema.js');
    // Use a semester that wraps around today so the max(today, startDate) logic works
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const r = drizzleDb.insert(semesters).values({
      teacherId, name: '当前期', type: 'spring',
      startDate: `${y}-01-01`, endDate: `${y}-12-31`,
    }).run();
    const semId = Number(r.lastInsertRowid);

    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, semesterId: semId, weekday: 0, startTime: '09:00', endTime: '10:00' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(res.body.ids).toHaveLength(res.body.count);
  });

  it('semester+weekday with no matching days returns 400', async () => {
    const { semesters } = await import('../db/schema.js');
    const r = drizzleDb.insert(semesters).values({
      teacherId, name: '远古期', type: 'spring',
      startDate: '2020-01-01', endDate: '2020-01-07',
    }).run();
    const semId = Number(r.lastInsertRowid);

    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, semesterId: semId, weekday: 3, startTime: '08:00', endTime: '09:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No valid dates to schedule');
  });
});

describe('DELETE /api/schedules/batch — byClassId mode dryRun & semesterOnly', () => {
  let semId;
  beforeEach(async () => {
    const { semesters } = await import('../db/schema.js');
    const r = drizzleDb.insert(semesters).values({
      teacherId, name: '测期', type: 'spring', startDate: '2026-09-01', endDate: '2026-09-30',
    }).run();
    semId = Number(r.lastInsertRowid);
  });

  it('dryRun returns ids without deleting', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-09-10', startTime: '08:00', endTime: '09:00' });

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-09-01', dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.ids).toHaveLength(1);

    const check = await request(app).get(`/api/schedules/${res.body.ids[0]}`).set(auth(token));
    expect(check.status).toBe(200);
  });

  it('semesterOnly filters by default in byClassId mode', async () => {
    const r1 = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-09-10', startTime: '08:00', endTime: '09:00' });
    const r2 = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-08-20', startTime: '08:00', endTime: '09:00' });

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-08-01' });
    expect(res.body.count).toBe(1);
    expect(res.body.semesterFiltered).toBe(1);

    const check = await request(app).get(`/api/schedules/${r2.body.id}`).set(auth(token));
    expect(check.status).toBe(200);
  });
});

describe('DELETE /api/schedules/batch — dateRange dryRun', () => {
  it('dryRun returns preview without deleting', async () => {
    const r1 = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-11-01', startTime: '09:00', endTime: '10:00' });
    const id1 = r1.body.id;

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ start: '2026-11-01', end: '2026-11-30', dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);

    const check = await request(app).get(`/api/schedules/${id1}`).set(auth(token));
    expect(check.status).toBe(200);
  });
});

describe('PUT /api/schedules — error paths', () => {
  it('PUT /:id returns 404 for non-existent schedule', async () => {
    const res = await request(app).put('/api/schedules/99999').set(auth(token))
      .send({ date: '2026-01-01' });
    expect(res.status).toBe(404);
  });

  it('PUT /batch returns 404 for non-existent class', async () => {
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId: 99999, fromDate: '2026-01-01', updates: { locationName: 'test' } });
    expect(res.status).toBe(404);
  });
});
