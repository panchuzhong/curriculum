import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockCommonDeps, setupApp, makeUser, auth } from './route-helpers.js';

mockCommonDeps();

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/classes', '../routes/classes.js'));
  ({ token } = await makeUser(drizzleDb));
});

describe('POST /api/classes', () => {
  it('creates a class', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '数学一班', grade: '高一', subject: '数学', studentCount: 5 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('rejects invalid grade', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '三年级', subject: '数学', studentCount: 5 });
    expect(res.status).toBe(400);
  });

  it('rejects empty name', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ grade: '高一', subject: '数学', studentCount: 5 });
    expect(res.status).toBe(400);
  });

  it('rejects studentCount < 1', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 0 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/classes', () => {
  it('lists classes for teacher', async () => {
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '数学一班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).get('/api/classes').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('数学一班');
  });

  it('excludes soft-deleted classes', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '待删班', grade: '高一', subject: '数学', studentCount: 5 });
    await request(app).delete(`/api/classes/${id}`).set(auth(token));
    const res = await request(app).get('/api/classes').set(auth(token));
    expect(res.body).toHaveLength(0);
  });
});

describe('PUT /api/classes/:id', () => {
  it('updates a class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '旧名', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ name: '新名' });
    expect(res.status).toBe(200);
  });

  it('rejects negative unitPrice', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ unitPrice: -10 });
    expect(res.status).toBe(400);
  });

  it('returns 404 for other teacher class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token2))
      .send({ name: 'hack' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/classes/:id', () => {
  it('soft deletes a class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).delete(`/api/classes/${id}`).set(auth(token));
    expect(res.status).toBe(200);
  });

  it('returns 404 for other teacher class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).delete(`/api/classes/${id}`).set(auth(token2));
    expect(res.status).toBe(404);
  });
});

describe('Data isolation', () => {
  it('does not show other teacher classes', async () => {
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '我的班', grade: '高一', subject: '数学', studentCount: 5 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/classes').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });
});
