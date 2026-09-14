// Integration tests against the REAL server/index.js app (all middleware and
// route mounting included), unlike route-helpers.js which mounts one router at
// a time. Runs in a temp cwd so DB files and restore snapshots stay isolated.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import request from 'supertest';

process.env.JWT_SECRET = 'integration-test-secret-that-is-at-least-32-chars';
// Must be set before the app import (dotenv does not override existing vars)
process.env.ALLOW_REGISTRATION = 'true';
const originalCwd = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'curriculum-app-'));
process.env.DB_PATH = resolve(tmp, 'data.db');
process.chdir(tmp);

let app;
let token;
beforeAll(async () => {
  ({ default: app } = await import('../index.js'));
  const reg = await request(app).post('/api/auth/register')
    .send({ username: 'tester', password: 'password123', name: 'Tester' });
  token = reg.body.token;
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});

describe('real app integration', () => {
  it('accepts a >1MB backup restore payload (route limit 50MB beats global 1MB)', async () => {
    const backup = {
      version: 1,
      classes: [],
      students: [],
      schedules: [],
      classStudents: [],
      holidays: [],
      semesters: [],
      pricingTiers: [],
      classPricing: [],
      auditLog: [],
      padding: 'x'.repeat(1200 * 1024), // >1MB, unknown fields are ignored
    };
    const res = await request(app).post('/api/backup/restore')
      .set(authHeader(token))
      .send(backup);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('still rejects >1MB JSON on ordinary endpoints (global 1MB limit intact)', async () => {
    const res = await request(app).post('/api/classes')
      .set(authHeader(token))
      .send({ name: 'x'.repeat(1100 * 1024) });
    expect(res.status).toBe(413);
  });

  // Strict routing is off, so the trailing-slash spelling reaches the route;
  // the 50MB exemption used to compare exact paths only and this got a 413.
  it('honors the 50MB restore exemption with a trailing slash', async () => {
    const res = await request(app).post('/api/backup/restore/')
      .set(authHeader(token))
      .send({ version: 1, padding: 'x'.repeat(1100 * 1024) });
    expect(res.status).not.toBe(413);
  });

  it('returns JSON 404 for unknown API paths (never the SPA fallback)', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('health check stays public', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('does not parse a restore body before authentication', async () => {
    // Malformed JSON would be a 400 if the 50MB parser ran ahead of auth.
    const res = await request(app).post('/api/backup/restore')
      .set('Content-Type', 'application/json').send('{not json');
    expect(res.status).toBe(401);
  });

  it('registering does not write ALLOW_REGISTRATION into a .env file under test', () => {
    expect(existsSync(join(tmp, '.env'))).toBe(false);
  });

  it('a PUT with no body is a 400, not a 500 (Express 5 leaves req.body undefined)', async () => {
    const created = await request(app).post('/api/semesters').set(authHeader(token))
      .send({ name: '2026春季', type: 'spring', startDate: '2026-02-23', endDate: '2026-07-05' });
    expect(created.status).toBe(200);
    const res = await request(app).put(`/api/semesters/${created.body.id}`).set(authHeader(token));
    expect(res.status).toBe(400);
  });
});

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}
