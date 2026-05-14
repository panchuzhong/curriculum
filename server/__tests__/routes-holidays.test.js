import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';
import { logAudit } from '../services/audit.js';

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/holidays', '../routes/holidays.js'));
  ({ token } = await makeUser(drizzleDb));
  logAudit.mockClear();
});

describe('POST /api/holidays', () => {
  it('creates a holiday and returns full object', async () => {
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.date).toBe('2026-01-01');
    expect(res.body.type).toBe('holiday');
    expect(res.body.name).toBe('元旦');
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
  it('updates a holiday and returns full object', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).put(`/api/holidays/${id}`).set(auth(token)).send({ name: '新年' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.name).toBe('新年');
    expect(res.body.date).toBe('2026-01-01');
  });

  it('returns 409 when changing date to collide with existing', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-05-01', type: 'holiday', name: '劳动节' });
    const res = await request(app).put(`/api/holidays/${id}`).set(auth(token)).send({ date: '2026-01-01' });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/holidays/:id', () => {
  it('deletes a holiday', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).delete(`/api/holidays/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    const check = await request(app).get('/api/holidays').set(auth(token));
    expect(check.body.find(h => h.id === id)).toBeUndefined();
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await request(app).delete('/api/holidays/999999').set(auth(token));
    expect(res.status).toBe(404);
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

  it('rejects items array > 365', async () => {
    const items = Array.from({ length: 366 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, type: 'holiday', name: 'x',
    }));
    const res = await request(app).post('/api/holidays/batch').set(auth(token)).send({ items });
    expect(res.status).toBe(400);
  });

  it('returns count 0 for empty items array', async () => {
    const res = await request(app).post('/api/holidays/batch').set(auth(token)).send({ items: [] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

describe('Audit log + validation gaps', () => {
  it('logs CREATE on POST /api/holidays', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE', tableName: 'holidays',
    }));
  });

  it('logs UPDATE on PUT /api/holidays/:id', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    logAudit.mockClear();
    await request(app).put(`/api/holidays/${id}`).set(auth(token)).send({ name: '新年' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', tableName: 'holidays', recordId: id,
    }));
  });

  it('logs DELETE on DELETE /api/holidays/:id', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    logAudit.mockClear();
    await request(app).delete(`/api/holidays/${id}`).set(auth(token));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE', tableName: 'holidays', recordId: id,
    }));
  });

  it('rejects empty name on PUT /api/holidays/:id', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).put(`/api/holidays/${id}`).set(auth(token)).send({ name: '' });
    expect(res.status).toBe(400);
  });
});
