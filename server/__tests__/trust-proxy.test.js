// The deployment runs behind nginx, so `trust proxy` decides whether the rate
// limiters count the real client or the single proxy connection they all share.
// Asserting app.get('trust proxy') would only pin the setting; this pins the
// behaviour that depends on it — two forwarded clients must not share a bucket.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import request from 'supertest';

// Must be set before the app import: middleware/auth.js exits the process
// without it, and chdir below puts us where dotenv finds no .env.
process.env.JWT_SECRET = 'trust-proxy-test-secret-that-is-at-least-32-chars';
const originalCwd = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'curriculum-proxy-'));
process.env.DB_PATH = resolve(tmp, 'data.db');
process.chdir(tmp);

// loginLimiter in routes/auth.js: 10 attempts per 15 minutes, per client.
const LOGIN_MAX = 10;

let app;
beforeAll(async () => {
  ({ default: app } = await import('../index.js'));
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});

describe('trust proxy', () => {
  it('rate-limits per forwarded client, not per proxy connection', async () => {
    // An unknown username short-circuits before bcrypt, so the limiter is what
    // the 11th response measures — not a slow hash.
    const attempt = (ip) => request(app).post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ username: 'no-such-user', password: 'password123' });

    for (let i = 0; i < LOGIN_MAX; i++) {
      expect((await attempt('203.0.113.1')).status).toBe(401);
    }
    // The 11th proves the limiter counted this client at all.
    expect((await attempt('203.0.113.1')).status).toBe(429);
    // And a different client is unaffected. Without `trust proxy` both are
    // ::ffff:127.0.0.1, so this one is 429 too and the test fails.
    expect((await attempt('198.51.100.7')).status).toBe(401);
  });
});
