import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';
vi.mock('../services/holidays.js', () => ({ isHoliday: () => false, getHolidayName: () => '' }));

let app, drizzleDb, token, classId;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/schedules', '../routes/schedules.js'));
  const user = await makeUser(drizzleDb);
  token = user.token;
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
});
