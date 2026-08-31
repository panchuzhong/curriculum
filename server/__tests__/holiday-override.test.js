import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';
import { clearSemesterCache } from '../services/schedule-helpers.js';
import { buildDbHolidayHelpers } from '../services/image-helpers.js';
import { HOLIDAYS, WORKDAYS } from '../services/holidays-data.js';

let app, drizzleDb, token, teacherId, classId;

beforeEach(async () => {
  clearSemesterCache();
  ({ app, drizzleDb } = await setupApp('/api/schedules', '../routes/schedules.js'));
  ({ id: teacherId, token } = await makeUser(drizzleDb));
  const { classes } = await import('../db/schema.js');
  const r = drizzleDb.insert(classes).values({
    teacherId, name: '数学班', grade: '高一', subject: '数学', studentCount: 2, unitPrice: 100,
  }).run();
  classId = Number(r.lastInsertRowid);
});

// Sanity: the built-in dataset used by these assertions really contains the dates
describe('built-in holiday data sanity', () => {
  it('contains official 2026 dates but no speculative 2027 calendar', () => {
    expect(HOLIDAYS['2026']).toContain('10-01');
    expect(HOLIDAYS['2027']).toBeUndefined();
    expect(WORKDAYS['2026']).toContain('01-04');
  });
});

describe('batch create holiday precedence (per-year DB override)', () => {
  it('ignores built-in holidays for a year once the teacher has ANY holiday record in it', async () => {
    const { holidays, semesters } = await import('../db/schema.js');
    // One unrelated 2026 record is enough to make DB data authoritative for 2026
    drizzleDb.insert(holidays).values({ teacherId, date: '2026-12-25', type: 'holiday', name: '自定义' }).run();

    const weekday = new Date('2026-10-01T00:00:00').getDay(); // built-in 国庆
    const sem = drizzleDb.insert(semesters).values({
      teacherId, name: '国庆学期', type: 'fall', startDate: '2026-09-30', endDate: '2026-10-02',
    }).run();

    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({
        classId, semesterId: Number(sem.lastInsertRowid), weekday,
        startTime: '08:00', endTime: '09:00', preview: true,
      });
    // Before the fix the built-in 10-01 holiday was still skipped → 400
    expect(res.status).toBe(200);
    expect(res.body.dates).toContain('2026-10-01');
  });

  it('does not skip unpublished future dates based on guesses', async () => {
    const { semesters } = await import('../db/schema.js');
    const weekday = new Date('2027-10-01T00:00:00').getDay();
    const sem = drizzleDb.insert(semesters).values({
      teacherId, name: '国庆学期', type: 'fall', startDate: '2027-09-30', endDate: '2027-10-02',
    }).run();

    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({
        classId, semesterId: Number(sem.lastInsertRowid), weekday,
        startTime: '08:00', endTime: '09:00', preview: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.dates).toEqual(['2027-10-01']);
    // Not skipping is correct (the 2027 calendar is unpublished), but staying
    // silent is not: semester mode advertises automatic holiday skipping, so a
    // year with no data at all has to be reported.
    expect(res.body.holidayDataMissing).toEqual(['2027']);
    expect(res.body.hint).toContain('2027');
  });

  it('reports no missing-holiday-data warning for a covered year', async () => {
    const { semesters } = await import('../db/schema.js');
    const weekday = new Date('2026-10-08T00:00:00').getDay();
    const sem = drizzleDb.insert(semesters).values({
      teacherId, name: '2026秋', type: 'fall', startDate: '2026-10-08', endDate: '2026-10-09',
    }).run();

    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({
        classId, semesterId: Number(sem.lastInsertRowid), weekday,
        startTime: '08:00', endTime: '09:00', preview: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.holidayDataMissing).toBeUndefined();
    expect(res.body.hint).toBeUndefined();
  });

  it('treats a teacher-defined record as coverage for an otherwise unknown year', async () => {
    const { holidays, semesters } = await import('../db/schema.js');
    drizzleDb.insert(holidays).values({ teacherId, date: '2027-10-01', type: 'holiday', name: '国庆' }).run();
    const weekday = new Date('2027-10-01T00:00:00').getDay();
    const sem = drizzleDb.insert(semesters).values({
      teacherId, name: '国庆学期', type: 'fall', startDate: '2027-09-30', endDate: '2027-10-02',
    }).run();

    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({
        classId, semesterId: Number(sem.lastInsertRowid), weekday,
        startTime: '08:00', endTime: '09:00', preview: true,
      });
    expect(res.status).toBe(400); // 唯一候选日被自定义节假日跳过，无可排日期
    expect(res.body.holidayDataMissing).toBeUndefined();
  });

  it('still honors an explicit teacher workday overriding a built-in holiday', async () => {
    const { holidays, semesters } = await import('../db/schema.js');
    drizzleDb.insert(holidays).values({ teacherId, date: '2026-10-01', type: 'workday', name: '调休' }).run();
    const weekday = new Date('2026-10-01T00:00:00').getDay();
    const sem = drizzleDb.insert(semesters).values({
      teacherId, name: '国庆学期', type: 'fall', startDate: '2026-10-01', endDate: '2026-10-01',
    }).run();

    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({
        classId, semesterId: Number(sem.lastInsertRowid), weekday,
        startTime: '08:00', endTime: '09:00', preview: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.dates).toEqual(['2026-10-01']);
  });
});

describe('buildDbHolidayHelpers (image export) per-year semantics', () => {
  it('matches the frontend: DB data for a year suppresses built-in data for that year', () => {
    const { checkIsHoliday, checkIsWorkday } = buildDbHolidayHelpers([
      { date: '2026-12-25', type: 'holiday', name: '自定义' },
    ]);
    // 2026 built-ins suppressed (10-01 holiday, 01-04 workday)
    expect(checkIsHoliday('2026-10-01')).toBe(false);
    expect(checkIsWorkday('2026-01-04')).toBe(false);
    // DB entries still win
    expect(checkIsHoliday('2026-12-25')).toBe(true);
    // Years without DB data fall back to built-ins
    expect(checkIsHoliday('2025-01-01')).toBe(true);
    expect(checkIsWorkday('2025-01-26')).toBe(true);
  });

  it('workday entries keep overriding holidays on the same date', () => {
    const { checkIsHoliday, checkIsWorkday } = buildDbHolidayHelpers([
      { date: '2026-10-01', type: 'workday', name: '调休' },
    ]);
    expect(checkIsHoliday('2026-10-01')).toBe(false);
    expect(checkIsWorkday('2026-10-01')).toBe(true);
  });
});
