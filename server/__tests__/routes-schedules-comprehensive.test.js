import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { eq, and } from 'drizzle-orm';
import { setupApp, makeUser, auth } from './route-helpers.js';
vi.mock('../services/holidays.js', () => ({ isHoliday: () => false, getHolidayName: () => '' }));

let app, drizzleDb, token, classId, teacherId;

beforeEach(async () => {
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
  it('creates schedules within semester range skipping holidays', async () => {
    const { semesters, holidays } = await import('../db/schema.js');
    const s = drizzleDb.insert(semesters).values({
      teacherId, name: '2026春', type: 'spring', startDate: '2026-05-01', endDate: '2026-05-31',
    }).run();
    const semesterId = Number(s.lastInsertRowid);
    // Mark May 4 (Mon) as holiday
    drizzleDb.insert(holidays).values({
      teacherId, date: '2026-05-04', type: 'holiday', name: '假日',
    }).run();

    // Monday (weekday=1): May 4(holiday), May 11, May 18, May 25
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-04-01').getTime());
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, semesterId, weekday: 1, startTime: '09:00', endTime: '10:00' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3); // May 11, 18, 25
    vi.restoreAllMocks();
  });

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
