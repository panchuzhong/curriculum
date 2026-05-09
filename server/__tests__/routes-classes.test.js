import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/classes', '../routes/classes.js'));
  ({ token } = await makeUser(drizzleDb));
});

describe('POST /api/classes', () => {
  it('creates a class and returns full object', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '数学一班', grade: '高一', subject: '数学', studentCount: 5 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('数学一班');
    expect(res.body.grade).toBe('高一');
    expect(res.body.subject).toBe('数学');
    expect(res.body.studentCount).toBe(5);
    expect(res.body.isDeleted).toBe(false);
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
  it('updates a class and returns full object', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '旧名', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ name: '新名' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.name).toBe('新名');
    expect(res.body.grade).toBe('高一');
    expect(res.body.isDeleted).toBe(false);
  });

  it('rejects negative unitPrice', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ unitPrice: -10 });
    expect(res.status).toBe(400);
  });

  it('accepts unitPrice = 0 (free class) symmetrically with create', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '试听班', grade: '高一', subject: '数学', studentCount: 5, unitPrice: 0 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ unitPrice: 0 });
    expect(res.status).toBe(200);
    expect(res.body.unitPrice).toBe(0);
  });
});

describe('POST /api/classes/:classId/students validation', () => {
  it('rejects invalid phone in sub-router (consistent with /api/students)', async () => {
    const { body: { id: classId } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).post(`/api/classes/${classId}/students`).set(auth(token))
      .send({ name: '张三', phone: '123' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/classes/:id (cont.)', () => {
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

describe('GET /api/classes/:id', () => {
  it('returns a single class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '数学一班', grade: '高一', subject: '数学', studentCount: 5, unitPrice: 200 });
    const res = await request(app).get(`/api/classes/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('数学一班');
    expect(res.body.unitPrice).toBe(200);
    expect(res.body.isDeleted).toBe(false);
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await request(app).get('/api/classes/99999').set(auth(token));
    expect(res.status).toBe(404);
  });

  it('returns 404 for other teacher class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get(`/api/classes/${id}`).set(auth(token2));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/classes/locations/suggest', () => {
  it('returns distinct location names from classes', async () => {
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班A', grade: '高一', subject: '数学', studentCount: 5, defaultLocationName: '图书馆' });
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班B', grade: '高二', subject: '物理', studentCount: 3, defaultLocationName: '图书馆' });
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班C', grade: '高三', subject: '英语', studentCount: 2, defaultLocationName: '教室A' });
    const res = await request(app).get('/api/classes/locations/suggest').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['图书馆', '教室A']);
  });

  it('excludes locations from soft-deleted classes', async () => {
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班A', grade: '高一', subject: '数学', studentCount: 5, defaultLocationName: '图书馆' });
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班B', grade: '高二', subject: '物理', studentCount: 3, defaultLocationName: '教室A' });
    await request(app).delete(`/api/classes/${id}`).set(auth(token));
    const res = await request(app).get('/api/classes/locations/suggest').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['图书馆']);
  });

  it('does not include other teacher locations', async () => {
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班A', grade: '高一', subject: '数学', studentCount: 5, defaultLocationName: '图书馆' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/classes/locations/suggest').set(auth(token2));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
