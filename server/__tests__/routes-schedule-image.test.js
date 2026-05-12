import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

vi.mock('../services/image-gen.js', () => ({
  generateScheduleImage: vi.fn(async () => Buffer.from('fake-png-data')),
}));
vi.mock('../services/image-gen-monthly.js', () => ({
  generateMonthlyImage: vi.fn(async () => Buffer.from('fake-monthly-png')),
}));
vi.mock('../services/image-gen-yearly.js', () => ({
  generateYearlyImage: vi.fn(async () => Buffer.from('fake-yearly-png')),
}));

let app, drizzleDb, token, teacherId;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/schedule-image', '../routes/schedule-image.js'));
  ({ id: teacherId, token } = await makeUser(drizzleDb));
});

describe('GET /api/schedule-image', () => {
  it('rejects missing start/end', async () => {
    const res = await request(app).get('/api/schedule-image').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('start/end or range');
  });

  it('returns 404 when no classes exist', async () => {
    const res = await request(app).get('/api/schedule-image?start=2026-05-01&end=2026-05-07').set(auth(token));
    expect(res.status).toBe(404);
  });

  it('generates PNG image', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '数学班', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();

    const res = await request(app).get('/api/schedule-image?start=2026-05-01&end=2026-05-07').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('supports range=week parameter', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '数学班', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();

    const res = await request(app).get('/api/schedule-image?range=week').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/schedule-image?start=2026-05-01&end=2026-05-07');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/schedule-image/monthly', () => {
  it('rejects missing year/month', async () => {
    const res = await request(app).get('/api/schedule-image/monthly').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('year and month');
  });

  it('rejects out-of-range month', async () => {
    const res = await request(app).get('/api/schedule-image/monthly?year=2026&month=12').set(auth(token));
    expect(res.status).toBe(400);
    const res2 = await request(app).get('/api/schedule-image/monthly?year=2026&month=-1').set(auth(token));
    expect(res2.status).toBe(400);
  });

  it('returns 404 when no classes exist', async () => {
    const res = await request(app).get('/api/schedule-image/monthly?year=2026&month=5').set(auth(token));
    expect(res.status).toBe(404);
  });

  it('generates monthly PNG image', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '数学班', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();

    const res = await request(app).get('/api/schedule-image/monthly?year=2026&month=5').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/schedule-image/monthly?year=2026&month=5');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/schedule-image/yearly', () => {
  it('rejects missing year', async () => {
    const res = await request(app).get('/api/schedule-image/yearly').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('year required');
  });

  it('returns 404 when no classes exist', async () => {
    const res = await request(app).get('/api/schedule-image/yearly?year=2026').set(auth(token));
    expect(res.status).toBe(404);
  });

  it('generates yearly PNG image', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '数学班', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();

    const res = await request(app).get('/api/schedule-image/yearly?year=2026').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/schedule-image/yearly?year=2026');
    expect(res.status).toBe(401);
  });
});
