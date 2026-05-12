import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
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

describe('POST /api/schedules', () => {
  it('creates a schedule', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('rejects invalid date format', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: 'not-a-date', startTime: '09:00', endTime: '10:30' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid time format', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '9:00', endTime: '10:30' });
    expect(res.status).toBe(400);
  });

  it('rejects missing classId', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    expect(res.status).toBe(400);
  });

  it('rejects class of other teacher', async () => {
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).post('/api/schedules').set(auth(token2))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/schedules', () => {
  it('lists schedules in range', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).get('/api/schedules?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters by classId', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).get('/api/schedules?start=2026-05-01&end=2026-05-31&classId=99999').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('requires start/end params', async () => {
    const res = await request(app).get('/api/schedules').set(auth(token));
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/schedules/:id', () => {
  it('updates a schedule', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).put(`/api/schedules/${id}`).set(auth(token))
      .send({ startTime: '10:00' });
    expect(res.status).toBe(200);
  });

  it('does not recalculate durationBilling when only locationName changes', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '11:00' });
    // durationBilling should be 120 (2 hours)
    const before = await request(app).get('/api/schedules?start=2026-05-04&end=2026-05-04').set(auth(token));
    expect(before.body[0].durationBilling).toBe(120);

    const res = await request(app).put(`/api/schedules/${id}`).set(auth(token))
      .send({ locationName: '新地点' });
    expect(res.status).toBe(200);

    const after = await request(app).get('/api/schedules?start=2026-05-04&end=2026-05-04').set(auth(token));
    expect(after.body[0].durationBilling).toBe(120);
    expect(after.body[0].locationName).toBe('新地点');
  });

  it('recalculates durationBilling when startTime changes', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '11:00' });

    await request(app).put(`/api/schedules/${id}`).set(auth(token))
      .send({ startTime: '10:00' });

    const res = await request(app).get('/api/schedules?start=2026-05-04&end=2026-05-04').set(auth(token));
    expect(res.body[0].durationBilling).toBe(60);
  });
});

