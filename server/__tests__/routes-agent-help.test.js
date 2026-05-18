import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

let app, token;

beforeAll(async () => {
  const { setupApp, makeUser, auth } = await import('./route-helpers.js');
  const result = await setupApp('/api', '../routes/agent-help.js');
  app = result.app;
  const user = await makeUser(result.drizzleDb);
  token = user.token;
});

describe('GET /api/agent/help', () => {
  it('returns API documentation with auth', async () => {
    const res = await request(app).get('/api/agent/help').set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('课表管理系统 API');
    expect(res.body.version).toBeDefined();
    expect(res.body.endpoints).toBeDefined();
    expect(res.body.auth).toBeDefined();
  });

  it('includes endpoint list', async () => {
    const res = await request(app).get('/api/agent/help').set({ Authorization: `Bearer ${token}` });
    expect(typeof res.body.endpoints).toBe('object');
    expect(Object.keys(res.body.endpoints).length).toBeGreaterThan(0);
  });

  it('includes validation rules', async () => {
    const res = await request(app).get('/api/agent/help').set({ Authorization: `Bearer ${token}` });
    expect(res.body.validationRules).toBeDefined();
    expect(res.body.validationRules.auth).toBeDefined();
    expect(res.body.validationRules.schedules).toBeDefined();
  });

  it('includes examples', async () => {
    const res = await request(app).get('/api/agent/help').set({ Authorization: `Bearer ${token}` });
    expect(res.body.examples).toBeDefined();
    expect(Object.keys(res.body.examples).length).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/agent/help');
    expect(res.status).toBe(401);
  });
});
