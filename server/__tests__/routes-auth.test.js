import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockCommonDeps, setupApp, makeUser, auth } from './route-helpers.js';

mockCommonDeps();

let app, drizzleDb;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/auth', '../routes/auth.js'));
  process.env.ALLOW_REGISTRATION = 'true';
});

describe('POST /api/auth/register', () => {
  it('registers and returns token + apiKey', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test123', name: 'Test' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.apiKey).toBeDefined();
  });

  it('rejects duplicate username', async () => {
    await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test123', name: 'Test' });
    // Route auto-closes registration after first user, reset it to test duplicate check
    process.env.ALLOW_REGISTRATION = 'true';
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test123', name: 'Test' });
    expect(res.status).toBe(409);
  });

  it('rejects short username (<3 chars)', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'ab', password: 'test123', name: 'Test' });
    expect(res.status).toBe(400);
  });

  it('rejects short password (<6 chars)', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: '12345', name: 'Test' });
    expect(res.status).toBe(400);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test123', name: 'Test' });
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'test123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects non-existent user', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'nobody', password: 'test123' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/profile', () => {
  it('returns profile with valid token', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).get('/api/auth/profile').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('testuser');
  });

  it('rejects without token', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/auth/password', () => {
  it('changes password', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'pass123', newPassword: 'newpass123' });
    expect(res.status).toBe(200);
  });

  it('rejects wrong old password', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'wrong', newPassword: 'newpass123' });
    expect(res.status).toBe(401);
  });

  it('rejects short new password', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'pass123', newPassword: '12345' });
    expect(res.status).toBe(400);
  });
});
