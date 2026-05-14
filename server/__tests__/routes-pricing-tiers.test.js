import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/pricing-tiers', '../routes/pricing-tiers.js'));
  ({ token } = await makeUser(drizzleDb));
});

describe('POST /api/pricing-tiers', () => {
  it('creates a tier and returns full object', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.minStudents).toBe(1);
    expect(res.body.maxStudents).toBe(3);
    expect(res.body.pricePerStudentPerHour).toBe(120);
  });

  it('rejects minStudents < 1', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 0, maxStudents: 3, pricePerStudentPerHour: 120 });
    expect(res.status).toBe(400);
  });

  it('rejects pricePerStudentPerHour <= 0', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 0 });
    expect(res.status).toBe(400);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1 });
    expect(res.status).toBe(400);
  });

  it('rejects max < min', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 5, maxStudents: 3, pricePerStudentPerHour: 100 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/pricing-tiers', () => {
  it('lists tiers', async () => {
    await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const res = await request(app).get('/api/pricing-tiers').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('PUT /api/pricing-tiers/:id', () => {
  it('updates a tier and returns full object', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const res = await request(app).put(`/api/pricing-tiers/${id}`).set(auth(token))
      .send({ pricePerStudentPerHour: 150 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.pricePerStudentPerHour).toBe(150);
    expect(res.body.minStudents).toBe(1);
  });

  it('rejects update when max < min', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 3, maxStudents: 10, pricePerStudentPerHour: 100 });
    const res = await request(app).put(`/api/pricing-tiers/${id}`).set(auth(token))
      .send({ maxStudents: 1 });
    expect(res.status).toBe(400);
  });

  it('allows max === min on update', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 3, maxStudents: 10, pricePerStudentPerHour: 100 });
    const res = await request(app).put(`/api/pricing-tiers/${id}`).set(auth(token))
      .send({ maxStudents: 3 });
    expect(res.status).toBe(200);
    expect(res.body.maxStudents).toBe(3);
  });
});

describe('DELETE /api/pricing-tiers/:id', () => {
  it('deletes a tier', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const res = await request(app).delete(`/api/pricing-tiers/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    const check = await request(app).get('/api/pricing-tiers').set(auth(token));
    expect(check.body.find(t => t.id === id)).toBeUndefined();
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await request(app).delete('/api/pricing-tiers/999999').set(auth(token));
    expect(res.status).toBe(404);
  });
});

describe('Data isolation', () => {
  it('does not show other teacher tiers', async () => {
    await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/pricing-tiers').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });
});

describe('Audit logging', () => {
  it('logs CREATE on tier creation', async () => {
    const { logAudit } = await import('../services/audit.js');
    await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 5, pricePerStudentPerHour: 150 });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', tableName: 'pricing_tiers' })
    );
  });

  it('logs DELETE on tier deletion', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 6, maxStudents: 10, pricePerStudentPerHour: 200 });
    const { logAudit } = await import('../services/audit.js');
    await request(app).delete(`/api/pricing-tiers/${id}`).set(auth(token));
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', tableName: 'pricing_tiers' })
    );
  });

  it('logs UPDATE on tier update', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 5, pricePerStudentPerHour: 100 });
    const { logAudit } = await import('../services/audit.js');
    logAudit.mockClear();
    await request(app).put(`/api/pricing-tiers/${id}`).set(auth(token))
      .send({ pricePerStudentPerHour: 120 });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', tableName: 'pricing_tiers', recordId: id })
    );
  });
});
