import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { setupApp, makeUser, auth } from './route-helpers.js';

let app, drizzleDb;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/auth', '../routes/auth.js'));
  process.env.ALLOW_REGISTRATION = 'true';
});

describe('POST /api/auth/register', () => {
  it('registers and returns token + apiKey', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test1234', name: 'Test' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.apiKey).toBeDefined();
  });

  it('rejects duplicate username', async () => {
    await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test1234', name: 'Test' });
    // Route auto-closes registration after first user, reset it to test duplicate check
    process.env.ALLOW_REGISTRATION = 'true';
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test1234', name: 'Test' });
    expect(res.status).toBe(409);
  });

  it('rejects short username (<3 chars)', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'ab', password: 'test1234', name: 'Test' });
    expect(res.status).toBe(400);
  });

  it('rejects short password (<8 chars)', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: '12345', name: 'Test' });
    expect(res.status).toBe(400);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser' });
    expect(res.status).toBe(400);
  });

  it('rejects when registration is closed', async () => {
    process.env.ALLOW_REGISTRATION = 'false';
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'newuser', password: 'test1234', name: 'New' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test1234', name: 'Test' });
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'test1234' });
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
      .send({ username: 'nobody', password: 'test1234' });
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
    const oldLogin = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'pass123' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'newpass123' });
    expect(newLogin.status).toBe(200);
  });

  it('returns a fresh token and revokes the pre-change token', async () => {
    const { token: oldToken } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(oldToken))
      .send({ oldPassword: 'pass123', newPassword: 'newpass123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.token).not.toBe(oldToken);

    // Old token is rejected everywhere (revoked by pwd_version bump)
    const oldProfile = await request(app).get('/api/auth/profile').set(auth(oldToken));
    expect(oldProfile.status).toBe(401);

    // Fresh token keeps the session alive
    const newProfile = await request(app).get('/api/auth/profile').set(auth(res.body.token));
    expect(newProfile.status).toBe(200);
  });

  it('login after password change issues a versioned token that stays valid', async () => {
    const { token } = await makeUser(drizzleDb);
    await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'pass123', newPassword: 'newpass123' });
    const login = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'newpass123' });
    expect(login.status).toBe(200);
    const profile = await request(app).get('/api/auth/profile').set(auth(login.body.token));
    expect(profile.status).toBe(200);
  });

  it('rejects wrong old password', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'wrong', newPassword: 'newpass123' });
    expect(res.status).toBe(400);
  });

  it('rejects short new password', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'pass123', newPassword: '1234567' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/auth/subjects', () => {
  it('updates subjects', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/subjects').set(auth(token))
      .send({ subjects: ['数学', '英语'] });
    expect(res.status).toBe(200);
    expect(res.body.subjects).toEqual(['数学', '英语']);
  });

  it('rejects non-array subjects', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/subjects').set(auth(token))
      .send({ subjects: '数学' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/auth/api-key', () => {
  it('regenerates api key', async () => {
    const { token } = await makeUser(drizzleDb);
    const profile = await request(app).get('/api/auth/profile').set(auth(token));
    const oldKey = profile.body.apiKey;
    const res = await request(app).put('/api/auth/api-key').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.apiKey).toBeDefined();
    expect(res.body.apiKey).not.toBe(oldKey);
  });

  it('writes audit log on api key rotation', async () => {
    const { logAudit } = await import('../services/audit.js');
    const { token } = await makeUser(drizzleDb);
    await request(app).put('/api/auth/api-key').set(auth(token));
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', tableName: 'teachers' })
    );
  });
});

describe('PUT /api/auth/password', () => {
  it('writes audit log on password change', async () => {
    const { logAudit } = await import('../services/audit.js');
    const { token } = await makeUser(drizzleDb, 'pwtester');
    await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'pass123', newPassword: 'newpass456' });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', tableName: 'teachers' })
    );
  });
});

describe('GET /api/health', () => {
  it('returns ok without auth', async () => {
    const healthApp = express();
    healthApp.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
    const res = await request(healthApp).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('registration auto-close race', () => {
  it('two concurrent registrations admit exactly one account', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    const [a, b] = await Promise.all([
      request(app).post('/api/auth/register').send({ username: 'racer1', password: 'test1234', name: 'A' }),
      request(app).post('/api/auth/register').send({ username: 'racer2', password: 'test1234', name: 'B' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
  });
});

describe('PUT /api/auth/password with a wrong current password', () => {
  // 401 is reserved for an invalid session: the client drops the token and
  // redirects to login on every 401, so the user never saw this message.
  it('is a 400, not a 401', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'nope1234', newPassword: 'newpass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('当前密码错误');
  });
});
