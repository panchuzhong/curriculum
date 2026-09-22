import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { setupApp, makeUser, auth } from './route-helpers.js';
import { DATE_MIN, DATE_MAX } from '../validations/dates.js';
import { clearSemesterCache } from '../services/schedule-helpers.js';
import { clearReportCache } from '../services/report-cache.js';
vi.mock('../services/holidays.js', () => ({ isHoliday: () => false, getHolidayName: () => '', getHolidaysForYear: () => ['01-01'] }));

let app, drizzleDb, token, classId, teacherId;

beforeEach(async () => {
  clearSemesterCache();
  clearReportCache();
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

  it('accepts repeated classId query parameters', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '物理班', grade: '高一', subject: '物理', studentCount: 2, unitPrice: 120,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: classId2, date: '2026-05-05', startTime: '09:00', endTime: '10:30' });

    const res = await request(app).get(`/api/schedules?start=2026-05-01&end=2026-05-31&classId=${classId}&classId=${classId2}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('requires start/end params', async () => {
    const res = await request(app).get('/api/schedules').set(auth(token));
    expect(res.status).toBe(400);
  });

  it('supports range=today', async () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: today, startTime: '09:00', endTime: '10:00' });
    const res = await request(app).get('/api/schedules?range=today').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('supports range=week', async () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: today, startTime: '09:00', endTime: '10:00' });
    const res = await request(app).get('/api/schedules?range=week').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('classId', classId);
    expect(res.body[0]).toHaveProperty('date');
    expect(res.body[0]).toHaveProperty('class');
  });

  it('supports range=month', async () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: today, startTime: '14:00', endTime: '15:00' });
    const res = await request(app).get('/api/schedules?range=month').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.some(s => s.date === today)).toBe(true);
  });
});

describe('PUT /api/schedules/:id', () => {
  it('updates a schedule', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).put(`/api/schedules/${id}`).set(auth(token))
      .send({ startTime: '10:00' });
    expect(res.status).toBe(200);

    // 用例名说的是"改了"，光看 200 的话一个什么都没做的 PUT 也照样通过。
    // 开始时间改了，计费时长要跟着按 10:00~10:30 重算成 30 分钟。
    const after = await request(app).get('/api/schedules?start=2026-05-04&end=2026-05-04').set(auth(token));
    const row = after.body.find(r => r.id === id);
    expect(row).toMatchObject({ startTime: '10:00', endTime: '10:30', durationBilling: 30 });
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
    const list = await request(app).get('/api/schedules?start=2026-05-04&end=2026-05-11').set(auth(token));
    expect(res.body.ids).toEqual(list.body.map(s => s.id));
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

describe('PUT /api/schedules/batch — update validation', () => {
  it.each([
    [{ durationBilling: 'not-a-number' }, 'durationBilling'],
    [{ durationBilling: -1 }, 'durationBilling'],
    [{ locationLat: 91 }, 'locationLat'],
    [{ locationLng: -181 }, 'locationLng'],
  ])('rejects invalid nested update %o', async (updates, field) => {
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-05-01', updates });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(field);
  });
});

// 只改 startTime 或只改 endTime 时，服务端要为这一批重算计费时长，可这一批的时间
// 各不相同，"该按哪个算"是猜不出来的。放行的话代码会掉到下面那行，拿 candidates[0]
// 的时间算出一个值写到每一行上——一节 90 分钟的课和一节 60 分钟的课从此记成同一个
// 时长，报表和结算金额跟着错，而接口返回 200，界面上什么都看不出来。
// 注意这一段只在改动涉及 startTime/endTime 时才进入（只改地点不重算，也就不需要拦）。
describe('PUT /api/schedules/batch — 时间不一致时不许猜计费时长', () => {
  async function seed(rows) {
    for (const [date, st, et] of rows) {
      const r = await request(app).post('/api/schedules').set(auth(token))
        .send({ classId, date, startTime: st, endTime: et });
      expect(r.status).toBe(200);
    }
  }

  it('结束时间不一致时，只改开始时间被拒', async () => {
    await seed([['2026-06-01', '09:00', '10:00'], ['2026-06-08', '09:00', '10:30']]);
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-06-01', toDate: '2026-06-08', updates: { startTime: '08:30' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('durationBilling');
  });

  it('开始时间不一致时，只改结束时间被拒', async () => {
    await seed([['2026-06-02', '09:00', '11:00'], ['2026-06-09', '10:00', '11:00']]);
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-06-02', toDate: '2026-06-09', updates: { endTime: '11:30' } });

    expect(res.status).toBe(400);
  });

  // 对照：这一批时间一致时同样的改法必须走得通，并按新的时间重算时长——
  // 否则上面两个 400 也可能只是「批量改时间坏了」。
  it('时间一致时照常改，并重算计费时长', async () => {
    await seed([['2026-06-03', '09:00', '10:30'], ['2026-06-10', '09:00', '10:30']]);
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-06-03', toDate: '2026-06-10', updates: { startTime: '09:30' } });

    expect(res.status).toBe(200);
    const rows = await request(app).get('/api/schedules?start=2026-06-03&end=2026-06-10').set(auth(token));
    const touched = rows.body.filter(r => r.startTime === '09:30');
    expect(touched.length).toBe(2);
    for (const r of touched) expect(r.durationBilling).toBe(60);
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

describe('PUT /api/schedules/batch — uniqueness conflicts', () => {
  it('returns 409 (not 500) when the batch would create duplicate (class,date,startTime)', async () => {
    // Two schedules on the same date at different times
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '08:00', endTime: '09:00' });
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '10:00', endTime: '11:00' });

    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({
        classId,
        fromDate: '2026-05-04',
        toDate: '2026-05-04',
        updates: { startTime: '14:00', endTime: '15:00' },
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('重复排课');

    // Nothing was partially applied
    const list = await request(app).get('/api/schedules')
      .query({ start: '2026-05-04', end: '2026-05-04' }).set(auth(token));
    expect(list.body).toHaveLength(2);
    expect(list.body.map(s => s.startTime).sort()).toEqual(['08:00', '10:00']);
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

  it('caches JSON summary responses', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });

    const first = await request(app).get('/api/schedules/summary?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(first.status).toBe(200);
    expect(first.headers['x-report-cache']).toBe('miss');

    const second = await request(app).get('/api/schedules/summary?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(second.status).toBe(200);
    expect(second.headers['x-report-cache']).toBe('hit');
    expect(second.body).toEqual(first.body);
  });

  it('invalidates cached summary after schedule write', async () => {
    const first = await request(app).get('/api/schedules/summary?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(first.headers['x-report-cache']).toBe('miss');

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });

    const second = await request(app).get('/api/schedules/summary?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(second.status).toBe(200);
    expect(second.headers['x-report-cache']).toBe('miss');
    expect(second.body.count).toBe(1);
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

describe('GET /api/schedules/free-slots parameter validation', () => {
  it('rejects invalid after time format', async () => {
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&after=not-a-time').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('after');
  });

  it('rejects invalid before time format', async () => {
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&before=99:00').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('before');
  });

  it('rejects invalid date format', async () => {
    const res = await request(app).get('/api/schedules/free-slots?date=not-a-date').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('date');
  });

  it('rejects invalid range dates in multi-day mode', async () => {
    const res = await request(app).get('/api/schedules/free-slots?start=2026-13-01&end=2026-05-05').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('start');
  });

  it('still accepts valid parameters', async () => {
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&after=08:00&before=22:00').set(auth(token));
    expect(res.status).toBe(200);
  });

  it('rejects a non-numeric minDuration', async () => {
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&minDuration=nope').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('minDuration');
  });

  it('rejects reversed and overlong multi-day ranges', async () => {
    const reversed = await request(app).get('/api/schedules/free-slots?start=2026-05-05&end=2026-05-04').set(auth(token));
    expect(reversed.status).toBe(400);
    const overlong = await request(app).get('/api/schedules/free-slots?start=2026-01-01&end=2027-01-02').set(auth(token));
    expect(overlong.status).toBe(400);
  });
});

describe('GET /api/schedules/free-slots', () => {
  it('returns full day free when no schedules', async () => {
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-05-04');
    expect(res.body.slots).toEqual([{ start: '08:00', end: '22:30' }]);
  });

  it('excludes scheduled time from free slots', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '10:30', end: '22:30' },
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

  it('does not extend a free slot past the requested window for a later schedule', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '23:00', endTime: '23:30' });
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&after=08:00&before=22:30').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([{ start: '08:00', end: '22:30' }]);
  });

  it('accounts for an overnight schedule from the previous date', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-03', startTime: '23:00', endTime: '01:00' });
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&after=00:00&before=02:00').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([{ start: '01:00', end: '02:00' }]);
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
    expect(res.body[1].slots).toEqual([{ start: '08:00', end: '22:30' }]);
  });

  it('applies minDuration to a multi-day query when the teacher has no classes', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.delete(classes).where(eq(classes.id, classId)).run();
    const res = await request(app)
      .get('/api/schedules/free-slots?start=2026-05-04&end=2026-05-05&after=08:00&before=09:00&minDuration=90')
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
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

  it('detects an overnight class overlapping the following morning', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '次日班', grade: '高一', subject: '物理', studentCount: 3, unitPrice: 120,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '23:00', endTime: '01:00' });
    const created = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: classId2, date: '2026-05-05', startTime: '00:30', endTime: '02:00' });
    expect(created.body.warnings).toHaveLength(1);

    const res = await request(app).get('/api/schedules/conflicts?start=2026-05-05&end=2026-05-05').set(auth(token));
    expect(res.body.total).toBe(1);
    expect(res.body.groups[0].schedules).toHaveLength(2);
  });

  it('does not report the morning and night of one date as overlapping', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '夜间班', grade: '高一', subject: '物理', studentCount: 3, unitPrice: 120,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '00:30', endTime: '02:00' });
    const created = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: classId2, date: '2026-05-04', startTime: '23:00', endTime: '01:00' });
    expect(created.body.warnings).toBeUndefined();

    const res = await request(app).get('/api/schedules/conflicts?start=2026-05-04&end=2026-05-04').set(auth(token));
    expect(res.body.total).toBe(0);
  });
});

describe('matchPricing fallback', () => {
  it('uses class default pricing when no pricing record matches the date', async () => {
    const { classPricing } = await import('../db/schema.js');
    // Add a future-dated pricing record only (effectiveFrom after schedule date)
    drizzleDb.insert(classPricing).values({
      classId, studentCount: 5, unitPrice: 200, discountAmount: 0, effectiveFrom: '2027-01-01',
    }).run();

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });

    // Summary should use class default (unitPrice=100, studentCount=5), NOT the future pricing (200)
    const res = await request(app).get('/api/schedules/summary?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.byClass[0].revenue).toBe(100 * 5 * 1); // 500, not 200*5*1=1000
  });

  it('uses matching pricing record when one exists for the date', async () => {
    const { classPricing } = await import('../db/schema.js');
    drizzleDb.insert(classPricing).values({
      classId, studentCount: 5, unitPrice: 150, discountAmount: 0, effectiveFrom: '2026-05-01',
    }).run();

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });

    const res = await request(app).get('/api/schedules/summary?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.byClass[0].revenue).toBe(150 * 5 * 1); // 750, uses the pricing record
  });

  it('CSV export uses class default when no pricing record matches', async () => {
    const { classPricing } = await import('../db/schema.js');
    drizzleDb.insert(classPricing).values({
      classId, studentCount: 5, unitPrice: 300, discountAmount: 0, effectiveFrom: '2027-01-01',
    }).run();

    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00' });

    const res = await request(app).get('/api/schedules/export?start=2026-05-01&end=2026-05-31&format=csv').set(auth(token));
    expect(res.status).toBe(200);
    // Should show class default unitPrice=100, not the future 300
    expect(res.text).toContain('"100"');
    expect(res.text).not.toContain('"300"');
  });
});

// 班级删除是软删（只把 deleted 置 true，排课行原样留着）。冲突检查若不筛掉
// 已删班级，那些课就会一直跟新排的课"撞车"——用户在界面上已经看不到这个班了，
// 却每次排课都收到一条指不出是谁的冲突提醒，而且永远消不掉。
// 两次探测必须落在同一天、都只跟"待删班"那节课重叠，否则测的就不是这个筛选。
describe('已删除班级的排课不再参与冲突提醒', () => {
  it('删掉班级后，同一天同样重叠的新课不再收到冲突警告', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '待删班', grade: '高一', subject: '物理', studentCount: 3, unitPrice: 120,
    }).run();
    const doomedId = Number(r2.lastInsertRowid);

    // 待删班：05-06 09:00~11:00
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: doomedId, date: '2026-05-06', startTime: '09:00', endTime: '11:00' });

    // 对照：还没删时，落在它区间里的课确实会收到警告
    const before = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-06', startTime: '09:15', endTime: '09:45' });
    expect(before.status).toBe(200);
    expect(before.body.warnings?.length ?? 0).toBeGreaterThan(0);

    drizzleDb.update(classes).set({ deleted: true }).where(eq(classes.id, doomedId)).run();

    // 同一天、同样落在待删班那节课的区间里，且不与上面那节 09:15~09:45 重叠
    const after = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-06', startTime: '10:15', endTime: '10:45' });
    expect(after.status).toBe(200);
    expect(after.body.warnings).toBeUndefined();
  });
});

// 经纬度的上下限在四处各写了一遍（建排课、改排课、批量改、班级默认地点），
// 此前只有"批量改"那一份有用例。越界坐标存进去不会报错，只会把课钉在地图上
// 一个不存在的点——和地理编码返回坏坐标是同一类后果。
describe('排课的经纬度边界', () => {
  it.each([
    ['纬度超上限', { locationLat: 91 }, '纬度'],
    ['纬度超下限', { locationLat: -91 }, '纬度'],
    ['经度超上限', { locationLng: 181 }, '经度'],
    ['经度超下限', { locationLng: -181 }, '经度'],
  ])('POST 时%s被拒', async (_label, patch, word) => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-20', startTime: '09:00', endTime: '10:00', ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(word);
  });

  it.each([
    ['纬度超上限', { locationLat: 91 }],
    ['经度超下限', { locationLng: -181 }],
  ])('PUT 时%s被拒', async (_label, patch) => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-21', startTime: '09:00', endTime: '10:00' });
    const res = await request(app).put(`/api/schedules/${id}`).set(auth(token)).send(patch);
    expect(res.status).toBe(400);
  });

  it('边界值本身是允许的', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-22', startTime: '09:00', endTime: '10:00', locationLat: 90, locationLng: -180 });
    expect(res.status).toBe(200);
  });
});

// 批量删除的 ids 上限：不封顶的话一次请求就能塞进任意长的数组。
describe('批量删除的 ids 上限', () => {
  it('超过 500 项时被拒并说明上限', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    const res = await request(app).delete('/api/schedules/batch').set(auth(token)).send({ ids });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ids 最多 500 项');
  });

  it('正好 500 项是允许的', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => i + 1);
    const res = await request(app).delete('/api/schedules/batch').set(auth(token)).send({ ids });
    expect(res.status).toBe(200);
  });
});

// GET /api/schedules 的 365 天上限两个方向都是承重的，而两侧此前都没有用例：
// 不加筛选时要拦住（否则一次请求把整库排课拉出来），
// 带 classId/studentId 时必须放行——ScheduleHistory 正是靠这一点一次拉完某个班的
// 全部排课（DATE_MIN~DATE_MAX，1100 年），CLAUDE.md 把这条写成了约定。
// limit 的上下夹取是 agent-help 对外写明的约定（schedules 上限 1000、
// conflicts 上限 100），而且是承重的：下界被去掉时 limit=-1 会原样传给 SQL，
// 而 SQLite 的 LIMIT -1 表示"不限"——于是一个负数就能把分页整个绕过去，
// 一次把全部排课拉出来。两处此前都没有用例。
describe('分页 limit 的夹取', () => {
  async function seed(n) {
    for (let i = 0; i < n; i++) {
      const d = `2026-03-${String(i + 1).padStart(2, '0')}`;
      await request(app).post('/api/schedules').set(auth(token))
        .send({ classId, date: d, startTime: '09:00', endTime: '10:00' });
    }
  }

  it('limit 为负数时夹到 1，而不是变成"不限"', async () => {
    await seed(3);
    const res = await request(app)
      .get('/api/schedules?start=2026-03-01&end=2026-03-31&limit=-1').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  // limit=0 走的不是夹取那条路：parseInt('0') || 100 里的 0 是假值，
  // 所以它回落到默认的 100，而不是被夹成 1。行为本身没问题（要 0 条等于没说），
  // 但容易看错，钉一下省得下次有人把 || 改成 ??（那样 0 就真成 0 条了）。
  it('limit=0 回落到默认值，不是 0 条', async () => {
    await seed(3);
    const res = await request(app)
      .get('/api/schedules?start=2026-03-01&end=2026-03-31&limit=0').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  // 库里只有 3 行的话，"不超过 1000"在有没有上限两种情况下都成立——
  // 这条用例原来就是这么写的，把 1000 的上限整个拿掉照样绿。要看出上限，
  // 库里就得多于 1000 行。
  it('limit 超过上限时按上限返回，不报错', async () => {
    const { schedules } = await import('../db/schema.js');
    const stmt = drizzleDb.$client.prepare(
      'INSERT INTO schedules (class_id, date, start_time, end_time, duration_billing) VALUES (?, ?, ?, ?, ?)'
    );
    // (class_id, date, start_time) 唯一，所以按分钟铺开：1100 行跨若干天。
    drizzleDb.$client.transaction(() => {
      for (let i = 0; i < 1100; i++) {
        const day = 1 + Math.floor(i / 60);
        const minute = i % 60;
        stmt.run(classId, `2026-03-${String(day).padStart(2, '0')}`,
          `09:${String(minute).padStart(2, '0')}`, '23:00', 60);
      }
    })();

    const res = await request(app)
      .get('/api/schedules?start=2026-03-01&end=2026-03-31&limit=999999').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.length, 'limit 的 1000 上限没生效').toBe(1000);
  });

  it('limit 在上限以内时按给的数量返回（对照）', async () => {
    await seed(3);
    const res = await request(app)
      .get('/api/schedules?start=2026-03-01&end=2026-03-31&limit=2').set(auth(token));
    expect(res.body).toHaveLength(2);
  });

  // 钉的是对外承诺的行为：负数 limit 不会把全部冲突组一次端出来。
  // 注意这里的 Math.max(1, ...) 本身是惰性的——收集循环写的是
  // `if (conflictGroups.length >= limit) break;`，limit 为 -1 时第一组就满足
  // 1 >= -1，照样只返回一组。所以这条用例盯的是结果，不是那个下界表达式；
  // 上界（100）要造出 100 组以上才观察得到，不值当。
  it('conflicts 的 limit 为负数时也只返回一组', async () => {
    // 必须先真的造出多个冲突组，否则 groups 是空的，"不超过 1 组"怎么都成立。
    // 三天，每天两节互相重叠的课 = 三组。
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId, name: '冲突班', grade: '高一', subject: '物理', studentCount: 1, unitPrice: 100,
    }).run();
    const other = Number(r2.lastInsertRowid);
    for (const d of ['2026-03-02', '2026-03-03', '2026-03-04']) {
      await request(app).post('/api/schedules').set(auth(token))
        .send({ classId, date: d, startTime: '09:00', endTime: '11:00' });
      await request(app).post('/api/schedules').set(auth(token))
        .send({ classId: other, date: d, startTime: '10:00', endTime: '12:00' });
    }

    const all = await request(app)
      .get('/api/schedules/conflicts?start=2026-03-01&end=2026-03-31').set(auth(token));
    expect(all.body.groups.length).toBeGreaterThan(1);

    const clamped = await request(app)
      .get('/api/schedules/conflicts?start=2026-03-01&end=2026-03-31&limit=-1').set(auth(token));
    expect(clamped.status).toBe(200);
    expect(clamped.body.groups).toHaveLength(1);
  });
});

// validateRange 是 GET / 、/summary、/export、/free-slots、/conflicts 五个端点共用的
// 唯一一道日期闸门——服务端这半边的日期上下限全靠它。而它的判据是
// `!isValidDate(start) || !isValidDate(end)`：把 || 写成 && 的话，**只有一端越界**
// 的区间就会被放行，/summary 会拿 1899 年到今天的数据算出一个看着完全正常的
// 收入数字返回 200。此前所有 400 用例两端都是坏的，这个 || 从来没被区分过。
// 学期区间含首尾两天（agent-help 写的是"含起止日"，客户端 semesterRange 也这么算）。
// 这个 >= / <= 一旦收紧成开区间，正好排在学期第一天或最后一天的课就被判成"学期外"。
// 最要命的是下面第二条：学期保护只在"一部分在内、一部分在外"时才生效，
// 所以当唯一那节在学期内的课是边界课时，判错会让 inSemester 变成空集——
// 保护整个失效，这一批**全部**被删掉，而删除是不可撤销的。
// 同一个班在同一天同一时刻排两节课是最常撞上的冲突，而这三处 409 此前一个用例都没有。
// 去掉之后错误会掉到兜底处理器：唯一索引 idx_schedules_unique 抛出的约束冲突
// 变成一句「Internal server error」，老师只知道"出错了"，不知道是这一格已经有课了。
describe('同一班级同一时刻不能排两节课', () => {
  it('单条新建重复时 409，并说清是重复排课', async () => {
    const first = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-04-06', startTime: '09:00', endTime: '10:00' });
    expect(first.status).toBe(200);

    const dup = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-04-06', startTime: '09:00', endTime: '11:00' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('该班级在此日期的同一时间已有排课');
  });

  // 对照：换个开始时间就不算重复（唯一键是 班级+日期+开始时间）
  it('同一天不同开始时间不算重复', async () => {
    expect((await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-04-07', startTime: '09:00', endTime: '10:00' })).status).toBe(200);
    expect((await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-04-07', startTime: '11:00', endTime: '12:00' })).status).toBe(200);
  });

  it('批量新建里混有重复日期时 409，并说清是哪一类问题', async () => {
    expect((await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-04-13', startTime: '09:00', endTime: '10:00' })).status).toBe(200);

    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, dates: ['2026-04-13', '2026-04-20'], startTime: '09:00', endTime: '10:00' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('部分日期同一时间已有排课，请检查冲突');
  });
});

// 区间倒挂时要当场说明，而不是默默匹配到 0 条然后回一句"改了 0 条"——
// 那种结果看起来像"没有符合条件的课"，用户不会想到是自己把日期填反了。
describe('批量修改的 fromDate/toDate 顺序', () => {
  it('fromDate 晚于 toDate 时 400，并说明顺序要求', async () => {
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-06-30', toDate: '2026-06-01', updates: { locationName: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('fromDate 须不晚于 toDate');
  });

  it('顺序正确时照常执行', async () => {
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-06-01', toDate: '2026-06-30', updates: { locationName: 'x' } });
    expect(res.status).toBe(200);
  });
});

describe('学期边界的首尾两天算在学期内', () => {
  let semClassId, otherId;
  beforeEach(async () => {
    const { semesters, classes } = await import('../db/schema.js');
    drizzleDb.insert(semesters).values({
      teacherId, name: '边界学期', type: 'spring', startDate: '2026-06-01', endDate: '2026-06-30',
    }).run();
    clearSemesterCache();
    const r = drizzleDb.insert(classes).values({
      teacherId, name: '边界班', grade: '高一', subject: '数学', studentCount: 1, unitPrice: 100,
    }).run();
    semClassId = Number(r.lastInsertRowid);
    otherId = semClassId;
  });

  async function add(date) {
    const r = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId: semClassId, date, startTime: '09:00', endTime: '10:00' });
    expect(r.status).toBe(200);
  }

  it('首日和末日的课都算学期内，只过滤掉真正在外面的那节', async () => {
    await add('2026-06-01');   // 学期第一天
    await add('2026-06-30');   // 学期最后一天
    await add('2026-05-20');   // 学期之外

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ classId: semClassId, start: '2026-05-01', end: '2026-07-31', dryRun: true });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);            // 两节边界课
    expect(res.body.semesterFiltered).toBe(1); // 学期外那一节
  });

  it('唯一在学期内的是边界课时，保护不能整个失效', async () => {
    await add('2026-06-01');   // 唯一在学期内的，且正好是首日
    await add('2026-05-20');   // 学期之外

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ classId: semClassId, start: '2026-05-01', end: '2026-07-31', dryRun: true });

    expect(res.status).toBe(200);
    // 判错的话 inSemester 为空 → 过滤不启用 → count 变成 2（两节全删）
    expect(res.body.count).toBe(1);
    expect(res.body.semesterFiltered).toBe(1);
  });

  // 同一个"含首尾"判据在批量新建的跨学期检查里还有第二份（schedules.js 的
  // crossSemester 那段）。边界日判错的话，"一半在学期内一半在外"就识别不出来，
  // 那道 400 不会出现，课直接跨着学期边界排进去了。
  it.each([
    ['首日', '2026-06-01'],
    ['末日', '2026-06-30'],
  ])('批量新建时 %s 也算学期内，跨学期检查照常触发', async (_label, boundary) => {
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId: semClassId, dates: [boundary, '2026-05-20'], startTime: '14:00', endTime: '15:00' });

    expect(res.status).toBe(400);
    expect(res.body.crossSemester).toBe(true);
  });

  it('末日那一侧同理', async () => {
    await add('2026-06-30');
    await add('2026-07-10');

    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ classId: semClassId, start: '2026-05-01', end: '2026-07-31', dryRun: true });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.semesterFiltered).toBe(1);
  });
});

// 学期本身没有跨度上限（校验器只管日期合法和首尾顺序），而按学期批量排课是
// 一天一天同步走完整个区间的。一个打错的多年学期会让这个循环在事件循环上
// 跑满几秒——服务端在那期间对谁都没有响应。这道 550 天的闸门此前没有用例。
describe('按学期批量排课的跨度上限', () => {
  async function makeSemester(startDate, endDate) {
    const { semesters } = await import('../db/schema.js');
    const r = drizzleDb.insert(semesters).values({
      teacherId, name: `跨度_${startDate}`, type: 'spring', startDate, endDate,
    }).run();
    clearSemesterCache();
    return Number(r.lastInsertRowid);
  }

  it('超过 550 天时拒绝，并说明是学期跨度的问题', async () => {
    // 排课是从**今天**走起的（今天晚于学期开始时取今天，见 semesterRange 规则），
    // 所以要触发 550 天的闸门，得让"今天到学期结束"这一段超过 550 天。
    const far = new Date(Date.now() + 900 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const semesterId = await makeSemester('2026-01-01', far);
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, semesterId, weekday: 1, startTime: '09:00', endTime: '10:00' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('学期跨度过长，请检查学期起止日期');
  });

  // 对照：正常长度的学期必须照常排，否则上面那条也可能只是"按学期排课整个坏了"。
  it('正常长度的学期照常排课', async () => {
    // 同理，学期得还没过完，否则从今天走起一个日期都剩不下（400 No valid dates）。
    const start = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const semesterId = await makeSemester(start, end);
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, semesterId, weekday: 1, startTime: '09:00', endTime: '10:00' });

    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
  });
});

describe('日期区间只有一端越界时也必须拒绝', () => {
  const BAD_START = ['1899-12-31', '2026-12-31'];
  const BAD_END = ['2026-01-01', '3000-01-01'];

  it.each([
    ['GET /', (q) => `/api/schedules?start=${q[0]}&end=${q[1]}`],
    ['/summary', (q) => `/api/schedules/summary?start=${q[0]}&end=${q[1]}`],
    ['/export', (q) => `/api/schedules/export?start=${q[0]}&end=${q[1]}`],
  ])('%s：start 越界、end 正常时 400', async (_label, url) => {
    const res = await request(app).get(url(BAD_START)).set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('YYYY-MM-DD');
  });

  it.each([
    ['GET /', (q) => `/api/schedules?start=${q[0]}&end=${q[1]}`],
    ['/summary', (q) => `/api/schedules/summary?start=${q[0]}&end=${q[1]}`],
    ['/export', (q) => `/api/schedules/export?start=${q[0]}&end=${q[1]}`],
  ])('%s：start 正常、end 越界时 400', async (_label, url) => {
    const res = await request(app).get(url(BAD_END)).set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('YYYY-MM-DD');
  });

  // 对照：两端都正常时照常返回，免得上面的断言靠"什么都拒"成立。
  it('两端都在范围内时正常返回', async () => {
    const res = await request(app)
      .get('/api/schedules/summary?start=2026-01-01&end=2026-12-31').set(auth(token));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/schedules 的 365 天上限', () => {
  it('不带筛选且超过 365 天时被拒，并说清该怎么办', async () => {
    const res = await request(app).get('/api/schedules?start=2026-01-01&end=2027-01-03').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('日期范围超过365天时请指定 classId 或 studentId 筛选条件');
  });

  // 边界要贴着测：只测「一年以内放行 + 明显超出拒绝」的话，把 > 365 写成 > 366
  // 察觉不到。注意跨度算的是 end - start（不含首日），所以 365 那一天是 2027-01-01。
  it('正好 365 天是允许的', async () => {
    const res = await request(app).get('/api/schedules?start=2026-01-01&end=2027-01-01').set(auth(token));
    expect(res.status).toBe(200);
  });

  it('多一天（366）就要被拒', async () => {
    const res = await request(app).get('/api/schedules?start=2026-01-01&end=2027-01-02').set(auth(token));
    expect(res.status).toBe(400);
  });

  it.each([
    ['classId', () => `classId=${classId}`],
    ['studentId', () => 'studentId=1'],
  ])('带 %s 时不受上限约束（排课历史靠这个一次拉完整个班）', async (_label, qs) => {
    const res = await request(app)
      .get(`/api/schedules?start=${DATE_MIN}&end=${DATE_MAX}&${qs()}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('conflicts endpoint isolates by teacher', () => {
  it('does not return conflicts from another teacher', async () => {
    const { token: token2, id: teacherId2 } = await makeUser(drizzleDb, 'user2');
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId: teacherId2, name: '别班', grade: '高一', subject: '数学', studentCount: 3, unitPrice: 80,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    // Both teachers have schedules overlapping on same day
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '11:00' });
    await request(app).post('/api/schedules').set(auth(token2))
      .send({ classId: classId2, date: '2026-05-04', startTime: '10:00', endTime: '12:00' });

    // Teacher 1 should see no conflicts (only their own schedules)
    const res1 = await request(app).get('/api/schedules/conflicts?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res1.body.total).toBe(0);

    // Teacher 2 should also see no conflicts
    const res2 = await request(app).get('/api/schedules/conflicts?start=2026-05-01&end=2026-05-31').set(auth(token2));
    expect(res2.body.total).toBe(0);
  });
});

describe('edge cases', () => {
  it('rejects startTime === endTime', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-08-01', startTime: '09:00', endTime: '09:00' });
    expect(res.status).toBe(400);
  });

  it('accepts cross-midnight schedule (end < start)', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-08-02', startTime: '22:00', endTime: '01:00' });
    expect(res.status).toBe(200);
    expect(res.body.endTime).toBe('01:00');
    expect(res.body.durationBilling).toBe(180);
  });

  it('accepts extended end time and stores clock time', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-08-03', startTime: '22:00', endTime: '25:00' });
    expect(res.status).toBe(200);
    expect(res.body.endTime).toBe('01:00');
    expect(res.body.durationBilling).toBe(180);
  });

  it('rejects an extended end time representing 24 hours or more', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-08-03', startTime: '10:00', endTime: '35:00' });
    expect(res.status).toBe(400);
  });

  it('allows an update to clear schedule location fields', async () => {
    const created = await request(app).post('/api/schedules').set(auth(token))
      .send({
        classId, date: '2026-08-04', startTime: '09:00', endTime: '10:00',
        locationName: '旧地点', locationLat: 31.2, locationLng: 121.4,
      });
    const res = await request(app).put(`/api/schedules/${created.body.id}`).set(auth(token))
      .send({ locationName: null, locationLat: null, locationLng: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ locationName: null, locationLat: null, locationLng: null });
  });
});