describe('DELETE /api/schedules/:id', () => {
  it('deletes a schedule', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).delete(`/api/schedules/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    // Verify actual deletion
    const check = await request(app).get(`/api/schedules/${id}`).set(auth(token));
    expect(check.status).toBe(404);
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await request(app).delete('/api/schedules/999999').set(auth(token));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/schedules/batch', () => {
  it('creates batch by dates array', async () => {
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, startTime: '09:00', endTime: '10:30', dates: ['2026-05-04', '2026-05-11'] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('rejects missing classId', async () => {
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ startTime: '09:00', endTime: '10:30', dates: ['2026-05-04'] });
    expect(res.status).toBe(400);
  });

  it('rejects empty dates array', async () => {
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, startTime: '09:00', endTime: '10:30', dates: [] });
    expect(res.status).toBe(400);
  });

  it('rejects dates array > 365', async () => {
    const dates = Array.from({ length: 366 }, (_, i) => {
      const d = new Date('2026-01-01');
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, startTime: '09:00', endTime: '10:30', dates });
    expect(res.status).toBe(400);
  });

  it('rejects when neither dates nor semesterId+weekday provided', async () => {
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, startTime: '09:00', endTime: '10:30' });
    expect(res.status).toBe(400);
  });

  it('rejects semester mode with no valid dates in range', async () => {
    const { semesters } = await import('../db/schema.js');
    drizzleDb.insert(semesters).values({
      teacherId, name: '过去学期', type: 'spring', startDate: '2020-01-01', endDate: '2020-06-30',
    }).run();
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, semesterId: Number(drizzleDb.select().from(semesters).all()[0].id), weekday: 1, startTime: '09:00', endTime: '10:30' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/schedules/batch — semester filtering', () => {
  async function seed(dates) {
    for (const d of dates) {
      await request(app).post('/api/schedules').set(auth(token))
        .send({ classId, date: d, startTime: '09:00', endTime: '10:00' });
    }
  }
  async function addSemester(start, end) {
    const { semesters } = await import('../db/schema.js');
    drizzleDb.insert(semesters).values({
      teacherId, name: '春季', type: 'spring', startDate: start, endDate: end,
    }).run();
  }

  it('case 1: all candidates inside a semester → modifies all, no hint', async () => {
    await addSemester('2026-02-23', '2026-07-15');
    await seed(['2026-05-04', '2026-05-11', '2026-05-18']);
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-05-01', updates: { startTime: '14:00', endTime: '15:00' } });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.semesterFiltered).toBeUndefined();
    expect(res.body.hint).toBeUndefined();
  });

  it('case 2: all candidates outside any semester → modifies all, no hint', async () => {
    await addSemester('2026-02-23', '2026-07-15');
    await seed(['2026-08-01', '2026-08-08', '2026-08-15']);
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-08-01', updates: { locationName: '新校区' } });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.semesterFiltered).toBeUndefined();
    expect(res.body.hint).toBeUndefined();
  });

  it('case 3: cross-semester (mixed) with semesterOnly=true (default) → only in-semester, with hint', async () => {
    await addSemester('2026-02-23', '2026-07-15');
    await seed(['2026-07-10', '2026-07-13', '2026-08-01', '2026-08-08']);
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-07-01', updates: { locationName: '新校区' } });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.semesterFiltered).toBe(2);
    expect(res.body.hint).toContain('semesterOnly=false');
  });

  it('case 3b: cross-semester with semesterOnly=false → modifies all, no hint', async () => {
    await addSemester('2026-02-23', '2026-07-15');
    await seed(['2026-07-10', '2026-08-01']);
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-07-01', semesterOnly: false, updates: { locationName: 'X' } });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.semesterFiltered).toBeUndefined();
  });

  it('case 4: no semesters defined → modifies all, no hint', async () => {
    await seed(['2026-05-04', '2026-08-01']);
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-05-01', updates: { locationName: 'X' } });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.semesterFiltered).toBeUndefined();
  });

  it('weekday omitted → matches all weekdays (no implicit weekday filter)', async () => {
    await seed(['2026-08-01', '2026-08-02', '2026-08-03']); // Sat, Sun, Mon
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-08-01', updates: { locationName: 'Y' } });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });
});

describe('DELETE /api/schedules/batch', () => {
  it('deletes by ids array', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ ids: [id] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('deletes by date range', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ start: '2026-05-01', end: '2026-05-31' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});

describe('GET /api/schedules/summary', () => {
  it('returns empty summary when no schedules', async () => {
    const res = await request(app).get('/api/schedules/summary?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.hours).toBe(0);
    expect(res.body.revenue).toBe(0);
    expect(res.body.byClass).toEqual([]);
  });

  it('returns aggregated summary', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).get('/api/schedules/summary?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.hours).toBe(1.5);
    expect(res.body.byClass).toHaveLength(1);
    expect(res.body.byClass[0].count).toBe(1);
  });

  it('requires start/end params', async () => {
    const res = await request(app).get('/api/schedules/summary').set(auth(token));
    expect(res.status).toBe(400);
  });

  it('CSV export prefixes formula-injection cells with single quote', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.update(classes).set({ name: '=cmd|attack' }).where(eq(classes.id, classId)).run();
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).get('/api/schedules/summary?start=2026-05-01&end=2026-05-31&format=csv').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.text).toContain(`"'=cmd|attack"`);
  });
});

describe('GET /api/schedules/free-slots edge cases', () => {
  it('rejects when after >= before', async () => {
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&after=20:00&before=10:00').set(auth(token));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/schedules/free-slots', () => {
  it('returns full day free when no schedules', async () => {
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-05-04');
    expect(res.body.slots).toEqual([{ start: '08:00', end: '23:00' }]);
  });

  it('excludes scheduled time from free slots', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '10:30', end: '23:00' },
    ]);
  });

  it('respects after/before parameters', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '14:00', endTime: '16:00' });
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&after=12:00&before=18:00').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([
      { start: '12:00', end: '14:00' },
      { start: '16:00', end: '18:00' },
    ]);
  });

  it('filters by minDuration', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    // Without minDuration: 08:00-09:00, 10:00-10:30
    // With minDuration=60: 08:00-09:00 kept, 10:00-10:30 (30min) filtered
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&after=08:00&before=10:30&minDuration=60').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([
      { start: '08:00', end: '09:00' },
    ]);
  });

  it('supports multi-day query with start+end', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    const res = await request(app).get('/api/schedules/free-slots?start=2026-05-04&end=2026-05-05').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].date).toBe('2026-05-04');
    expect(res.body[0].slots).toHaveLength(2);
    expect(res.body[1].date).toBe('2026-05-05');
    expect(res.body[1].slots).toEqual([{ start: '08:00', end: '23:00' }]);
  });

  it('requires date or start+end', async () => {
    const res = await request(app).get('/api/schedules/free-slots').set(auth(token));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/schedules/conflicts', () => {
  it('returns empty when no schedules', async () => {
    const res = await request(app).get('/api/schedules/conflicts?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.groups).toEqual([]);
  });

  it('returns empty when schedules do not overlap', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '10:00', endTime: '11:00' });
    const res = await request(app).get('/api/schedules/conflicts?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('detects overlapping schedules on same day', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '物理班', grade: '高一', subject: '物理', studentCount: 3, unitPrice: 120,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '11:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: classId2, date: '2026-05-04', startTime: '10:00', endTime: '12:00' });

    const res = await request(app).get('/api/schedules/conflicts?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].date).toBe('2026-05-04');
    expect(res.body.groups[0].schedules).toHaveLength(2);
  });

  it('respects limit parameter', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '物理班B', grade: '高二', subject: '物理', studentCount: 2, unitPrice: 100,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '11:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: classId2, date: '2026-05-04', startTime: '10:00', endTime: '12:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-05', startTime: '09:00', endTime: '11:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: classId2, date: '2026-05-05', startTime: '10:00', endTime: '12:00' });

    const res = await request(app).get('/api/schedules/conflicts?start=2026-05-01&end=2026-05-31&limit=1').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.groups).toHaveLength(1);
  });

  it('schedules on different days do not conflict', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '英语班', grade: '高一', subject: '英语', studentCount: 4, unitPrice: 90,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '11:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: classId2, date: '2026-05-05', startTime: '09:00', endTime: '11:00' });

    const res = await request(app).get('/api/schedules/conflicts?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res.body.total).toBe(0);
  });
});
