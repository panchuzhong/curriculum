import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/students', '../routes/students.js'));
  ({ token } = await makeUser(drizzleDb));
});

describe('POST /api/students', () => {
  it('creates a student', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', phone: '13800138000' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('rejects empty name', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ phone: '13800138000' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid phone', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', phone: '123' });
    expect(res.status).toBe(400);
  });

  it('allows empty optional fields', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', phone: '', parentPhone: '', birthDate: '' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('rejects invalid birthDate', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', birthDate: 'not-a-date' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/students', () => {
  it('lists students with classIds', async () => {
    await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    const res = await request(app).get('/api/students').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].classIds).toBeDefined();
  });
});

describe('PUT /api/students/:id', () => {
  it('updates a student', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    const res = await request(app).put(`/api/students/${id}`).set(auth(token)).send({ name: '李四' });
    expect(res.status).toBe(200);
  });

  it('returns 404 for other teacher student', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/students/${id}`).set(auth(token2)).send({ name: 'hack' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/students/:id', () => {
  it('deletes student', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    const res = await request(app).delete(`/api/students/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/students').set(auth(token));
    expect(list.body).toHaveLength(0);
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await request(app).delete('/api/students/999999').set(auth(token));
    expect(res.status).toBe(404);
  });
});

describe('Data isolation', () => {
  it('does not show other teacher students', async () => {
    await request(app).post('/api/students').set(auth(token)).send({ name: '我的学生' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/students').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });
});