describe('PUT /api/schedules/:id location clearing', () => {
  it('clears stale coordinates when the location name is removed', async () => {
    const created = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30',
              locationName: '一中', locationLat: 39.9, locationLng: 116.4 });
    expect(created.status).toBe(200);

    const res = await request(app).put(`/api/schedules/${created.body.id}`).set(auth(token))
      .send({ locationName: null });
    expect(res.status).toBe(200);
    // Keeping 39.9/116.4 would leave the row pointing at the place just removed
    expect(res.body.locationName).toBeNull();
    expect(res.body.locationLat).toBeNull();
    expect(res.body.locationLng).toBeNull();
  });

  it('keeps explicitly supplied coordinates even when the name is cleared', async () => {
    const created = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-05', startTime: '09:00', endTime: '10:30',
              locationName: '一中', locationLat: 39.9, locationLng: 116.4 });

    const res = await request(app).put(`/api/schedules/${created.body.id}`).set(auth(token))
      .send({ locationName: null, locationLat: 31.2, locationLng: 121.5 });
    expect(res.status).toBe(200);
    expect(res.body.locationLat).toBe(31.2);
    expect(res.body.locationLng).toBe(121.5);
  });
});

describe('GET /api/schedules/free-slots minDuration compatibility', () => {
  it('treats an empty minDuration the same as omitting it', async () => {
    const omitted = await request(app).get('/api/schedules/free-slots?date=2026-05-04').set(auth(token));
    // A client that always appends &minDuration= must not get a 400
    const blank = await request(app).get('/api/schedules/free-slots?date=2026-05-04&minDuration=').set(auth(token));
    expect(blank.status).toBe(200);
    expect(blank.body).toEqual(omitted.body);
  });

  it('still rejects a non-numeric minDuration', async () => {
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&minDuration=abc').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('minDuration');
  });

  it('still rejects a negative minDuration', async () => {
    const res = await request(app).get('/api/schedules/free-slots?date=2026-05-04&minDuration=-5').set(auth(token));
    expect(res.status).toBe(400);
  });
});

