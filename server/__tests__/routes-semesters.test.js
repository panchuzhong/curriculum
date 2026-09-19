import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

let app, drizzleDb, token, teacherId;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/semesters', '../routes/semesters.js'));
  ({ token, id: teacherId } = await makeUser(drizzleDb));
});

describe('POST /api/semesters', () => {
  it('creates a semester and returns full object', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026春季', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('2026春季');
    expect(res.body.type).toBe('spring');
    expect(res.body.startDate).toBe('2026-02-01');
    expect(res.body.endDate).toBe('2026-06-30');
  });

  it('rejects invalid type', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: '秋季班', startDate: '2026-02-01', endDate: '2026-06-30' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid date format', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: 'spring', startDate: 'not-date', endDate: '2026-06-30' });
    expect(res.status).toBe(400);
  });

  it('rejects empty name', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    expect(res.status).toBe(400);
  });

  it('rejects endDate < startDate', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '反向', type: 'spring', startDate: '2026-06-30', endDate: '2026-02-01' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/semesters', () => {
  it('lists semesters', async () => {
    await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026春季', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const res = await request(app).get('/api/semesters').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('PUT /api/semesters/:id', () => {
  it('updates a semester and returns full object', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026春季', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const res = await request(app).put(`/api/semesters/${id}`).set(auth(token))
      .send({ name: '2026春季学期' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.name).toBe('2026春季学期');
    expect(res.body.startDate).toBe('2026-02-01');
  });

  it('returns 404 for other teacher semester', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/semesters/${id}`).set(auth(token2)).send({ name: 'hack' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/semesters/:id', () => {
  it('deletes a semester', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const res = await request(app).delete(`/api/semesters/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/semesters').set(auth(token));
    expect(list.body).toHaveLength(0);
  });

  it('returns 404 for nonexistent semester', async () => {
    const res = await request(app).delete('/api/semesters/999999').set(auth(token));
    expect(res.status).toBe(404);
  });
});

describe('Data isolation', () => {
  it('does not show other teacher semesters', async () => {
    await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '我的学期', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/semesters').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });
});

describe('Audit logging', () => {
  it('logs CREATE on semester creation', async () => {
    const { logAudit } = await import('../services/audit.js');
    await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '审计学期', type: 'fall', startDate: '2026-09-01', endDate: '2026-12-31' });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', tableName: 'semesters' })
    );
  });

  it('logs DELETE on semester deletion', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '待删学期', type: 'summer', startDate: '2026-07-01', endDate: '2026-08-31' });
    const { logAudit } = await import('../services/audit.js');
    await request(app).delete(`/api/semesters/${id}`).set(auth(token));
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', tableName: 'semesters' })
    );
  });

  it('logs UPDATE on semester update', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '更新学期', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const { logAudit } = await import('../services/audit.js');
    logAudit.mockClear();
    await request(app).put(`/api/semesters/${id}`).set(auth(token))
      .send({ name: '新名称' });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', tableName: 'semesters', recordId: id })
    );
  });
});

describe('edge cases', () => {
  it('rejects overlapping semesters', async () => {
    await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '春季', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '重叠学期', type: 'summer', startDate: '2026-06-01', endDate: '2026-07-31' });
    expect(res.status).toBe(409);
  });

  it('allows startDate === endDate (single-day semester)', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '单日学期', type: 'spring', startDate: '2026-05-01', endDate: '2026-05-01' });
    expect(res.status).toBe(200);
    expect(res.body.startDate).toBe('2026-05-01');
    expect(res.body.endDate).toBe('2026-05-01');
  });
});

