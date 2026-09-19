import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/pricing-tiers', '../routes/pricing-tiers.js'));
  ({ token } = await makeUser(drizzleDb));
});

describe('POST /api/pricing-tiers', () => {
  it.each(['1e309', [100]])('rejects non-finite or composite prices on create and update (%j)', async value => {
    const fields = { minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 100 };
    const invalid = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ ...fields, pricePerStudentPerHour: value });
    expect(invalid.status).toBe(400);
    const created = await request(app).post('/api/pricing-tiers').set(auth(token)).send(fields);
    expect(created.status).toBe(200);
    const updated = await request(app).put(`/api/pricing-tiers/${created.body.id}`).set(auth(token))
      .send({ pricePerStudentPerHour: value });
    expect(updated.status).toBe(400);
    const stored = await request(app).get('/api/pricing-tiers').set(auth(token));
    expect(stored.body[0].pricePerStudentPerHour).toBe(100);
  });

  it('creates a tier and returns full object', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.minStudents).toBe(1);
    expect(res.body.maxStudents).toBe(3);
    expect(res.body.pricePerStudentPerHour).toBe(120);
  });

  it('rejects minStudents < 1', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 0, maxStudents: 3, pricePerStudentPerHour: 120 });
    expect(res.status).toBe(400);
  });

  it('rejects pricePerStudentPerHour <= 0', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 0 });
    expect(res.status).toBe(400);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1 });
    expect(res.status).toBe(400);
  });

  it('rejects max < min', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 5, maxStudents: 3, pricePerStudentPerHour: 100 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/pricing-tiers', () => {
  it('lists tiers', async () => {
    await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const res = await request(app).get('/api/pricing-tiers').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('PUT /api/pricing-tiers/:id', () => {
  it('updates a tier and returns full object', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const res = await request(app).put(`/api/pricing-tiers/${id}`).set(auth(token))
      .send({ pricePerStudentPerHour: 150 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.pricePerStudentPerHour).toBe(150);
    expect(res.body.minStudents).toBe(1);
  });

  it('rejects update when max < min', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 3, maxStudents: 10, pricePerStudentPerHour: 100 });
    const res = await request(app).put(`/api/pricing-tiers/${id}`).set(auth(token))
      .send({ maxStudents: 1 });
    expect(res.status).toBe(400);
  });

  it('allows max === min on update', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 3, maxStudents: 10, pricePerStudentPerHour: 100 });
    const res = await request(app).put(`/api/pricing-tiers/${id}`).set(auth(token))
      .send({ maxStudents: 3 });
    expect(res.status).toBe(200);
    expect(res.body.maxStudents).toBe(3);
  });
});

