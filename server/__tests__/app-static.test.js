// Verifies the production static branch of the real app: CSP header on SPA
// responses and JSON 404 for unknown /api paths. Needs ./dist to exist
// (skipped otherwise, e.g. CI running unit tests without a build).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import request from 'supertest';

process.env.JWT_SECRET = 'static-test-secret-that-is-at-least-32-chars';
const tmp = mkdtempSync(join(tmpdir(), 'curriculum-static-'));
process.env.DB_PATH = resolve(tmp, 'data.db');

let app;
beforeAll(async () => {
  ({ default: app } = await import('../index.js'));
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const hasDist = existsSync('./dist');
const maybe = hasDist ? it : it.skip;

describe('real app static branch', () => {
  maybe('serves the SPA with a Content-Security-Policy header', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('unknown /api paths return JSON 404 even with the SPA fallback mounted', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
