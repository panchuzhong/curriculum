import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/holidays', '../routes/holidays.js'));
  ({ token } = await makeUser(drizzleDb));
});

describe('POST /api/holidays', () => {
  it('creates a holiday', async () => {
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('rejects invalid date', async () => {
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: 'not-date', type: 'holiday', name: '测试' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid type', async () => {
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'vacation', name: '测试' });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate date', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'workday', name: '补班' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/holidays', () => {
  it('lists holidays', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).get('/api/holidays').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters by year', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).get('/api/holidays/2026').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('PUT /api/holidays/:id', () => {
  it('updates a holiday', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).put(`/api/holidays/${id}`).set(auth(token)).send({ name: '新年' });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/holidays/:id', () => {
  it('deletes a holiday', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).delete(`/api/holidays/${id}`).set(auth(token));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/holidays/batch', () => {
  it('imports multiple holidays', async () => {
    const res = await request(app).post('/api/holidays/batch').set(auth(token))
      .send({ items: [
        { date: '2026-01-01', type: 'holiday', name: '元旦' },
        { date: '2026-05-01', type: 'holiday', name: '劳动节' },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('skips duplicates in batch', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).post('/api/holidays/batch').set(auth(token))
      .send({ items: [
        { date: '2026-01-01', type: 'holiday', name: '元旦' },
        { date: '2026-05-01', type: 'holiday', name: '劳动节' },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('rejects non-array items', async () => {
    const res = await request(app).post('/api/holidays/batch').set(auth(token))
      .send({ items: 'not-array' });
    expect(res.status).toBe(400);
  });
});
