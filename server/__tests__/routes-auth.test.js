import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import bcrypt from 'bcryptjs';
import { setupApp, makeUser, auth } from './route-helpers.js';

let app, drizzleDb;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/auth', '../routes/auth.js'));
  process.env.ALLOW_REGISTRATION = 'true';
});

describe('POST /api/auth/register', () => {
  it.each(['x'.repeat(73), '密'.repeat(25)])('rejects passwords exceeding bcrypt’s byte limit', async password => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password, name: 'Test' });
    expect(res.status).toBe(400);
  });

  it('accepts a password at the 72-byte boundary', async () => {
    const password = '密'.repeat(24);
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password, name: 'Test' });
    expect(res.status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ username: 'testuser', password })).status).toBe(200);
  });

  it.each([
    { username: ['testuser'] },
    { password: 12345678 },
    { password: ['test1234'] },
    { name: ['Test'] },
  ])('rejects non-string registration fields: %j', async fields => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test1234', name: 'Test', ...fields });
    expect(res.status).toBe(400);
  });

  it('registers and returns token + apiKey', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test1234', name: 'Test' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.apiKey).toBeDefined();
  });

  it('rejects duplicate username', async () => {
    await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test1234', name: 'Test' });
    // Route auto-closes registration after first user, reset it to test duplicate check
    process.env.ALLOW_REGISTRATION = 'true';
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test1234', name: 'Test' });
    expect(res.status).toBe(409);
  });

  it('rejects short username (<3 chars)', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'ab', password: 'test1234', name: 'Test' });
    expect(res.status).toBe(400);
  });

  // 用户名只认字母数字。少了 isAlphanumeric 这一段，带空格、符号或同形字的用户名
  // 就能注册（'admin '、'аdmin' 这类），而报错本身还写着「3-20位字母数字」。
  // 长度那条用例拦不住它：'ab' 是长度不够被拒的，跟这一段无关。
  it.each([
    ['带空格', 'admin user'],
    ['带符号', 'admin!'],
    ['带下划线', 'admin_user'],
    ['非 ASCII', '管理员账号'],
  ])('拒绝%s的用户名，并说清规则', async (_label, username) => {
    const res = await request(app).post('/api/auth/register')
      .send({ username, password: 'test1234', name: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('用户名须为3-20位字母数字');
  });

  it('纯字母数字的用户名正常注册', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: `ok${Date.now() % 100000}`, password: 'test1234', name: 'Test' });
    expect(res.status).toBe(200);
  });

  it('rejects short password (<8 chars)', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: '12345', name: 'Test' });
    expect(res.status).toBe(400);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser' });
    expect(res.status).toBe(400);
  });

  it('rejects when registration is closed', async () => {
    process.env.ALLOW_REGISTRATION = 'false';
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'newuser', password: 'test1234', name: 'New' });
    expect(res.status).toBe(403);
  });

  // Deployment styles the README itself documents (systemd Environment=,
  // docker -e, `ALLOW_REGISTRATION=true node server/index.js`) inject the flag
  // into the process env, so the .env rewrite is inert there and every restart
  // re-opens registration. The occupied teachers table is the real invariant.
  it('stays closed after a restart-style env reset: an occupied teachers table wins over the env flag', async () => {
    await makeUser(drizzleDb, 'first');
    process.env.ALLOW_REGISTRATION = 'true';
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'second', password: 'test1234', name: 'Second' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test1234', name: 'Test' });
  });

  it.each([{ username: ['testuser'] }, { password: 12345678 }, { password: ['test1234'] }])(
    'rejects non-string login fields: %j', async fields => {
      const res = await request(app).post('/api/auth/login')
        .send({ username: 'testuser', password: 'test1234', ...fields });
      expect(res.status).toBe(400);
    }
  );

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'test1234' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects non-existent user', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'nobody', password: 'test1234' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/profile', () => {
  it('returns profile with valid token', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).get('/api/auth/profile').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('testuser');
  });

  it('rejects without token', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/auth/password', () => {
  it('rejects a new password that bcrypt would truncate', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'pass123', newPassword: '密'.repeat(25) });
    expect(res.status).toBe(400);
    expect((await request(app).get('/api/auth/profile').set(auth(token))).status).toBe(200);
  });

  it.each([{ oldPassword: ['pass123'] }, { newPassword: 12345678 }])(
    'rejects non-string password-change fields: %j', async fields => {
      const { token } = await makeUser(drizzleDb);
      const res = await request(app).put('/api/auth/password').set(auth(token))
        .send({ oldPassword: 'pass123', newPassword: 'test1234', ...fields });
      expect(res.status).toBe(400);
    }
  );

  it('allows only one concurrent password change using the same old credentials', async () => {
    const { token } = await makeUser(drizzleDb);
    const realHash = bcrypt.hash;
    let release;
    const bothHashing = new Promise(resolve => { release = resolve; });
    let hashing = 0;
    const spy = vi.spyOn(bcrypt, 'hash').mockImplementation(async (...args) => {
      if (++hashing === 2) release();
      await bothHashing;
      return realHash(...args);
    });
    try {
      const results = await Promise.all(['newpass111', 'newpass222'].map(newPassword =>
        request(app).put('/api/auth/password').set(auth(token))
          .send({ oldPassword: 'pass123', newPassword })
      ));
      expect(results.map(r => r.status).sort()).toEqual([200, 409]);
      const winner = results.find(r => r.status === 200);
      expect((await request(app).get('/api/auth/profile').set(auth(winner.body.token))).status).toBe(200);
      expect((await request(app).get('/api/auth/profile').set(auth(token))).status).toBe(401);
    } finally {
      spy.mockRestore();
    }
  });

  it('changes password', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'pass123', newPassword: 'newpass123' });
    expect(res.status).toBe(200);
    const oldLogin = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'pass123' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'newpass123' });
    expect(newLogin.status).toBe(200);
  });

  it('returns a fresh token and revokes the pre-change token', async () => {
    const { token: oldToken } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(oldToken))
      .send({ oldPassword: 'pass123', newPassword: 'newpass123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.token).not.toBe(oldToken);

    // Old token is rejected everywhere (revoked by pwd_version bump)
    const oldProfile = await request(app).get('/api/auth/profile').set(auth(oldToken));
    expect(oldProfile.status).toBe(401);

    // Fresh token keeps the session alive
    const newProfile = await request(app).get('/api/auth/profile').set(auth(res.body.token));
    expect(newProfile.status).toBe(200);
  });

  it('login after password change issues a versioned token that stays valid', async () => {
    const { token } = await makeUser(drizzleDb);
    await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'pass123', newPassword: 'newpass123' });
    const login = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'newpass123' });
    expect(login.status).toBe(200);
    const profile = await request(app).get('/api/auth/profile').set(auth(login.body.token));
    expect(profile.status).toBe(200);
  });

  it('rejects wrong old password', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'wrong', newPassword: 'newpass123' });
    expect(res.status).toBe(400);
  });

  it('rejects short new password', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'pass123', newPassword: '1234567' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/auth/subjects', () => {
  it('updates subjects', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/subjects').set(auth(token))
      .send({ subjects: ['数学', '英语'] });
    expect(res.status).toBe(200);
    expect(res.body.subjects).toEqual(['数学', '英语']);
  });

  it('rejects non-array subjects', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/subjects').set(auth(token))
      .send({ subjects: '数学' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/auth/api-key', () => {
  it('regenerates api key', async () => {
    const { token } = await makeUser(drizzleDb);
    const profile = await request(app).get('/api/auth/profile').set(auth(token));
    const oldKey = profile.body.apiKey;
    const res = await request(app).put('/api/auth/api-key').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.apiKey).toBeDefined();
    expect(res.body.apiKey).not.toBe(oldKey);
  });

  it('writes audit log on api key rotation', async () => {
    const { logAudit } = await import('../services/audit.js');
    const { token } = await makeUser(drizzleDb);
    await request(app).put('/api/auth/api-key').set(auth(token));
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', tableName: 'teachers' })
    );
  });
});