describe('POST /api/semesters — contiguous boundary (adversarial)', () => {
  it('allows a semester starting on the day another ends', async () => {
    const first = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026秋季', type: 'fall', startDate: '2026-09-01', endDate: '2027-01-15' });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2027寒假', type: 'winter', startDate: '2027-01-15', endDate: '2027-02-20' });
    expect(second.status).toBe(200);
    expect(second.body.id).toBeDefined();
  });

  it('still rejects a true overlap by one day', async () => {
    await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026秋季', type: 'fall', startDate: '2026-09-01', endDate: '2027-01-15' });
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '重叠', type: 'winter', startDate: '2027-01-14', endDate: '2027-02-20' });
    expect(res.status).toBe(409);
  });

  it('PUT allows moving a semester boundary to touch its neighbor', async () => {
    const a = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026秋季', type: 'fall', startDate: '2026-09-01', endDate: '2027-01-15' });
    const b = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2027寒假', type: 'winter', startDate: '2027-01-16', endDate: '2027-02-20' });
    const res = await request(app).put(`/api/semesters/${b.body.id}`).set(auth(token))
      .send({ startDate: '2027-01-15' });
    expect(res.status).toBe(200);
    expect(res.body.startDate).toBe('2027-01-15');
  });
});

// 越界和格式错误走的是同一个 isValidDate：提示语只说「格式须为 YYYY-MM-DD」的话，
// 1899-09-01 这种格式完全正确的值拿到的就是一句自相矛盾的报错。
describe('学期日期的上下限', () => {
  it('越界日期被拒，且报错里写出了范围', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '越界学期', type: 'spring', startDate: '1899-09-01', endDate: '1900-01-15' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('1900-01-01 ~ 2999-12-31');
  });

  it('边界值本身可用', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '边界学期', type: 'spring', startDate: '1900-01-01', endDate: '1900-06-30' });
    expect(res.status).toBe(200);
  });
});