// 越界日期的 400 必须把范围写出来。这几处的后缀之前一条断言也没有：
// 把 DATE_RANGE_SUFFIX 整个去掉，整套服务端用例全绿。而它正是用户真正看到的那句话（前端
// 直接把服务端的 message 弹成 toast），只说「格式不对」的话老师无从知道到底要填什么。
describe('越界日期的报错里写出范围', () => {
  const OUT = '3000-01-01';

  it('GET /api/schedules 的区间校验', async () => {
    const res = await request(app).get(`/api/schedules?start=${OUT}&end=${OUT}`).set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(DATE_MIN);
    expect(res.body.error).toContain(DATE_MAX);
  });

  it('GET /api/schedules/free-slots 的日期参数', async () => {
    const res = await request(app).get(`/api/schedules/free-slots?start=${OUT}&end=${OUT}`).set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(DATE_MIN);
    expect(res.body.error).toContain(DATE_MAX);
  });

  it('POST /api/schedules 的 date', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: OUT, startTime: '08:00', endTime: '10:00' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(DATE_MIN);
    expect(JSON.stringify(res.body)).toContain(DATE_MAX);
  });
});

// ?classId= 走的是「在本教师自己的班里再筛一遍」。把 filter 换成直接采用查询参数
// （classIds = queryClassIds）在五个端点上全都是绿的——因为现有用例只用自己的班号，
// 只证明了筛选会收窄，没证明它把别人的班号挡在外面。第 30 轮实测：这么改之后
// GET 会原样返回别的教师的排课，而 DELETE /batch 会把别人的课删掉。
describe('?classId= 只认本教师自己的班', () => {
  let otherClassId, otherScheduleId;

  beforeEach(async () => {
    const { classes, schedules, teachers } = await import('../db/schema.js');
    const other = drizzleDb.insert(teachers).values({
      username: 'other', passwordHash: 'x', name: 'other', apiKey: 'key-other',
    }).run();
    const oc = drizzleDb.insert(classes).values({
      teacherId: Number(other.lastInsertRowid), name: 'B的班', grade: '高二',
      subject: '物理', studentCount: 3, unitPrice: 200,
    }).run();
    otherClassId = Number(oc.lastInsertRowid);
    const os = drizzleDb.insert(schedules).values({
      classId: otherClassId, date: '2026-05-04', startTime: '09:00', endTime: '10:30',
      durationBilling: 90, locationName: 'B的秘密教室',
    }).run();
    otherScheduleId = Number(os.lastInsertRowid);
    // 第二节和第一节重叠：/conflicts 只报冲突组，别的教师那边得真有一组冲突，
    // 否则「结果里没有 B 的东西」在漏与不漏两种情况下都成立。
    drizzleDb.insert(schedules).values({
      classId: otherClassId, date: '2026-05-04', startTime: '10:00', endTime: '11:30',
      durationBilling: 90, locationName: 'B的另一间教室',
    }).run();
    // 本教师自己也排一节，避免走 classIds.length === 0 的短路。
    drizzleDb.insert(schedules).values({
      classId, date: '2026-05-04', startTime: '14:00', endTime: '15:00',
      durationBilling: 60, locationName: 'A的教室',
    }).run();
  });

  const range = { start: '2026-05-01', end: '2026-05-31' };

  it('GET /api/schedules 不返回别的教师的排课', async () => {
    const res = await request(app).get('/api/schedules')
      .query({ ...range, classId: otherClassId }).set(auth(token));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('B的秘密教室');
    expect(res.body.every(r => r.classId !== otherClassId)).toBe(true);
  });

  it('GET /api/schedules/summary 不统计别的教师的排课', async () => {
    const res = await request(app).get('/api/schedules/summary')
      .query({ ...range, classId: otherClassId }).set(auth(token));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('B的班');
  });

  it('GET /api/schedules/export 不导出别的教师的排课', async () => {
    const res = await request(app).get('/api/schedules/export')
      .query({ ...range, classId: otherClassId }).set(auth(token));
    expect(res.status).toBe(200);
    expect(String(res.text)).not.toContain('B的秘密教室');
  });

  it('GET /api/schedules/conflicts 不检查别的教师的排课', async () => {
    const res = await request(app).get('/api/schedules/conflicts')
      .query({ ...range, classId: otherClassId }).set(auth(token));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('B的');
    expect(res.body.total).toBe(0);

    // 正向对照：本教师自己也造一组冲突，不带 classId 查得出来。没有这一条的话，
    // 上面的"零冲突"在挡住了和根本查不出东西两种情况下都成立。
    const { schedules } = await import('../db/schema.js');
    drizzleDb.insert(schedules).values({
      classId, date: '2026-05-04', startTime: '14:30', endTime: '16:00',
      durationBilling: 90, locationName: 'A的另一间教室',
    }).run();
    const mine = await request(app).get('/api/schedules/conflicts').query(range).set(auth(token));
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBe(1);
    expect(JSON.stringify(mine.body)).not.toContain('B的');
  });

  // 这一条是最要紧的：读漏了是泄漏，写漏了是别人的数据没了。
  it('DELETE /api/schedules/batch 删不掉别的教师的排课', async () => {
    const { schedules } = await import('../db/schema.js');
    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ ...range, classId: otherClassId });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);

    const still = drizzleDb.select().from(schedules).all().filter(r => r.id === otherScheduleId);
    expect(still, '别的教师的排课被删掉了').toHaveLength(1);
  });

  // 逗号分隔的多班号只有 GET 支持（DELETE /batch 的校验要求 classId 是单个整数，
  // 传列表会 400）。混着自己的和别人的班号时，只该返回自己那个班的课。
  it('GET 同时传自己和别人的班号时，只返回自己的班', async () => {
    const res = await request(app).get('/api/schedules')
      .query({ ...range, classId: `${classId},${otherClassId}` }).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].classId).toBe(classId);
    expect(JSON.stringify(res.body)).not.toContain('B的秘密教室');
  });

  it('DELETE /batch 传逗号列表时直接 400，不会被当成多个班', async () => {
    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ ...range, classId: `${classId},${otherClassId}` });
    expect(res.status).toBe(400);
  });
});

