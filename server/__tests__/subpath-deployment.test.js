import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import request from 'supertest';
import { getBrowser, closeBrowser } from '../services/browser.js';

const projectDir = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), 'curriculum-subpath-'));
const originalEnv = Object.fromEntries(['BASE', 'DB_PATH', 'JWT_SECRET', 'ALLOW_REGISTRATION']
  .map(key => [key, process.env[key]]));
let app, server, origin, token;

beforeAll(async () => {
  // Build and serve a real subdirectory deployment, with BASE supplied in .env.
  // Both the database and compiled assets stay outside application data/dist.
  writeFileSync(join(tempDir, '.env'), 'BASE=/curriculum/\n');
  process.chdir(tempDir);
  delete process.env.BASE;
  process.env.DB_PATH = join(tempDir, 'data.db');
  process.env.JWT_SECRET = 'subpath-test-secret-at-least-32-characters';
  process.env.ALLOW_REGISTRATION = 'true';
  await build({
    configFile: resolve(projectDir, 'vite.config.js'),
    root: projectDir,
    envDir: tempDir,
    build: { outDir: join(tempDir, 'dist') },
    logLevel: 'silent',
  });
  // The server's dotenv loader reads the same deployment configuration.
  ({ default: app } = await import('../index.js'));
  const registration = await request(app).post('/api/auth/register')
    .send({ username: 'subpath', password: 'password123', name: 'Subpath' });
  expect(registration.status).toBe(200);
  token = registration.body.token;
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  await closeBrowser();
  if (server) await new Promise(resolve => server.close(resolve));
  if (app) (await import('../db/index.js')).db.close();
  process.chdir(projectDir);
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

it('loads BASE from .env and serves built assets below it', async () => {
  const html = readFileSync(join(tempDir, 'dist/index.html'), 'utf8');
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  expect(asset).toMatch(/^\/curriculum\/assets\//);
  const response = await request(app).get(asset);
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/javascript/);
  const redirect = await request(app).get('/curriculum');
  expect(redirect.status).toBe(301);
  expect(redirect.headers.location).toBe('/curriculum/');
  expect((await request(app).get('/curriculum/monthly')).headers['content-security-policy'])
    .toContain("script-src 'self'");
  expect((await request(app).get('/api/no-such-route')).status).toBe(404);
});

it('preserves dates across sidebar clicks, keyboard navigation, and reloads under BASE', async () => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    page.setDefaultTimeout(5000);
    await page.setViewport({ width: 1400, height: 900 });
    await page.evaluateOnNewDocument(value => localStorage.setItem('token', value), token);
    await page.goto(`${origin}/curriculum/monthly?year=2019&month=1`);
    await page.waitForSelector('nav a');
    await page.evaluate(() => [...document.querySelectorAll('nav a')]
      .find(a => a.textContent.includes('周课表')).click());
    await page.waitForFunction(() => location.search === '?date=2019-02-10');
    await page.waitForFunction(() => document.querySelector('main').textContent.includes('2019-02-04 ~ 2019-02-10'));
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => location.pathname === '/curriculum/monthly');
    expect(new URL(page.url()).searchParams.get('year')).toBe('2019');
    expect(new URL(page.url()).searchParams.get('month')).toBe('1');
    await page.reload();
    await page.waitForSelector('nav a');
    expect(await page.$eval('main', el => el.textContent)).toContain('2019');
    const urls = await page.evaluate(() => ['ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowDown'].map(key => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      return location.pathname + location.search;
    }));
    expect(urls[0]).toBe('/curriculum/yearly?year=2019');
    expect(urls[1]).toBe('/curriculum/monthly?year=2019&month=1');
    expect(urls[2]).toMatch(/^\/curriculum\/\?(date|week)=2019-02-/);
    expect(urls[3]).toBe('/curriculum/monthly?year=2019&month=1');
  } finally {
    await page.close();
  }
}, 15000);