describe('PUT /api/auth/password', () => {
  it('writes audit log on password change', async () => {
    const { logAudit } = await import('../services/audit.js');
    const { token } = await makeUser(drizzleDb, 'pwtester');
    await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'pass123', newPassword: 'newpass456' });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', tableName: 'teachers' })
    );
  });
});

describe('GET /api/health', () => {
  it('returns ok without auth', async () => {
    const healthApp = express();
    healthApp.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
    const res = await request(healthApp).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('registration auto-close race', () => {
  it('two concurrent registrations admit exactly one account', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    const [a, b] = await Promise.all([
      request(app).post('/api/auth/register').send({ username: 'racer1', password: 'test1234', name: 'A' }),
      request(app).post('/api/auth/register').send({ username: 'racer2', password: 'test1234', name: 'B' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
  });
});

describe('PUT /api/auth/password with a wrong current password', () => {
  // 401 is reserved for an invalid session: the client drops the token and
  // redirects to login on every 401, so the user never saw this message.
  it('is a 400, not a 401', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'nope1234', newPassword: 'newpass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('当前密码错误');
  });
});

// GET /profile 里的 apiKey 必须是掩码。agent-help 明说「apiKey 为脱敏掩码（前4...后4），
// 完整 key 仅在 register 或 PUT /api/auth/api-key 时返回」，Settings 页也写着
// 「API Key 已隐藏」、复制按钮在拿到完整 key 之前是禁用的。真把完整 key 发出来的话，
// 页面会在一句"已隐藏"底下把它原样印出来，而没有任何测试会红。
describe('GET /api/auth/profile 的 apiKey 是掩码', () => {
  // 这个套件的 beforeEach 不建用户（注册用例要空库），所以这里自己建一个。
  let token, teacherId;
  beforeEach(async () => {
    ({ token, id: teacherId } = await makeUser(drizzleDb));
  });

  it('只露前 4 后 4，中间是省略号', async () => {
    const { teachers } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const full = 'abcd1234567890wxyz';
    drizzleDb.update(teachers).set({ apiKey: full }).where(eq(teachers.id, teacherId)).run();

    const res = await request(app).get('/api/auth/profile').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.apiKey).toBe('abcd...wxyz');
    expect(res.body.apiKey, '完整 API Key 出现在了 profile 响应里').not.toBe(full);
    expect(JSON.stringify(res.body)).not.toContain('1234567890');
  });

  it('没有 apiKey 时返回 null，而不是掩码字符串', async () => {
    const { teachers } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    drizzleDb.update(teachers).set({ apiKey: null }).where(eq(teachers.id, teacherId)).run();

    const res = await request(app).get('/api/auth/profile').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.apiKey).toBeNull();
  });

  // 对照：重新生成时才给完整 key。
  it('PUT /api/auth/api-key 返回的是完整 key', async () => {
    const res = await request(app).put('/api/auth/api-key').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.apiKey).toBeTruthy();
    expect(res.body.apiKey).not.toContain('...');
    expect(res.body.apiKey.length).toBeGreaterThan(11);
  });
});
