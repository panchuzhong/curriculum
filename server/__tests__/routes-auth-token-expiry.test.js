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

  // 只认 Bearer 这一种方案。中间件是靠 startsWith('Bearer ') 卡的，而取 token 用的是
  // 写死的 slice(7)——把那个 startsWith 换成「有没有这个头」，任何 7 个字符的前缀都会被
  // 当成方案名切掉，别的方案就跟着认了。所以前缀必须恰好 7 个字符，否则这条用例
  // 换成什么写法都是绿的（token 被切歪，verify 一样失败，看不出守卫还在不在）。
  it.each([
    ['Basic  '],   // 7 个字符：去掉它正好剩下完整的 token
    ['Token: '],
  ])('只接受 Bearer 方案，%j 前缀的合法 token 也拒', async (prefix) => {
    const name = uniqueName();
    const user = await makeUser(drizzleDb, name);
    expect(prefix.length).toBe('Bearer '.length);

    const { default: request } = await import('supertest');
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `${prefix}${user.token}`);

    expect(res.status).toBe(401);
    // 同一个 token 换成 Bearer 就该过，否则上面那个 401 可能只是 token 本身不好使
    const ok = await request(app).get('/api/auth/profile').set(auth(user.token));
    expect(ok.status).toBe(200);
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
