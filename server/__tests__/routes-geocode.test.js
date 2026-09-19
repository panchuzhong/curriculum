import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

let app, token;

beforeEach(async () => {
  const s = await setupApp('/api/geocode', '../routes/geocode.js');
  app = s.app;
  ({ token } = await makeUser(s.drizzleDb));
  // 这个路由是唯一会打外部收费接口的地方。所有用例走的都是「到不了 fetch」的路径，
  // 把 fetch 换成一个会抛的桩：万一哪天守卫被改坏、真走到了发请求那一步，
  // 这里会当场红掉，而不是在某个人的账单上出现。
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试里不允许请求外部服务'); }));
});
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/geocode', () => {
  it('没传 address 时 400', async () => {
    const res = await request(app).get('/api/geocode').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  // 200 字是发给上游之前的闸门。放宽了就是把任意长的串原样转发出去，
  // 而这个接口是按次计费的。
  it('address 超过 200 字时 400，不发往上游', async () => {
    const res = await request(app).get('/api/geocode').query({ address: '街'.repeat(201) }).set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('address too long');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('正好 200 字是允许的（线上关键词，仍不发往上游）', async () => {
    const address = '线上' + '课'.repeat(198);
    expect(address.length).toBe(200);
    const res = await request(app).get('/api/geocode').query({ address }).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lat: null, lng: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('线上地址直接返回空坐标，不请求上游', async () => {
    const res = await request(app).get('/api/geocode').query({ address: '线上课' }).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lat: null, lng: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('未登录时 401', async () => {
    const res = await request(app).get('/api/geocode').query({ address: '线上课' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/geocode/status', () => {
  afterEach(() => { delete process.env.AMAP_KEY; });

  it('没配 key 时 available 为 false', async () => {
    delete process.env.AMAP_KEY;
    const res = await request(app).get('/api/geocode/status').set(auth(token));
    expect(res.body).toEqual({ available: false });
  });

  it('配了 key 时 available 为 true，且不外泄 key 本身', async () => {
    process.env.AMAP_KEY = 'secret-key-value';
    const res = await request(app).get('/api/geocode/status').set(auth(token));
    expect(res.body).toEqual({ available: true });
    expect(JSON.stringify(res.body)).not.toContain('secret-key-value');
  });
});
