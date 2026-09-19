import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { setupApp, makeUser, auth } from './route-helpers.js';
import { schedules } from '../db/schema.js';

let app, drizzleDb, token, teacherId;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/classes', '../routes/classes.js'));
  ({ token, id: teacherId } = await makeUser(drizzleDb));
});

describe('POST /api/classes', () => {
  it('creates a class and returns full object', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '数学一班', grade: '高一', subject: '数学', studentCount: 5 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('数学一班');
    expect(res.body.grade).toBe('高一');
    expect(res.body.subject).toBe('数学');
    expect(res.body.studentCount).toBe(5);
    expect(res.body.isDeleted).toBe(false);
  });

  it('rejects invalid grade', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '三年级', subject: '数学', studentCount: 5 });
    expect(res.status).toBe(400);
  });

  it('rejects empty name', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ grade: '高一', subject: '数学', studentCount: 5 });
    expect(res.status).toBe(400);
  });

  it('rejects studentCount < 1', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 0 });
    expect(res.status).toBe(400);
  });

  // 默认阶梯除最后一档外都是 min === max（1人/2人/3人/4人各一档），所以区间判断
  // 一旦从闭区间变成开区间，1 人班就一档都匹配不上，单价从 800 悄悄掉到兜底的 200。
  it.each([
    [1, 800],
    [3, 500],
    [5, 200],
  ])('省略 unitPrice 时按 %i 人档自动填 %i', async (studentCount, expected) => {
    const { seedPricingTiers } = await import('../db/seed.js');
    seedPricingTiers(teacherId);

    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: `定价班${studentCount}`, grade: '高一', subject: '数学', studentCount });
    expect(res.status).toBe(200);
    expect(res.body.unitPrice).toBe(expected);
  });

  // 已经有阶梯了就不能再播一遍：重复插入会让同一个人数区间出现两条，
  // 而 getDefaultPrice 用的是 find——取到哪一条全看行序。
  it('已有阶梯时再次播种不会重复插入', async () => {
    const { seedPricingTiers } = await import('../db/seed.js');
    const { pricingTiers } = await import('../db/schema.js');
    seedPricingTiers(teacherId);
    const afterFirst = drizzleDb.select().from(pricingTiers).all().length;
    seedPricingTiers(teacherId);
    const afterSecond = drizzleDb.select().from(pricingTiers).all().length;

    expect([afterFirst, afterSecond]).toEqual([5, 5]);
  });

  // 班级默认地点的经纬度上下限在建班和改班各写了一遍，两处都没有用例。
  it.each([
    ['纬度超上限', { defaultLocationLat: 91 }, '纬度'],
    ['经度超下限', { defaultLocationLng: -181 }, '经度'],
  ])('建班时%s被拒', async (_label, patch, word) => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '坐标班', grade: '高一', subject: '数学', studentCount: 1, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(word);
  });

  it('改班时越界经纬度同样被拒', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '坐标班2', grade: '高一', subject: '数学', studentCount: 1 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ defaultLocationLat: 91 });
    expect(res.status).toBe(400);
  });

  it('边界值本身可用', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '坐标班3', grade: '高一', subject: '数学', studentCount: 1, defaultLocationLat: 90, defaultLocationLng: -180 });
    expect(res.status).toBe(200);
  });

  it('一条阶梯都没有时回落到 200，而不是报错或留空', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '无阶梯班', grade: '高一', subject: '数学', studentCount: 1 });
    expect(res.status).toBe(200);
    expect(res.body.unitPrice).toBe(200);
  });

  it('stores blank optional coordinates as null', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({
        name: '线上班', grade: '高一', subject: '数学', studentCount: 5,
        defaultLocationLat: '', defaultLocationLng: '',
      });
    expect(res.status).toBe(200);
    expect(res.body.defaultLocationLat).toBeNull();
    expect(res.body.defaultLocationLng).toBeNull();
  });
});

