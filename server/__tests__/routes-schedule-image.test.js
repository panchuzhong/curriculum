import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

vi.mock('../services/image-gen.js', () => ({
  generateScheduleImage: vi.fn(async () => Buffer.from('fake-png-data')),
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
