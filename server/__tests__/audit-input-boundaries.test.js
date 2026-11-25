import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';
import { classes, schedules } from '../db/schema.js';
import { clearReportCache } from '../services/report-cache.js';

let app, drizzleDb, token, classId;
const overflow = '9'.repeat(400);
const lesson = { date: '2026-11-02', startTime: '09:00', endTime: '10:00' };

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/schedules', '../routes/schedules.js'));
  const user = await makeUser(drizzleDb);
  token = user.token;
  clearReportCache();
  for (const name of ['A', 'B']) {
    classId = Number(drizzleDb.insert(classes).values({ teacherId: user.id, name,
      grade: '高一', subject: '数学', studentCount: 2, unitPrice: 100 }).run().lastInsertRowid);
    drizzleDb.insert(schedules).values({ classId, ...lesson, durationBilling: 60,
      locationName: name, locationLat: 31, locationLng: 121 }).run();
  }
});

describe('numeric write boundaries', () => {
  it.each([true, false])('overflow class filter cannot broaden batch deletion (dryRun=%s)', async dryRun => {
    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ classId: overflow, start: lesson.date, end: lesson.date, dryRun });
    expect(res.status).toBe(400);
    expect(drizzleDb.select().from(schedules).all()).toHaveLength(2);
  });

  it.each([overflow, '9007199254740992'])('rejects unsafe billing on all write paths: %s', async durationBilling => {
    const bodies = [
      ['post', '/api/schedules', { classId, ...lesson, date: '2026-11-03', durationBilling }],
      ['put', '/api/schedules/2', { durationBilling }],
      ['post', '/api/schedules/batch', { classId, dates: ['2026-11-03'], startTime: '09:00', endTime: '10:00', durationBilling }],
      ['put', '/api/schedules/batch', { classId, fromDate: lesson.date, updates: { durationBilling } }],
    ];
    for (const [method, path, body] of bodies) {
      expect((await request(app)[method](path).set(auth(token)).send(body)).status, path).toBe(400);
    }
    expect(drizzleDb.select().from(schedules).all().map(s => s.durationBilling)).toEqual([60, 60]);
  });

  it.each(['', '&format=csv'])('reports overflow explicitly instead of null or Infinity (%s)', async format => {
    drizzleDb.update(classes).set({ unitPrice: 1e308 }).run();
    const res = await request(app).get(`/api/schedules/summary?start=${lesson.date}&end=${lesson.date}${format}`).set(auth(token));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/数值|计费|定价/);
  });
});

describe('location coordinate consistency', () => {
  it('clears coordinates when a single lesson moves, retaining explicitly supplied coordinates', async () => {
    const res = await request(app).put('/api/schedules/2').set(auth(token))
      .send({ locationName: '线上', locationLat: 32 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ locationName: '线上', locationLat: 32, locationLng: null });
  });

  it.each([0, 1])('batch change clears only coordinates belonging to a different place (dayShift=%s)', async dayShift => {
    drizzleDb.insert(schedules).values({ classId, ...lesson, date: '2026-11-03', durationBilling: 60,
      locationName: 'C', locationLat: 32, locationLng: 122 }).run();
    const res = await request(app).put('/api/schedules/batch').set(auth(token))
      .send({ classId, fromDate: lesson.date, updates: { locationName: 'B', dayShift } });
    expect(res.status).toBe(200);
    const rows = drizzleDb.select().from(schedules).all().filter(s => s.classId === classId);
    expect(rows.map(s => [s.locationName, s.locationLat, s.locationLng])).toEqual([['B', 31, 121], ['B', null, null]]);
  });
});