describe('GET /api/classes', () => {
  it('lists classes for teacher', async () => {
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '数学一班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).get('/api/classes').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('数学一班');
  });

  it('excludes soft-deleted classes', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '待删班', grade: '高一', subject: '数学', studentCount: 5 });
    await request(app).delete(`/api/classes/${id}`).set(auth(token));
    const res = await request(app).get('/api/classes').set(auth(token));
    expect(res.body).toHaveLength(0);
  });

  it('includes soft-deleted with includeDeleted=true', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '待删班', grade: '高一', subject: '数学', studentCount: 5 });
    await request(app).delete(`/api/classes/${id}`).set(auth(token));
    const res = await request(app).get('/api/classes?includeDeleted=true').set(auth(token));
    expect(res.body).toHaveLength(1);
    expect(res.body[0].isDeleted).toBe(true);
  });

  it('sorts by last schedule time descending (most recent first)', async () => {
    const { body: { id: c1 } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班A', grade: '高一', subject: '数学', studentCount: 5 });
    const { body: { id: c2 } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班B', grade: '高二', subject: '物理', studentCount: 3 });
    const { body: { id: c3 } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班C', grade: '高三', subject: '英语', studentCount: 2 });

    drizzleDb.insert(schedules).values({ classId: c1, date: '2026-05-01', startTime: '09:00', endTime: '10:00', durationBilling: 60 }).run();
    drizzleDb.insert(schedules).values({ classId: c2, date: '2026-06-15', startTime: '14:00', endTime: '16:00', durationBilling: 120 }).run();

    const res = await request(app).get('/api/classes').set(auth(token));
    expect(res.status).toBe(200);
    const ids = res.body.map(c => c.id);
    expect(ids[0]).toBe(c2);   // latest schedule (June)
    expect(ids[1]).toBe(c1);   // earlier schedule (May)
    expect(ids[2]).toBe(c3);   // no schedule → last
  });
});

describe('PUT /api/classes/:id', () => {
  it('updates a class and returns full object', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '旧名', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ name: '新名' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.name).toBe('新名');
    expect(res.body.grade).toBe('高一');
    expect(res.body.isDeleted).toBe(false);
  });

  it('rejects negative unitPrice', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ unitPrice: -10 });
    expect(res.status).toBe(400);
  });

  it('accepts unitPrice = 0 (free class) symmetrically with create', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '试听班', grade: '高一', subject: '数学', studentCount: 5, unitPrice: 0 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ unitPrice: 0 });
    expect(res.status).toBe(200);
    expect(res.body.unitPrice).toBe(0);
  });

  it('clears optional coordinates to null', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({
        name: '线下班', grade: '高一', subject: '数学', studentCount: 5,
        defaultLocationLat: 31.2, defaultLocationLng: 121.4,
      });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ defaultLocationLat: '', defaultLocationLng: '' });
    expect(res.status).toBe(200);
    expect(res.body.defaultLocationLat).toBeNull();
    expect(res.body.defaultLocationLng).toBeNull();
  });
});