// 排课的每一次写入都直接改报表金额，写完必须清报表缓存。缓存 TTL 是 60 秒：
// 不清的话，删掉一节课再看报表，收入还是旧的，响应头还写着 X-Report-Cache: hit，
// 页面上没有任何"这是旧数据"的迹象。九条写路径此前只有 POST 一条有用例。
//
// 铺数据必须在灌缓存之前：铺数据本身就是一次写入，也会清缓存。混在一起的话，
// 被测的那一次写入即使不清缓存，用例照样绿（第一版就是这么写的，六处删掉全绿）。
describe('排课写操作会让报表缓存失效', () => {
  const key = () => ({ teacherId, start: '2026-01-01', end: '2026-12-31' });

  async function seedSchedule(date) {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date, startTime: '09:00', endTime: '10:30' });
    expect(res.status).toBe(200);
    return res.body.id ?? res.body[0]?.id;
  }

  it.each([
    ['POST /api/schedules', null, () => request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-06', startTime: '09:00', endTime: '10:30' })],
    ['POST /batch', null, () => request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, dates: ['2026-05-07'], startTime: '09:00', endTime: '10:30' })],
    ['PUT /batch', () => seedSchedule('2026-05-08'), () => request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-05-01', toDate: '2026-05-31', updates: { startTime: '11:00', endTime: '12:00' } })],
    ['PUT /batch（dayShift）', () => seedSchedule('2026-05-14'), () => request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-05-01', toDate: '2026-05-31', updates: { dayShift: 1 } })],
    ['DELETE /batch（ids）', () => seedSchedule('2026-05-09'), (id) => request(app).delete('/api/schedules/batch')
      .set(auth(token)).send({ ids: [id] })],
    ['DELETE /batch（日期范围）', () => seedSchedule('2026-05-10'), () => request(app).delete('/api/schedules/batch')
      .set(auth(token)).send({ classId, start: '2026-05-01', end: '2026-05-31' })],
    ['DELETE /batch（fromDate）', () => seedSchedule('2026-05-13'), () => request(app).delete('/api/schedules/batch')
      .set(auth(token)).send({ classId, fromDate: '2026-05-01' })],
    ['PUT /:id', () => seedSchedule('2026-05-11'), (id) => request(app).put(`/api/schedules/${id}`)
      .set(auth(token)).send({ startTime: '13:00', endTime: '14:00' })],
    ['DELETE /:id', () => seedSchedule('2026-05-12'), (id) => request(app).delete(`/api/schedules/${id}`)
      .set(auth(token))],
  ])('%s 之后缓存被清掉', async (_label, setup, act) => {
    const { setReportCache, getReportCache, clearReportCache } = await import('../services/report-cache.js');
    const seeded = setup ? await setup() : null;

    clearReportCache();
    setReportCache(key(), { revenue: '旧数据' });
    expect(getReportCache(key())).toEqual({ revenue: '旧数据' });

    const res = await act(seeded);
    expect(res.status).toBe(200);
    expect(getReportCache(key()), '这次写入没有清掉报表缓存').toBeNull();
  });
});

