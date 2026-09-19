import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';
import { logAudit } from '../services/audit.js';

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/holidays', '../routes/holidays.js'));
  ({ token } = await makeUser(drizzleDb));
  logAudit.mockClear();
});

describe('POST /api/holidays', () => {
  it('creates a holiday and returns full object', async () => {
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.date).toBe('2026-01-01');
    expect(res.body.type).toBe('holiday');
    expect(res.body.name).toBe('元旦');
  });

  it('rejects invalid date', async () => {
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: 'not-date', type: 'holiday', name: '测试' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid type', async () => {
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'vacation', name: '测试' });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate date', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'workday', name: '补班' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/holidays', () => {
  it('lists holidays', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).get('/api/holidays').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters by year', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).get('/api/holidays/2026').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('PUT /api/holidays/:id', () => {
  it('updates a holiday and returns full object', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).put(`/api/holidays/${id}`).set(auth(token)).send({ name: '新年' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.name).toBe('新年');
    expect(res.body.date).toBe('2026-01-01');
  });

  it('returns 409 when changing date to collide with existing', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-05-01', type: 'holiday', name: '劳动节' });
    const res = await request(app).put(`/api/holidays/${id}`).set(auth(token)).send({ date: '2026-01-01' });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/holidays/:id', () => {
  it('deletes a holiday', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).delete(`/api/holidays/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    const check = await request(app).get('/api/holidays').set(auth(token));
    expect(check.body.find(h => h.id === id)).toBeUndefined();
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await request(app).delete('/api/holidays/999999').set(auth(token));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/holidays/batch', () => {
  it('imports multiple holidays', async () => {
    const res = await request(app).post('/api/holidays/batch').set(auth(token))
      .send({ items: [
        { date: '2026-01-01', type: 'holiday', name: '元旦' },
        { date: '2026-05-01', type: 'holiday', name: '劳动节' },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('skips duplicates in batch', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).post('/api/holidays/batch').set(auth(token))
      .send({ items: [
        { date: '2026-01-01', type: 'holiday', name: '元旦' },
        { date: '2026-05-01', type: 'holiday', name: '劳动节' },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('rejects non-array items', async () => {
    const res = await request(app).post('/api/holidays/batch').set(auth(token))
      .send({ items: 'not-array' });
    expect(res.status).toBe(400);
  });

  it('rejects batch entries missing required fields', async () => {
    const res = await request(app).post('/api/holidays/batch').set(auth(token))
      .send({ items: [{ date: '2026-01-01' }] });
    expect(res.status).toBe(400);
  });

  it('rejects items array > 365', async () => {
    const items = Array.from({ length: 366 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, type: 'holiday', name: 'x',
    }));
    const res = await request(app).post('/api/holidays/batch').set(auth(token)).send({ items });
    expect(res.status).toBe(400);
  });

  it('returns count 0 for empty items array', async () => {
    const res = await request(app).post('/api/holidays/batch').set(auth(token)).send({ items: [] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

describe('GET /api/holidays/:year', () => {
  it('rejects a malformed year', async () => {
    const res = await request(app).get('/api/holidays/2026oops').set(auth(token));
    expect(res.status).toBe(400);
  });
});

describe('Audit log + validation gaps', () => {
  it('logs CREATE on POST /api/holidays', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE', tableName: 'holidays',
    }));
  });

  it('logs UPDATE on PUT /api/holidays/:id', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    logAudit.mockClear();
    await request(app).put(`/api/holidays/${id}`).set(auth(token)).send({ name: '新年' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', tableName: 'holidays', recordId: id,
    }));
  });

  it('logs DELETE on DELETE /api/holidays/:id', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    logAudit.mockClear();
    await request(app).delete(`/api/holidays/${id}`).set(auth(token));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE', tableName: 'holidays', recordId: id,
    }));
  });

  it('rejects empty name on PUT /api/holidays/:id', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).put(`/api/holidays/${id}`).set(auth(token)).send({ name: '' });
    expect(res.status).toBe(400);
  });
});

// 去重检查带着 teacherId。去掉它整套测试照样全绿——现有用例只用自己的行，
// 只证明了"同一天再建会拒"，没证明"别人在这天有记录不算撞上"。漏了的后果是
// 跨租户拒绝服务外加一个存在性探针：别的教师占了这天，你就永远建不出来
// （批量导入那条更隐蔽，它是静默跳过，只在 skipped 里加一）。
describe('节假日去重只看自己的记录', () => {
  async function seedOther(date) {
    const { teachers, holidays } = await import('../db/schema.js');
    const r = drizzleDb.insert(teachers).values({
      username: 'otherteacher', passwordHash: 'x', name: 'other', apiKey: 'key-othertea',
    }).run();
    drizzleDb.insert(holidays).values({
      teacherId: Number(r.lastInsertRowid), date, type: 'holiday', name: 'B的假',
    }).run();
  }

  it('别的教师在同一天有记录，本教师照样建得出来', async () => {
    await seedOther('2026-01-01');
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('元旦');
  });

  it('自己在同一天已有记录仍然被拒（对照）', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '又一个' });
    expect(res.status).toBe(409);
  });

  it('批量导入不会因为别的教师占了日期就静默跳过', async () => {
    await seedOther('2026-01-01');
    const res = await request(app).post('/api/holidays/batch').set(auth(token))
      .send({ items: [{ date: '2026-01-01', type: 'holiday', name: '元旦' }] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.skipped ?? 0).toBe(0);
  });

  it('批量导入仍会跳过自己已有的日期（对照）', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).post('/api/holidays/batch').set(auth(token))
      .send({ items: [{ date: '2026-01-01', type: 'holiday', name: '重复' }] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.skipped).toBe(1);
  });
});

// 改节假日时把自己的 date 原样带回来不能撞上自己（和定价那条同一个形状）。
describe('改节假日时不会撞上自己那一行', () => {
  it('原样带着自己的 date 改名称，成功而不是 409', async () => {
    const created = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    expect(created.status).toBe(200);

    const res = await request(app).put(`/api/holidays/${created.body.id}`).set(auth(token))
      .send({ date: '2026-01-01', name: '元旦节' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('元旦节');
  });

  it('改成另一条已占用的日期仍然 409（对照）', async () => {
    const a = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-05-01', type: 'holiday', name: '劳动节' });
    const res = await request(app).put(`/api/holidays/${a.body.id}`).set(auth(token))
      .send({ date: '2026-05-01' });
    expect(res.status).toBe(409);
  });
});

// /api/holidays/:year 的报错说的是"4位年份"，校验就得真的只认 4 位。
describe('GET /api/holidays/:year 的年份格式', () => {
  it.each(['5', '20261', '', 'abcd', '202'])('%s 被拒', async (year) => {
    const res = await request(app).get(`/api/holidays/${year || 'x'}`).set(auth(token));
    expect(res.status).toBe(400);
  });

  it('四位年份正常返回', async () => {
    const res = await request(app).get('/api/holidays/2026').set(auth(token));
    expect(res.status).toBe(200);
  });
});