describe('POST /api/classes/:classId/students validation', () => {
  it('rejects invalid phone in sub-router (consistent with /api/students)', async () => {
    const { body: { id: classId } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).post(`/api/classes/${classId}/students`).set(auth(token))
      .send({ name: '张三', phone: '123' });
    expect(res.status).toBe(400);
  });

  it('rejects a calendar-impossible birthDate in the sub-router', async () => {
    const { body: { id: classId } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).post(`/api/classes/${classId}/students`).set(auth(token))
      .send({ name: '张三', birthDate: '2026-02-30' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/classes/:id (cont.)', () => {
  it('returns 404 for other teacher class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token2))
      .send({ name: 'hack' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/classes/:id', () => {
  it('soft deletes a class', async () => {
    const { classes } = await import('../db/schema.js');
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).delete(`/api/classes/${id}`).set(auth(token));
    expect(res.status).toBe(200);

    // 用例名说的是"软删"，光看 200 的话硬删也照样通过——而硬删会把这个班的
    // 排课变成孤儿行，/restore 也就没东西可恢复了。所以要看行还在、只是被标记了。
    const row = drizzleDb.select().from(classes).where(eq(classes.id, id)).get();
    expect(row).toBeTruthy();
    expect(row.deleted).toBe(true);

    // 而且默认列表里不该再出现
    const list = await request(app).get('/api/classes').set(auth(token));
    expect(list.body.some(c => c.id === id)).toBe(false);
  });

  it('returns 404 for other teacher class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).delete(`/api/classes/${id}`).set(auth(token2));
    expect(res.status).toBe(404);
  });
});

// 班级和定价的改动直接影响报表金额，写完必须把报表缓存清掉。缓存 TTL 是 60 秒：
// 不清的话，老师改完单价刷新报表，看到的还是旧的收入数字，响应头还写着
// X-Report-Cache: hit，页面上没有任何"这是旧数据"的迹象。
// （"排课那边有用例盯着"这句原来写在这里，是错的：九条写路径里只有 POST /api/schedules
//  一条有。其余八条现在在 routes-schedules.test.js 的同名 describe 里补上了。）
describe('班级/定价写操作会让报表缓存失效', () => {
  const key = (teacherId) => ({ teacherId, start: '2026-01-01', end: '2026-12-31' });

  async function seedClass() {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '缓存班', grade: '高一', subject: '数学', studentCount: 2, unitPrice: 300 });
    expect(res.status).toBe(200);
    return res.body.id;
  }

  async function seedPricing(id) {
    const res = await request(app).post(`/api/classes/${id}/pricing`).set(auth(token))
      .send({ studentCount: 2, unitPrice: 888, effectiveFrom: '2026-06-01' });
    expect(res.status).toBe(200);
    return res.body.id;
  }

  it.each([
    ['改班级单价', async (id) => request(app).put(`/api/classes/${id}`).set(auth(token)).send({ unitPrice: 999 })],
    ['删班级', async (id) => request(app).delete(`/api/classes/${id}`).set(auth(token))],
    ['新增定价', async (id) => request(app).post(`/api/classes/${id}/pricing`).set(auth(token))
      .send({ studentCount: 2, unitPrice: 888, effectiveFrom: '2026-06-01' })],
  ])('%s 之后缓存被清掉', async (_label, act) => {
    const { setReportCache, getReportCache, clearReportCache } = await import('../services/report-cache.js');
    const id = await seedClass();

    clearReportCache();
    setReportCache(key(teacherId), { revenue: '旧数据' });
    expect(getReportCache(key(teacherId))).toEqual({ revenue: '旧数据' });

    const res = await act(id);
    expect(res.status).toBe(200);
    expect(getReportCache(key(teacherId))).toBeNull();
  });

  // 这三条要先铺数据再灌缓存：铺数据（建定价、删班级）本身就是一次写入，
  // 也会清缓存，混在一起的话被测的那次写入不清缓存照样绿。
  it.each([
    ['改定价', async (id) => seedPricing(id),
      (id, pid) => request(app).put(`/api/classes/${id}/pricing/${pid}`).set(auth(token)).send({ unitPrice: 777 })],
    ['删定价', async (id) => seedPricing(id),
      (id, pid) => request(app).delete(`/api/classes/${id}/pricing/${pid}`).set(auth(token))],
    ['恢复已删的班级', async (id) => { await request(app).delete(`/api/classes/${id}`).set(auth(token)); return null; },
      (id) => request(app).post(`/api/classes/${id}/restore`).set(auth(token))],
  ])('%s 之后缓存被清掉', async (_label, setup, act) => {
    const { setReportCache, getReportCache, clearReportCache } = await import('../services/report-cache.js');
    const id = await seedClass();
    const extra = await setup(id);

    clearReportCache();
    setReportCache(key(teacherId), { revenue: '旧数据' });
    expect(getReportCache(key(teacherId))).toEqual({ revenue: '旧数据' });

    const res = await act(id, extra);
    expect(res.status).toBe(200);
    expect(getReportCache(key(teacherId)), '这次写入没有清掉报表缓存').toBeNull();
  });

  it('建班本身也清（新班的排课会进报表）', async () => {
    const { setReportCache, getReportCache, clearReportCache } = await import('../services/report-cache.js');
    clearReportCache();
    setReportCache(key(teacherId), { revenue: '旧数据' });
    await seedClass();
    expect(getReportCache(key(teacherId))).toBeNull();
  });
});

// 建学生有两条路：POST /api/students 和 POST /api/classes/:id/students。
// 后者的字段规则是照抄前者的，所以那边修过的"数字绑进 TEXT 列会存成 1990.0"
// 在这边同样成立——当初只改了 students.js，这条路就漏了。
describe('班级下建学生时的数字字段同样按字符串存', () => {
  it.each([
    ['birthDate', 1990, '1990'],
    ['phone', 13800000000, '13800000000'],
    ['parentPhone', 13900000000, '13900000000'],
  ])('%s 收到数字时存成 %s', async (field, sent, expected) => {
    const cls = await request(app).post('/api/classes').set(auth(token))
      .send({ name: `含学生班_${field}`, grade: '高一', subject: '数学', studentCount: 1 });
    const res = await request(app).post(`/api/classes/${cls.body.id}/students`).set(auth(token))
      .send({ name: `数字${field}`, [field]: sent });

    expect(res.status).toBe(200);
    expect(res.body[field]).toBe(expected);
  });
});

describe('POST /api/classes/:id/restore', () => {
  it('restores a soft-deleted class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '可恢复', grade: '高一', subject: '数学', studentCount: 5 });
    await request(app).delete(`/api/classes/${id}`).set(auth(token));
    const res = await request(app).post(`/api/classes/${id}/restore`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.isDeleted).toBe(false);
    const list = await request(app).get('/api/classes').set(auth(token));
    expect(list.body).toHaveLength(1);
  });

  it('returns 400 if class not deleted', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '正常', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).post(`/api/classes/${id}/restore`).set(auth(token));
    expect(res.status).toBe(400);
  });

  it('returns 404 for other teacher class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '别人的', grade: '高一', subject: '数学', studentCount: 5 });
    await request(app).delete(`/api/classes/${id}`).set(auth(token));
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).post(`/api/classes/${id}/restore`).set(auth(token2));
    expect(res.status).toBe(404);
  });
});

