import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/semesters', '../routes/semesters.js'));
  ({ token } = await makeUser(drizzleDb));
});

describe('POST /api/semesters', () => {
  it('creates a semester and returns full object', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026春季', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('2026春季');
    expect(res.body.type).toBe('spring');
    expect(res.body.startDate).toBe('2026-02-01');
    expect(res.body.endDate).toBe('2026-06-30');
  });

  it('rejects invalid type', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: '秋季班', startDate: '2026-02-01', endDate: '2026-06-30' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid date format', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: 'spring', startDate: 'not-date', endDate: '2026-06-30' });
    expect(res.status).toBe(400);
  });

  it('rejects empty name', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    expect(res.status).toBe(400);
  });

  it('rejects endDate < startDate', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '反向', type: 'spring', startDate: '2026-06-30', endDate: '2026-02-01' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/semesters', () => {
  it('lists semesters', async () => {
    await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026春季', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const res = await request(app).get('/api/semesters').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('PUT /api/semesters/:id', () => {
  it('updates a semester and returns full object', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026春季', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const res = await request(app).put(`/api/semesters/${id}`).set(auth(token))
      .send({ name: '2026春季学期' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.name).toBe('2026春季学期');
    expect(res.body.startDate).toBe('2026-02-01');
  });

  it('returns 404 for other teacher semester', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/semesters/${id}`).set(auth(token2)).send({ name: 'hack' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/semesters/:id', () => {
  it('deletes a semester', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const res = await request(app).delete(`/api/semesters/${id}`).set(auth(token));
    expect(res.status).toBe(200);
  });
});

describe('Data isolation', () => {
  it('does not show other teacher semesters', async () => {
    await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '我的学期', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/semesters').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });
});

describe('Audit logging', () => {
  it('logs CREATE on semester creation', async () => {
    const { logAudit } = await import('../services/audit.js');
    await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '审计学期', type: 'fall', startDate: '2026-09-01', endDate: '2026-12-31' });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', tableName: 'semesters' })
    );
  });

  it('logs DELETE on semester deletion', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '待删学期', type: 'summer', startDate: '2026-07-01', endDate: '2026-08-31' });
    const { logAudit } = await import('../services/audit.js');
    await request(app).delete(`/api/semesters/${id}`).set(auth(token));
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', tableName: 'semesters' })
    );
  });
});