// validateUpdateSemester 的跨字段检查只在 startDate 也在 body 里时才触发，
// 所以「只改结束日」这条路全靠路由里那一行 newEnd < newStart。它没有任何用例：
// 删掉它，PUT {endDate:'2026-01-01'} 就能把一个 03-01 开始的学期改成首尾倒挂，
// 而 getDefaultsFromSemesters、批量排课、排课历史都得专门为这种行写兜底。
describe('PUT /api/semesters/:id — 只改一端时的跨字段校验', () => {
  async function seed() {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026春季', type: 'spring', startDate: '2026-03-01', endDate: '2026-07-15' });
    expect(res.status).toBe(200);
    return res.body.id;
  }

  it('只传 endDate 且早于已存的 startDate 时被拒，且原记录没变', async () => {
    const id = await seed();
    const res = await request(app).put(`/api/semesters/${id}`).set(auth(token))
      .send({ endDate: '2026-01-01' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('结束日期须不小于开始日期');

    const after = await request(app).get('/api/semesters').set(auth(token));
    expect(after.body.find(s => s.id === id)).toMatchObject({ startDate: '2026-03-01', endDate: '2026-07-15' });
  });

  it('只传 startDate 且晚于已存的 endDate 时同样被拒', async () => {
    const id = await seed();
    const res = await request(app).put(`/api/semesters/${id}`).set(auth(token))
      .send({ startDate: '2026-12-01' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('结束日期须不小于开始日期');
  });

  it('只改一端但仍然合法时正常保存', async () => {
    const id = await seed();
    const res = await request(app).put(`/api/semesters/${id}`).set(auth(token))
      .send({ endDate: '2026-07-20' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ startDate: '2026-03-01', endDate: '2026-07-20' });
  });
});

// 改完学期日期必须清掉 getTeacherSemesters 的缓存（TTL 60 秒）。不清的话，
// 接下来一分钟里批量排课/批量删课仍按旧的起止日筛选，动到的是另一批课，
// 而且两边都不会报错。
describe('PUT /api/semesters/:id 之后学期缓存必须失效', () => {
  it('改过日期后立刻读到的是新范围', async () => {
    const { getTeacherSemesters } = await import('../services/schedule-helpers.js');
    const { id: teacherId, token: tk } = await makeUser(drizzleDb, `cache${Date.now()}`);

    const created = await request(app).post('/api/semesters').set(auth(tk))
      .send({ name: '缓存学期', type: 'spring', startDate: '2026-03-01', endDate: '2026-07-15' });
    expect(created.status).toBe(200);

    // 先读一次把缓存填上
    expect(getTeacherSemesters(drizzleDb, teacherId)[0]).toMatchObject({ endDate: '2026-07-15' });

    const put = await request(app).put(`/api/semesters/${created.body.id}`).set(auth(tk))
      .send({ endDate: '2026-08-20' });
    expect(put.status).toBe(200);

    expect(getTeacherSemesters(drizzleDb, teacherId)[0]).toMatchObject({ endDate: '2026-08-20' });
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

describe('学期重叠只看自己的学期', () => {
  it('别的教师有一个完全重叠的学期，本教师照样建得出来', async () => {
    await seedOtherTeacher(drizzleDb, 'semesters', {
      name: 'B的春季', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30',
    });
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '我的春季', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('我的春季');
  });

  // PUT 那边是同一个检查的另一份拷贝，同样只该看自己的学期。
  it('改学期时，别的教师的学期不算重叠', async () => {
    await seedOtherTeacher(drizzleDb, 'semesters', {
      name: 'B的秋季', type: 'fall', startDate: '2026-09-01', endDate: '2027-01-20',
    });
    const created = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '我的春季', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    expect(created.status).toBe(200);

    const res = await request(app).put(`/api/semesters/${created.body.id}`).set(auth(token))
      .send({ startDate: '2026-09-01', endDate: '2027-01-20' });
    expect(res.status).toBe(200);
    expect(res.body.startDate).toBe('2026-09-01');
  });

  it('改学期撞上自己另一个学期仍然被拒（对照）', async () => {
    const a = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '春季', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '秋季', type: 'fall', startDate: '2026-09-01', endDate: '2027-01-20' });
    const res = await request(app).put(`/api/semesters/${a.body.id}`).set(auth(token))
      .send({ startDate: '2026-09-15', endDate: '2026-12-31' });
    expect(res.status).toBe(409);
  });

  it('自己的学期重叠仍然被拒（对照）', async () => {
    await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '我的春季', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '又一个', type: 'spring', startDate: '2026-03-01', endDate: '2026-07-30' });
    expect(res.status).toBe(409);
  });
});

// 学期缓存的 TTL 是 60 秒，排课的 semesterOnly 过滤直接读它（getTeacherSemesters）。
// 删掉一个学期后不清缓存，紧接着的批量排课/批量改课仍会按那个已经不存在的学期
// 裁剪日期，并在响应里回一个指名道姓的提示——说的是用户刚刚亲手删掉的学期。
// PUT 那条此前有用例盯着，POST 和 DELETE 没有。
describe('学期写操作会让学期缓存失效', () => {
  async function seed(name = '缓存学期') {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name, type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    expect(res.status).toBe(200);
    return res.body.id;
  }

  // 缓存是按 teacherId 存的，直接用真实读取入口暖它，再看写入之后读到的是不是新的。
  async function warmAndRead() {
    const { getTeacherSemesters } = await import('../services/schedule-helpers.js');
    return getTeacherSemesters(drizzleDb, teacherId);
  }

  it.each([
    ['建学期', null, () => request(app).post('/api/semesters').set(auth(token))
      .send({ name: '新学期', type: 'fall', startDate: '2026-09-01', endDate: '2027-01-20' }), 1],
    ['改学期', () => seed(), (id) => request(app).put(`/api/semesters/${id}`).set(auth(token))
      .send({ endDate: '2026-07-15' }), 0],
    ['删学期', () => seed(), (id) => request(app).delete(`/api/semesters/${id}`).set(auth(token)), -1],
  ])('%s 之后学期缓存被清掉', async (_label, setup, act, delta) => {
    const { clearSemesterCache } = await import('../services/schedule-helpers.js');
    const id = setup ? await setup() : null;

    clearSemesterCache();
    const before = await warmAndRead();          // 这一步把结果放进缓存
    expect(await warmAndRead()).toBe(before);    // 同一个数组引用 = 确实命中了缓存

    const res = await act(id);
    expect(res.status).toBe(200);

    const after = await warmAndRead();
    expect(after.length, '学期缓存没被清掉，读到的还是旧列表').toBe(before.length + delta);
    if (delta === 0) {
      expect(after.find(x => x.id === id).endDate).toBe('2026-07-15');
    }
  });
});