describe('Data isolation', () => {
  it('does not show other teacher classes', async () => {
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '我的班', grade: '高一', subject: '数学', studentCount: 5 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/classes').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });
});

describe('GET /api/classes/:id', () => {
  it('returns a single class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '数学一班', grade: '高一', subject: '数学', studentCount: 5, unitPrice: 200 });
    const res = await request(app).get(`/api/classes/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('数学一班');
    expect(res.body.unitPrice).toBe(200);
    expect(res.body.isDeleted).toBe(false);
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await request(app).get('/api/classes/99999').set(auth(token));
    expect(res.status).toBe(404);
  });

  it('returns 404 for other teacher class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get(`/api/classes/${id}`).set(auth(token2));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/classes/locations/suggest', () => {
  it('returns distinct location names from classes', async () => {
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班A', grade: '高一', subject: '数学', studentCount: 5, defaultLocationName: '图书馆' });
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班B', grade: '高二', subject: '物理', studentCount: 3, defaultLocationName: '图书馆' });
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班C', grade: '高三', subject: '英语', studentCount: 2, defaultLocationName: '教室A' });
    const res = await request(app).get('/api/classes/locations/suggest').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['图书馆', '教室A']);
  });

  it('excludes locations from soft-deleted classes', async () => {
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班A', grade: '高一', subject: '数学', studentCount: 5, defaultLocationName: '图书馆' });
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班B', grade: '高二', subject: '物理', studentCount: 3, defaultLocationName: '教室A' });
    await request(app).delete(`/api/classes/${id}`).set(auth(token));
    const res = await request(app).get('/api/classes/locations/suggest').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['图书馆']);
  });

  it('does not include other teacher locations', async () => {
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班A', grade: '高一', subject: '数学', studentCount: 5, defaultLocationName: '图书馆' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/classes/locations/suggest').set(auth(token2));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('input coercion and type guards', () => {
  it.each([
    ['unitPrice', '1e309'], ['discountAmount', '1e309'],
    ['unitPrice', [100]], ['discountAmount', [100]],
  ])('rejects non-finite or composite %s on create and update (%j)', async (field, value) => {
    const fields = { name: '金额校验', grade: '高一', subject: '数学', studentCount: 2, unitPrice: 100 };
    const invalid = await request(app).post('/api/classes').set(auth(token)).send({ ...fields, [field]: value });
    expect(invalid.status).toBe(400);
    const created = await request(app).post('/api/classes').set(auth(token)).send(fields);
    expect(created.status).toBe(200);
    const updated = await request(app).put(`/api/classes/${created.body.id}`).set(auth(token)).send({ [field]: value });
    expect(updated.status).toBe(400);
    const stored = await request(app).get(`/api/classes/${created.body.id}`).set(auth(token));
    expect(stored.body[field]).toBe(field === 'unitPrice' ? 100 : 0);
  });

  it('isCompetition:"false" is stored as false', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '竞赛班', grade: '高一', subject: '数学', studentCount: 5, isCompetition: 'false' });
    expect(res.status).toBe(200);
    expect(res.body.isCompetition).toBe(false);
    const upd = await request(app).put(`/api/classes/${res.body.id}`).set(auth(token)).send({ isCompetition: '0' });
    expect(upd.status).toBe(200);
    expect(upd.body.isCompetition).toBe(false);
  });

  it('rejects an object where a string is expected instead of failing at the driver', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '数学一班', grade: '高一', subject: { a: 1 }, studentCount: 5 });
    expect(res.status).toBe(400);
  });

  it('rejects a whitespace-only name', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '   ', grade: '高一', subject: '数学', studentCount: 5 });
    expect(res.status).toBe(400);
  });
});

// 原地改定价必须允许把 effectiveFrom 原样带回来。PricingManager.openEdit 预填的就是
// 这一行自己的 effectiveFrom，handleSave 每次都发它——少了「跟原值不同才查重」这半句，
// 每一次改单价都会撞上自己那行，回 409「该日期已有定价记录」，改价功能整个坏掉。
// 现有的定价用例只测「新增」，所以这半句一直没人钉。
describe('改定价时不会撞上自己那一行', () => {
  async function seed() {
    const cls = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '定价班', grade: '高一', subject: '数学', studentCount: 2, unitPrice: 300 });
    const p = await request(app).post(`/api/classes/${cls.body.id}/pricing`).set(auth(token))
      .send({ studentCount: 2, unitPrice: 300, effectiveFrom: '2026-03-01' });
    expect(p.status).toBe(200);
    return { classId: cls.body.id, pricingId: p.body.id };
  }

  it('原样带着自己的 effectiveFrom 改单价，成功而不是 409', async () => {
    const { classId, pricingId } = await seed();
    const res = await request(app).put(`/api/classes/${classId}/pricing/${pricingId}`).set(auth(token))
      .send({ unitPrice: 555, effectiveFrom: '2026-03-01' });
    expect(res.status).toBe(200);
    expect(res.body.unitPrice).toBe(555);
    expect(res.body.effectiveFrom).toBe('2026-03-01');
  });

  it('改成另一条已占用的日期仍然 409（对照）', async () => {
    const { classId, pricingId } = await seed();
    const second = await request(app).post(`/api/classes/${classId}/pricing`).set(auth(token))
      .send({ studentCount: 2, unitPrice: 400, effectiveFrom: '2026-06-01' });
    expect(second.status).toBe(200);

    const res = await request(app).put(`/api/classes/${classId}/pricing/${pricingId}`).set(auth(token))
      .send({ effectiveFrom: '2026-06-01' });
    expect(res.status).toBe(409);
  });

  it('改成一个没被占用的日期，成功', async () => {
    const { classId, pricingId } = await seed();
    const res = await request(app).put(`/api/classes/${classId}/pricing/${pricingId}`).set(auth(token))
      .send({ effectiveFrom: '2026-09-01' });
    expect(res.status).toBe(200);
    expect(res.body.effectiveFrom).toBe('2026-09-01');
  });
});

// 解绑一个本来就不在这个班里的学生必须是 404，而不是假装成功。
describe('从班里移除学生', () => {
  it('学生不在这个班时报 404，而不是回 ok', async () => {
    const cls = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 1 });
    const stu = await request(app).post(`/api/classes/${cls.body.id}/students`).set(auth(token))
      .send({ name: '在班里的' });
    expect(stu.status).toBe(200);

    const other = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '另一个班', grade: '高一', subject: '数学', studentCount: 1 });
    const res = await request(app)
      .delete(`/api/classes/${other.body.id}/students/${stu.body.id}`).set(auth(token));
    expect(res.status).toBe(404);
  });

  it('学生在班里时正常解绑（对照）', async () => {
    const cls = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 1 });
    const stu = await request(app).post(`/api/classes/${cls.body.id}/students`).set(auth(token))
      .send({ name: '在班里的' });
    const res = await request(app)
      .delete(`/api/classes/${cls.body.id}/students/${stu.body.id}`).set(auth(token));
    expect(res.status).toBe(200);
  });
});

// /locations/suggest 的字母序写进了 agent-help，得钉住。
describe('GET /api/classes/locations/suggest', () => {
  it('按字母序返回', async () => {
    // 名字要选"自然顺序 != 字母序"的：班级默认地点排在前、排课地点在后，
    // 用 丙/乙/甲 的话两者恰好一致（UTF-16 码位就是这个次序），去掉 .sort() 照样绿。
    const cls = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 1, defaultLocationName: 'Room C' });
    const { schedules } = await import('../db/schema.js');
    // (class_id, date, start_time) 上有唯一约束，两条得错开时间。
    for (const [i, locationName] of ['Room B', 'Room A'].entries()) {
      drizzleDb.insert(schedules).values({
        classId: cls.body.id, date: '2026-05-04',
        startTime: `0${9 + i}:00`, endTime: `1${i}:00`,
        durationBilling: 60, locationName,
      }).run();
    }
    const res = await request(app).get('/api/classes/locations/suggest').set(auth(token));
    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.locations;
    expect(list).toEqual(['Room A', 'Room B', 'Room C']);
  });
});
