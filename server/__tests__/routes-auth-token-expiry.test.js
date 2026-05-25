import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { setupApp, makeUser, auth } from './route-helpers.js';

let counter = 0;
function uniqueName() { return `user${++counter}`; }

describe('auth token edge cases', () => {
  let app, drizzleDb;

  beforeAll(async () => {
    ({ app, drizzleDb } = await setupApp('/api/auth', '../routes/auth.js'));
  });

  it('rejects expired JWT tokens', async () => {
    const name = uniqueName();
    const user = await makeUser(drizzleDb, name);
    const expiredToken = jwt.sign({ teacherId: user.id }, process.env.JWT_SECRET, { expiresIn: '0s' });
    await new Promise(r => setTimeout(r, 100));

    const { default: request } = await import('supertest');
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });

  it('rejects tokens signed with wrong secret', async () => {
    const name = uniqueName();
    const user = await makeUser(drizzleDb, name);
    const badToken = jwt.sign({ teacherId: user.id }, 'wrong-secret-key');

    const { default: request } = await import('supertest');
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${badToken}`);

    expect(res.status).toBe(401);
  });

  it('rejects malformed tokens', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', 'Bearer not-a-jwt');

    expect(res.status).toBe(401);
  });

  it('rejects requests with no auth header', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app).get('/api/auth/profile');

    expect(res.status).toBe(401);
  });

  it('rejects invalid API keys', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app)
      .get('/api/auth/profile')
      .set('X-API-Key', 'nonexistent-key');

    expect(res.status).toBe(401);
  });

  it('accepts valid API key', async () => {
    const name = uniqueName();
    await makeUser(drizzleDb, name);

    const { default: request } = await import('supertest');
    const res = await request(app)
      .get('/api/auth/profile')
      .set('X-API-Key', `key-${name}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe(name);
  });
});

describe('auth middleware on data routes', () => {
  let app, drizzleDb;

  beforeAll(async () => {
    ({ app, drizzleDb } = await setupApp('/api/classes', '../routes/classes.js'));
  });

  it('blocks unauthenticated class listing', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app).get('/api/classes');
    expect(res.status).toBe(401);
  });

  it('blocks unauthenticated class creation', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app)
      .post('/api/classes')
      .send({ name: 'test', grade: '高一', subject: '数学', studentCount: 1, unitPrice: 100 });
    expect(res.status).toBe(401);
  });
});
