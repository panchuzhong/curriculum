import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';
import { logAudit } from '../services/audit.js';

let app, drizzleDb, token, classId;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/classes', '../routes/classes.js'));
  ({ token } = await makeUser(drizzleDb));
  // Create a class (which also creates initial class_pricing via API)
  const { body } = await request(app).post('/api/classes').set(auth(token))
    .send({ name: '定价测试班', grade: '高一', subject: '数学', studentCount: 5, unitPrice: 200 });
  classId = body.id;
  logAudit.mockClear();
});

describe('GET /api/classes/:classId/pricing', () => {
  it('returns pricing history with initial record from class creation', async () => {
    const res = await request(app).get(`/api/classes/${classId}/pricing`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].studentCount).toBe(5);
    expect(res.body[0].unitPrice).toBe(200);
    expect(res.body[0].discountAmount).toBe(0);
    expect(res.body[0].effectiveFrom).toBeDefined();
  });

  it('returns 404 for non-existent class', async () => {
    const res = await request(app).get('/api/classes/99999/pricing').set(auth(token));
    expect(res.status).toBe(404);
  });

  it('returns 404 for other teacher class', async () => {
    const { token: t2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get(`/api/classes/${classId}/pricing`).set(auth(t2));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/classes/:classId/pricing', () => {
  it('adds a new pricing version and syncs class table', async () => {
    const res = await request(app).post(`/api/classes/${classId}/pricing`).set(auth(token))
      .send({ studentCount: 3, unitPrice: 250, effectiveFrom: '2026-06-01' });
    expect(res.status).toBe(200);
    expect(res.body.studentCount).toBe(3);
    expect(res.body.unitPrice).toBe(250);
    expect(res.body.effectiveFrom).toBe('2026-06-01');
    expect(res.body.id).toBeDefined();

    // Verify class table updated
    const { body: cls } = await request(app).get(`/api/classes/${classId}`).set(auth(token));
    expect(cls.studentCount).toBe(3);
    expect(cls.unitPrice).toBe(250);
  });

  it('returns 409 for duplicate effectiveFrom', async () => {
    await request(app).post(`/api/classes/${classId}/pricing`).set(auth(token))
      .send({ studentCount: 3, unitPrice: 250, effectiveFrom: '2026-06-01' });
    const res = await request(app).post(`/api/classes/${classId}/pricing`).set(auth(token))
      .send({ studentCount: 4, unitPrice: 300, effectiveFrom: '2026-06-01' });
    expect(res.status).toBe(409);
  });

  it('validates required fields', async () => {
    const res = await request(app).post(`/api/classes/${classId}/pricing`).set(auth(token))
      .send({ effectiveFrom: '2026-06-01' }); // missing studentCount, unitPrice
    expect(res.status).toBe(400);
  });

  it('rejects invalid effectiveFrom format', async () => {
    const res = await request(app).post(`/api/classes/${classId}/pricing`).set(auth(token))
      .send({ studentCount: 3, unitPrice: 250, effectiveFrom: 'not-a-date' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/classes/:classId/pricing/:pricingId', () => {
  it('updates a pricing record', async () => {
    const { body: pricing } = await request(app).get(`/api/classes/${classId}/pricing`).set(auth(token));
    const pid = pricing[0].id;

    const res = await request(app).put(`/api/classes/${classId}/pricing/${pid}`).set(auth(token))
      .send({ studentCount: 10, unitPrice: 180 });
    expect(res.status).toBe(200);
    expect(res.body.studentCount).toBe(10);
    expect(res.body.unitPrice).toBe(180);

    // Verify class table synced
    const { body: cls } = await request(app).get(`/api/classes/${classId}`).set(auth(token));
    expect(cls.studentCount).toBe(10);
  });

  it('returns 404 for non-existent pricing record', async () => {
    const res = await request(app).put(`/api/classes/${classId}/pricing/99999`).set(auth(token))
      .send({ studentCount: 10 });
    expect(res.status).toBe(404);
  });

  it('returns 409 if effectiveFrom changed to a duplicate', async () => {
    // Create a second pricing version first
    await request(app).post(`/api/classes/${classId}/pricing`).set(auth(token))
      .send({ studentCount: 3, unitPrice: 250, effectiveFrom: '2026-06-01' });
    const { body: all } = await request(app).get(`/api/classes/${classId}/pricing`).set(auth(token));
    const firstId = all[1].id; // the initial record (earlier effectiveFrom)

    // Try to change the initial record's effectiveFrom to match the second
    const res = await request(app).put(`/api/classes/${classId}/pricing/${firstId}`).set(auth(token))
      .send({ effectiveFrom: '2026-06-01' });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/classes/:classId/pricing/:pricingId', () => {
  it('deletes a pricing record and syncs class table', async () => {
    // Create second pricing first
    await request(app).post(`/api/classes/${classId}/pricing`).set(auth(token))
      .send({ studentCount: 3, unitPrice: 250, effectiveFrom: '2026-06-01' });
    const { body: all } = await request(app).get(`/api/classes/${classId}/pricing`).set(auth(token));
    const firstId = all[1].id; // earlier (initial) record

    const res = await request(app).delete(`/api/classes/${classId}/pricing/${firstId}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify only one record remains
    const { body: remaining } = await request(app).get(`/api/classes/${classId}/pricing`).set(auth(token));
    expect(remaining).toHaveLength(1);
  });

  it('returns 400 when deleting the last record', async () => {
    const { body: all } = await request(app).get(`/api/classes/${classId}/pricing`).set(auth(token));
    const res = await request(app).delete(`/api/classes/${classId}/pricing/${all[0].id}`).set(auth(token));
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent pricing record', async () => {
    const res = await request(app).delete(`/api/classes/${classId}/pricing/99999`).set(auth(token));
    expect(res.status).toBe(404);
  });
});

describe('Revenue uses class_pricing by date', () => {
  it('uses correct pricing version for schedule date', async () => {
    // Create a schedule app with classes route too
    const { app: schedApp, drizzleDb: schedDb } = await setupApp('/api/schedules', '../routes/schedules.js');
    const { token: schedToken } = await makeUser(schedDb, 'summarytest');
    const { classes: schemaClasses, classPricing } = await import('../db/schema.js');

    // Create class with initial pricing directly in DB (same as what API does)
    const cRes = schedDb.insert(schemaClasses).values({
      teacherId: 1, name: '汇总班', grade: '高一', subject: '数学', studentCount: 5, unitPrice: 200,
    }).run();
    const testClassId = Number(cRes.lastInsertRowid);
    // Initial pricing: effectiveFrom = '2026-01-01'
    schedDb.insert(classPricing).values({
      classId: testClassId, studentCount: 5, unitPrice: 200, discountAmount: 0, effectiveFrom: '2026-01-01',
    }).run();
    // Second pricing: effectiveFrom = '2026-06-15'
    schedDb.insert(classPricing).values({
      classId: testClassId, studentCount: 3, unitPrice: 300, discountAmount: 0, effectiveFrom: '2026-06-15',
    }).run();

    // Schedule before pricing change → uses first pricing
    await request(schedApp).post('/api/schedules').set(auth(schedToken))
      .send({ classId: testClassId, date: '2026-06-01', startTime: '09:00', endTime: '10:30' }); // 90 min
    // Schedule after pricing change → uses second pricing
    await request(schedApp).post('/api/schedules').set(auth(schedToken))
      .send({ classId: testClassId, date: '2026-06-20', startTime: '09:00', endTime: '11:00' }); // 120 min

    const sumRes = await request(schedApp).get('/api/schedules/summary?start=2026-06-01&end=2026-06-30').set(auth(schedToken));
    expect(sumRes.status).toBe(200);
    // Revenue: (200*5)*(90/60) + (300*3)*(120/60) = 1500 + 1800 = 3300
    expect(sumRes.body.revenue).toBe(3300);
  });
});

describe('Cross-teacher authorization', () => {
  it('POST returns 404 for other teacher class', async () => {
    const { token: t2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).post(`/api/classes/${classId}/pricing`).set(auth(t2))
      .send({ studentCount: 3, unitPrice: 250, effectiveFrom: '2026-06-01' });
    expect(res.status).toBe(404);
  });

  it('PUT returns 404 for other teacher class', async () => {
    const { body: pricing } = await request(app).get(`/api/classes/${classId}/pricing`).set(auth(token));
    const { token: t2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/classes/${classId}/pricing/${pricing[0].id}`).set(auth(t2))
      .send({ studentCount: 10 });
    expect(res.status).toBe(404);
  });

  it('DELETE returns 404 for other teacher class', async () => {
    await request(app).post(`/api/classes/${classId}/pricing`).set(auth(token))
      .send({ studentCount: 3, unitPrice: 250, effectiveFrom: '2026-06-01' });
    const { body: all } = await request(app).get(`/api/classes/${classId}/pricing`).set(auth(token));
    const { token: t2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).delete(`/api/classes/${classId}/pricing/${all[0].id}`).set(auth(t2));
    expect(res.status).toBe(404);
  });
});