describe('DELETE /api/pricing-tiers/:id', () => {
  it('deletes a tier', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const res = await request(app).delete(`/api/pricing-tiers/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    const check = await request(app).get('/api/pricing-tiers').set(auth(token));
    expect(check.body.find(t => t.id === id)).toBeUndefined();
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await request(app).delete('/api/pricing-tiers/999999').set(auth(token));
    expect(res.status).toBe(404);
  });
});

describe('Data isolation', () => {
  it('does not show other teacher tiers', async () => {
    await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/pricing-tiers').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });
});

describe('Audit logging', () => {
  it('logs CREATE on tier creation', async () => {
    const { logAudit } = await import('../services/audit.js');
    await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 5, pricePerStudentPerHour: 150 });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', tableName: 'pricing_tiers' })
    );
  });

  it('logs DELETE on tier deletion', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 6, maxStudents: 10, pricePerStudentPerHour: 200 });
    const { logAudit } = await import('../services/audit.js');
    await request(app).delete(`/api/pricing-tiers/${id}`).set(auth(token));
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', tableName: 'pricing_tiers' })
    );
  });

  it('logs UPDATE on tier update', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 5, pricePerStudentPerHour: 100 });
    const { logAudit } = await import('../services/audit.js');
    logAudit.mockClear();
    await request(app).put(`/api/pricing-tiers/${id}`).set(auth(token))
      .send({ pricePerStudentPerHour: 120 });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', tableName: 'pricing_tiers', recordId: id })
    );
  });
});

describe('numeric strings for tier bounds', () => {
  it('PUT compares min/max numerically, not lexicographically', async () => {
    const created = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const res = await request(app).put(`/api/pricing-tiers/${created.body.id}`).set(auth(token))
      .send({ minStudents: '9', maxStudents: '10' });
    expect(res.status).toBe(200);
    expect(res.body.minStudents).toBe(9);
    expect(res.body.maxStudents).toBe(10);
  });
});

// 阶梯区间是闭区间：[1,5] 和 [5,10] 都覆盖 5 人，算重叠。重叠检测此前一条用例都没有
// （没有任何用例造过重叠阶梯），而它拦的是一个会让价格变得不确定的状态：
// getDefaultPrice 用的是 find，两条都能匹配某个人数时，收哪个价全看行序。
// 把那两处 409 处理整个删掉，整套服务端用例也全绿——错误会掉到兜底处理器，
// 用户拿到的是一句「Internal server error」，看不出是区间撞了。
describe('定价阶梯的区间重叠', () => {
  async function make(min, max, price = 100) {
    return request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: min, maxStudents: max, pricePerStudentPerHour: price });
  }

  it.each([
    ['完全相同', 3, 5],
    ['被包含', 4, 4],
    ['左边搭上边界', 1, 3],
    ['右边搭上边界', 5, 9],
    ['完全覆盖', 1, 99],
  ])('%s 的新阶梯被拒，并说清是区间撞了', async (_label, min, max) => {
    expect((await make(3, 5)).status).toBe(200);

    const res = await make(min, max);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('已存在人数区间重叠的定价阶梯');
  });

  // 对照：首尾相接但不重叠（闭区间下 [1,2] 和 [3,5] 不撞）必须放行，
  // 否则上面那些 409 也可能只是"这个接口谁都不收"。
  it('相邻但不重叠的区间可以共存', async () => {
    expect((await make(3, 5)).status).toBe(200);
    expect((await make(1, 2)).status).toBe(200);
    expect((await make(6, 10)).status).toBe(200);
  });

  it('改动阶梯撞上别的区间时同样被拒', async () => {
    const a = await make(3, 5);
    expect((await make(6, 10)).status).toBe(200);

    const res = await request(app).put(`/api/pricing-tiers/${a.body.id}`).set(auth(token))
      .send({ minStudents: 3, maxStudents: 7 });   // 伸进 [6,10]
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('已存在人数区间重叠的定价阶梯');
  });
});

// 唯一性/重叠检查都带着 teacherId。去掉那个条件整套测试照样全绿——现有用例只用
// 自己的行，只证明了"撞上会拒"，没证明"别人的行不算撞上"。漏了的后果是跨租户
// 拒绝服务外加一个存在性探针：别的教师占了这个日期/区间，你就永远建不出来。
async function seedOtherTeacher(drizzleDb, table, values) {
  const { teachers } = await import('../db/schema.js');
  const schema = await import('../db/schema.js');
  const r = drizzleDb.insert(teachers).values({
    username: 'otherteacher', passwordHash: 'x', name: 'other', apiKey: 'key-othertea',
  }).run();
  const otherId = Number(r.lastInsertRowid);
  drizzleDb.insert(schema[table]).values({ ...values, teacherId: otherId }).run();
  return otherId;
}

describe('定价阶梯重叠只看自己的阶梯', () => {
  it('别的教师有一个完全重叠的区间，本教师照样建得出来', async () => {
    await seedOtherTeacher(drizzleDb, 'pricingTiers', {
      minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 999,
    });
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    expect(res.status).toBe(200);
    expect(res.body.pricePerStudentPerHour).toBe(120);
  });

  // PUT 那边是同一个检查的另一份拷贝，同样只该看自己的阶梯。
  it('改阶梯时，别的教师的阶梯不算重叠', async () => {
    await seedOtherTeacher(drizzleDb, 'pricingTiers', {
      minStudents: 4, maxStudents: 9, pricePerStudentPerHour: 999,
    });
    const created = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    expect(created.status).toBe(200);

    const res = await request(app).put(`/api/pricing-tiers/${created.body.id}`).set(auth(token))
      .send({ minStudents: 4, maxStudents: 9 });
    expect(res.status).toBe(200);
    expect(res.body.minStudents).toBe(4);
  });

  it('改阶梯撞上自己另一个阶梯仍然被拒（对照）', async () => {
    const a = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 4, maxStudents: 9, pricePerStudentPerHour: 100 });
    const res = await request(app).put(`/api/pricing-tiers/${a.body.id}`).set(auth(token))
      .send({ minStudents: 5, maxStudents: 7 });
    expect(res.status).toBe(409);
  });

  it('自己的区间重叠仍然被拒（对照）', async () => {
    await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 3, maxStudents: 8, pricePerStudentPerHour: 100 });
    expect(res.status).toBe(409);
  });
});