// /conflicts 查的是 [start-1, end+1]（跨零点的课要连上前后一天），但只该报落在
// [start, end] 里的冲突。去掉那道过滤整套测试照样全绿——缓冲区里的冲突会被当成
// 区间内的报出来，用户在冲突列表里看到一个自己这段时间根本没排的日子。
describe('/conflicts 只报区间内的冲突', () => {
  async function seedConflictOn(date) {
    const { schedules } = await import('../db/schema.js');
    drizzleDb.insert(schedules).values({
      classId, date, startTime: '09:00', endTime: '11:00', durationBilling: 120,
    }).run();
    drizzleDb.insert(schedules).values({
      classId, date, startTime: '10:00', endTime: '12:00', durationBilling: 120,
    }).run();
  }

  it('缓冲区（区间前一天）里的冲突不报', async () => {
    await seedConflictOn('2026-05-03');
    const res = await request(app).get('/api/schedules/conflicts')
      .query({ start: '2026-05-04', end: '2026-05-10' }).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('缓冲区（区间后一天）里的冲突也不报', async () => {
    await seedConflictOn('2026-05-11');
    const res = await request(app).get('/api/schedules/conflicts')
      .query({ start: '2026-05-04', end: '2026-05-10' }).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('区间内的冲突照常报（对照）', async () => {
    await seedConflictOn('2026-05-05');
    const res = await request(app).get('/api/schedules/conflicts')
      .query({ start: '2026-05-04', end: '2026-05-10' }).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.groups[0].date).toBe('2026-05-05');
  });

  it('区间边界那天的冲突要报', async () => {
    await seedConflictOn('2026-05-04');
    const res = await request(app).get('/api/schedules/conflicts')
      .query({ start: '2026-05-04', end: '2026-05-10' }).set(auth(token));
    expect(res.body.total).toBe(1);
  });
});

// free-slots 有两条路：?date=X 和 ?start=X&end=X。两条都得把前一天的跨零点课
// 算进来，否则同一天的空闲时段在两条路上给出不同答案——而调用方（批量排课的
// "查空档"）可能走任意一条。
describe('free-slots 两条路对同一天给出同样的空档', () => {
  beforeEach(async () => {
    const { schedules } = await import('../db/schema.js');
    // 前一天 23:00 上到次日 01:00，占掉 X 当天的第一个小时。
    drizzleDb.insert(schedules).values({
      classId, date: '2026-05-03', startTime: '23:00', endTime: '01:00', durationBilling: 120,
    }).run();
  });

  it('?date= 和 ?start=&end= 给出同样的结果', async () => {
    const q = { dayStart: '00:00', dayEnd: '12:00' };
    const single = await request(app).get('/api/schedules/free-slots')
      .query({ ...q, date: '2026-05-04' }).set(auth(token));
    const ranged = await request(app).get('/api/schedules/free-slots')
      .query({ ...q, start: '2026-05-04', end: '2026-05-04' }).set(auth(token));
    expect(single.status).toBe(200);
    expect(ranged.status).toBe(200);

    const rangedForDay = (ranged.body.find(r => r.date === '2026-05-04') || {}).slots || [];
    const singleSlots = Array.isArray(single.body) ? single.body : single.body.slots;
    expect(rangedForDay).toEqual(singleSlots);
  });

  it('前一天的跨零点课确实占掉了当天第一个小时（否则上一条是空的）', async () => {
    const res = await request(app).get('/api/schedules/free-slots')
      .query({ start: '2026-05-04', end: '2026-05-04', dayStart: '00:00', dayEnd: '12:00' }).set(auth(token));
    const slots = (res.body.find(r => r.date === '2026-05-04') || {}).slots || [];
    expect(slots.length).toBeGreaterThan(0);
    // 第一个空档不该从 00:00 开始——那一小时被前一天的课占着。
    expect(slots[0].start).not.toBe('00:00');
  });
});

// /conflicts 每条排课都该带完整的 class 对象。这个接口的唯一用途就是把冲突讲清楚，
// 而只挑 id 出来的话返回的是 {id: N} 这样的残件——调用方拿不到班级名，只能再逐个去查。
// 别的排课接口给的都是完整对象，这里的 s.classId 本来就在行里，挂一个只有 id 的
// class 等于白挂。
describe('/conflicts 返回完整的班级信息', () => {
  it('每条冲突排课都带班级名、年级、学科', async () => {
    const { classes, schedules } = await import('../db/schema.js');
    const other = drizzleDb.insert(classes).values({
      teacherId, name: '物理班', grade: '高二', subject: '物理', studentCount: 2, unitPrice: 200,
    }).run();
    const otherId = Number(other.lastInsertRowid);

    drizzleDb.insert(schedules).values({
      classId, date: '2026-05-04', startTime: '09:00', endTime: '11:00', durationBilling: 120,
    }).run();
    drizzleDb.insert(schedules).values({
      classId: otherId, date: '2026-05-04', startTime: '10:00', endTime: '12:00', durationBilling: 120,
    }).run();

    const res = await request(app).get('/api/schedules/conflicts')
      .query({ start: '2026-05-01', end: '2026-05-31' }).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);

    const group = res.body.groups[0].schedules;
    expect(group).toHaveLength(2);
    for (const s of group) {
      expect(s.class, '冲突排课没带班级对象').toBeTruthy();
      expect(s.class.name, '班级对象只有 id，没有名字').toBeTruthy();
      expect(s.class.grade).toBeTruthy();
      expect(s.class.subject).toBeTruthy();
    }
    expect(new Set(group.map(s => s.class.name))).toEqual(new Set(['数学班', '物理班']));
  });
});

// /summary 的次级形状：byClass 按收入从高到低，bySubject 的 hours 累的是课时不是节数。
// 网页端的 Reports 自己会重排重算，所以这两项只对 API 客户端和 CSV 导出可见。
describe('/summary 的排序与汇总', () => {
  // byClass 是从一个以 classId 为键的对象上 Object.entries 出来的，而整数键
  // 按数值升序遍历——所以"天然顺序"就是 classId 升序。要让排序真的起作用，
  // id 大的那个班收入必须更高，否则天然顺序本身就是收入降序，
  // 把 .sort() 整个删掉照样绿。
  beforeEach(async () => {
    const { classes, schedules } = await import('../db/schema.js');
    // 外层 beforeEach 已经建了「数学班」(unitPrice 100 × 5 人 = 500/时)，id 更小。
    const pricey = drizzleDb.insert(classes).values({
      teacherId, name: '贵班', grade: '高二', subject: '物理', studentCount: 1, unitPrice: 1000,
    }).run();
    const priceyId = Number(pricey.lastInsertRowid);

    // 数学班：1 节 × 2 小时 → 1000 元
    drizzleDb.insert(schedules).values({
      classId, date: '2026-05-04', startTime: '09:00', endTime: '11:00', durationBilling: 120,
    }).run();
    // 贵班：2 节 × 1 小时 → 2000 元，收入更高但 classId 更大
    for (const [i, d] of ['2026-05-05', '2026-05-06'].entries()) {
      drizzleDb.insert(schedules).values({
        classId: priceyId, date: d, startTime: `0${9 + i}:00`, endTime: `1${i}:00`, durationBilling: 60,
      }).run();
    }
  });

  it('byClass 按收入从高到低排', async () => {
    const res = await request(app).get('/api/schedules/summary')
      .query({ start: '2026-05-01', end: '2026-05-31' }).set(auth(token));
    expect(res.status).toBe(200);
    const revenues = res.body.byClass.map(c => c.revenue);
    expect(revenues.length).toBeGreaterThan(1);
    expect(revenues).toEqual([...revenues].sort((a, b) => b - a));
    // classId 更大的「贵班」收入更高，必须排在前面——排序没生效的话它在后面。
    expect(res.body.byClass[0].name, 'byClass 没有按收入降序排').toBe('贵班');
  });

  // 收入打平时按 classId 升序，保证同样的查询每次返回同样的顺序
  // （CSV 导出和 agent 做 diff 都指望这个）。
  it('收入相同时按 classId 升序，顺序是稳定的', async () => {
    const { classes, schedules } = await import('../db/schema.js');
    const ids = [];
    for (const name of ['并列甲', '并列乙']) {
      const c = drizzleDb.insert(classes).values({
        teacherId, name, grade: '高三', subject: '化学', studentCount: 1, unitPrice: 7,
      }).run();
      ids.push(Number(c.lastInsertRowid));
    }
    // 两个班各一节 1 小时，收入完全相同。
    for (const [i, id] of ids.entries()) {
      drizzleDb.insert(schedules).values({
        classId: id, date: '2026-05-07', startTime: `1${i}:00`, endTime: `1${i + 1}:00`, durationBilling: 60,
      }).run();
    }

    const res = await request(app).get('/api/schedules/summary')
      .query({ start: '2026-05-01', end: '2026-05-31' }).set(auth(token));
    const tied = res.body.byClass.filter(c => ids.includes(c.classId));
    expect(tied).toHaveLength(2);
    expect(tied[0].revenue).toBe(tied[1].revenue);
    expect(tied.map(c => c.classId), '收入打平时顺序不稳定').toEqual([...ids].sort((a, b) => a - b));
  });

  it('bySubject 的 hours 累的是课时，不是节数', async () => {
    const res = await request(app).get('/api/schedules/summary')
      .query({ start: '2026-05-01', end: '2026-05-31' }).set(auth(token));
    const physics = res.body.bySubject.find(x => x.subject === '物理');
    const math = res.body.bySubject.find(x => x.subject === '数学');
    // 物理：2 节 × 1 小时 = 2 小时（节数也是 2，所以数学那条才是关键）
    expect(physics.hours).toBe(2);
    // 数学：1 节 × 2 小时 = 2 小时。累成节数的话这里是 1。
    expect(math.hours).toBe(2);
    expect(math.count).toBe(1);
  });
});

describe('PUT /api/schedules/batch — dayShift', () => {
  async function seedDates(dates, startTime = '09:00', endTime = '10:30') {
    for (const date of dates) {
      const r = await request(app).post('/api/schedules').set(auth(token))
        .send({ classId, date, startTime, endTime });
      expect(r.status).toBe(200);
    }
  }
  const listDates = async (start, end) => {
    const res = await request(app).get(`/api/schedules?start=${start}&end=${end}`).set(auth(token));
    return res.body.map(r => r.date);
  };

  it('把周四的课统一挪到周五，排课 id 不变', async () => {
    await seedDates(['2026-05-07', '2026-05-14', '2026-05-21']); // 均为周四
    const before = await request(app).get('/api/schedules?start=2026-05-01&end=2026-05-31').set(auth(token));
    const idsBefore = before.body.map(r => r.id).sort((a, b) => a - b);

    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, weekday: 4, updates: { dayShift: 1 } });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(await listDates('2026-05-01', '2026-05-31'))
      .toEqual(['2026-05-08', '2026-05-15', '2026-05-22']);
    // 改期不是删了重建：id 必须原样保留，否则挂在这些 id 上的东西全断了
    const after = await request(app).get('/api/schedules?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(after.body.map(r => r.id).sort((a, b) => a - b)).toEqual(idsBefore);
  });

  // 整周后移是这个功能最容易写错的一种：一条
  // `UPDATE ... SET date = date(date,'+7 days')` 会在这里撞 idx_schedules_unique
  // ——第一节挪到第二节此刻占着的日期就报错，整条语句回滚，一节都没动。
  // 所以实现必须按方向逐行挪（后移先动最晚的一节）。
  it('整周后移一周不会撞唯一索引', async () => {
    await seedDates(['2026-05-07', '2026-05-14', '2026-05-21']);

    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, weekday: 4, updates: { dayShift: 7 } });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(await listDates('2026-05-01', '2026-06-30'))
      .toEqual(['2026-05-14', '2026-05-21', '2026-05-28']);
  });

  it('挪到一节不动的课头上时 409 并报出冲突日期，且一行未动', async () => {
    // 周四 09:00 要挪到周五，而周五 09:00 已经有一节课——它不在 weekday=4 的
    // 移动集合里，所以不会让开。
    await seedDates(['2026-05-07', '2026-05-08']);

    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, weekday: 4, updates: { dayShift: 1 } });

    expect(res.status).toBe(409);
    // 只说「有重复」没用：得说清是哪一天，否则调用方只能自己一节节试。
    expect(res.body.error).toContain('2026-05-08');
    expect(await listDates('2026-05-01', '2026-05-31'))
      .toEqual(['2026-05-07', '2026-05-08']);
  });

  async function addSpringSemester() {
    const { semesters } = await import('../db/schema.js');
    drizzleDb.insert(semesters).values({
      teacherId, name: '春季', type: 'spring', startDate: '2026-03-01', endDate: '2026-07-15',
    }).run();
  }

  it('位移后会跑出学期的那几节不动，并计入 semesterFiltered', async () => {
    await addSpringSemester();
    // 两节都在学期内，所以位移「之前」的那道学期过滤放行；越界是位移之后才发生的。
    await seedDates(['2026-07-13', '2026-07-15']);

    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-07-01', updates: { dayShift: 1 } });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.semesterFiltered).toBe(1);
    expect(res.body.hint).toContain('semesterOnly=false');
    // 07-13 挪到 07-14；07-15 会落到学期外的 07-16，原地不动
    expect(await listDates('2026-07-01', '2026-07-31'))
      .toEqual(['2026-07-14', '2026-07-15']);
  });

  it('semesterOnly=false 时越界也照挪', async () => {
    await addSpringSemester();
    await seedDates(['2026-07-13', '2026-07-15']);

    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: '2026-07-01', semesterOnly: false, updates: { dayShift: 1 } });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.semesterFiltered).toBeUndefined();
    expect(await listDates('2026-07-01', '2026-07-31'))
      .toEqual(['2026-07-14', '2026-07-16']);
  });

  it('dryRun 给出每节课的 from→to 但不写库', async () => {
    await seedDates(['2026-05-07', '2026-05-14']);

    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, weekday: 4, dryRun: true, updates: { dayShift: 1 } });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.dates).toEqual([
      { id: expect.any(Number), from: '2026-05-07', to: '2026-05-08' },
      { id: expect.any(Number), from: '2026-05-14', to: '2026-05-15' },
    ]);
    expect(await listDates('2026-05-01', '2026-05-31'))
      .toEqual(['2026-05-07', '2026-05-14']);
  });

  // dryRun 要是只对 dayShift 生效，带着它改时间就会真写进去——比不支持 dryRun 更糟。
  it('dryRun 对改时间同样不写库', async () => {
    await seedDates(['2026-05-07']);

    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, weekday: 4, dryRun: true, updates: { startTime: '14:00', endTime: '15:00' } });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const rows = await request(app).get('/api/schedules?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(rows.body[0].startTime).toBe('09:00');
  });

  it('挪到节假日上照挪，但把落在节假日的日期报回来', async () => {
    const { holidays } = await import('../db/schema.js');
    drizzleDb.insert(holidays).values({
      teacherId, date: '2026-05-08', type: 'holiday', name: '测试节',
    }).run();
    await seedDates(['2026-05-07', '2026-05-14']);

    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, weekday: 4, updates: { dayShift: 1 } });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    // 批量排课会主动跳节假日；位移不拦，但一声不吭把课挪到节假日上同样是静默算错。
    expect(res.body.holidayDates).toEqual(['2026-05-08']);
    expect(await listDates('2026-05-01', '2026-05-31'))
      .toEqual(['2026-05-08', '2026-05-15']);
  });

  it('位移后越出日期上限时 400，且一行未动', async () => {
    // 越界的日期写进去就再也看不见也删不掉：所有视图和查询都是按区间过滤的。
    await seedDates([DATE_MAX]);

    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: DATE_MAX, toDate: DATE_MAX, updates: { dayShift: 1 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('3000-01-01');
    expect(await listDates(DATE_MAX, DATE_MAX)).toEqual([DATE_MAX]);
  });

  it('审计日志记下位移量和源日期范围', async () => {
    const { logAudit } = await import('../services/audit.js');
    await seedDates(['2026-05-07', '2026-05-14']);
    logAudit.mockClear();

    await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, weekday: 4, updates: { dayShift: 1 } });

    // dayShift 不在 safeUpdates 里（它不是列），不专门记的话这条审计只剩
    // 「改了两行，updates 是空的」——事后既看不懂也还原不回去。
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'BATCH_UPDATE',
      tableName: 'schedules',
      after: expect.objectContaining({
        dayShift: 1,
        dateRange: { from: '2026-05-07', to: '2026-05-14' },
      }),
    }));
  });
});
