import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

let app;

beforeAll(async () => {
  const routes = (await import('../routes/agent-help.js')).default;
  app = express();
  app.use('/api', routes);
});

describe('GET /api/agent/help', () => {
  it('returns API documentation', async () => {
    const res = await request(app).get('/api/agent/help');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('课表管理系统 API');
    expect(res.body.version).toBeDefined();
    expect(res.body.endpoints).toBeDefined();
    expect(res.body.auth).toBeDefined();
  });

  it('includes endpoint list', async () => {
    const res = await request(app).get('/api/agent/help');
    expect(typeof res.body.endpoints).toBe('object');
    expect(Object.keys(res.body.endpoints).length).toBeGreaterThan(0);
  });

  it('includes validation rules', async () => {
    const res = await request(app).get('/api/agent/help');
    expect(res.body.validationRules).toBeDefined();
    expect(res.body.validationRules.auth).toBeDefined();
    expect(res.body.validationRules.schedules).toBeDefined();
  });

  it('includes examples', async () => {
    const res = await request(app).get('/api/agent/help');
    expect(res.body.examples).toBeDefined();
    expect(Object.keys(res.body.examples).length).toBeGreaterThan(0);
  });

  it('is accessible without auth', async () => {
    const res = await request(app).get('/api/agent/help');
    expect(res.status).toBe(200);
  });
});
