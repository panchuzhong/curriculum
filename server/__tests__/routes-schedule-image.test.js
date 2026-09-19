import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

vi.mock('../services/image-gen.js', () => ({
  generateScheduleImage: vi.fn(async () => Buffer.from('fake-png-data')),
}));
vi.mock('../services/image-gen-monthly.js', () => ({
  generateMonthlyImage: vi.fn(async () => Buffer.from('fake-monthly-png')),
}));
vi.mock('../services/image-gen-yearly.js', () => ({
  generateYearlyImage: vi.fn(async () => Buffer.from('fake-yearly-png')),
}));

let app, drizzleDb, token, teacherId;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/schedule-image', '../routes/schedule-image.js'));
  ({ id: teacherId, token } = await makeUser(drizzleDb));
});

describe('GET /api/schedule-image', () => {
  it('rejects missing start/end', async () => {
    const res = await request(app).get('/api/schedule-image').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('start/end or range');
  });

  it.each([
    ['start=2026-02-30&end=2026-03-01', '有效日期'],
    ['start=2026-05-08&end=2026-05-01', '不晚于'],
    ['start=2026-01-01&end=2026-02-01', '31 天'],
  ])('rejects an invalid or unsafe image range: %s', async (query, message) => {
    const res = await request(app).get(`/api/schedule-image?${query}`).set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  it('returns 404 when no classes exist', async () => {
    const res = await request(app).get('/api/schedule-image?start=2026-05-01&end=2026-05-07').set(auth(token));
    expect(res.status).toBe(404);
    // agent-help 把这句写成了对外契约（404 {error:"No classes"}），调用方是照它分支的
    expect(res.body.error).toBe('No classes');
  });

  // 同样是 agent-help 写明的契约：生成失败返回 JSON {error}，且不带内部细节。
  // 渲染栈里的报错常含文件路径、Chromium 参数之类，直接回给调用方既没用也不该。
  it('generates a plain JSON error on failure, without internal detail', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '出图班', grade: '高一', subject: '数学', studentCount: 1, unitPrice: 100,
    }).run();

    const { generateScheduleImage } = await import('../services/image-gen.js');
    generateScheduleImage.mockRejectedValueOnce(
      new Error('Protocol error (Page.captureScreenshot): /home/pcz/secret/path 崩了'));

    const res = await request(app).get('/api/schedule-image?start=2026-05-01&end=2026-05-07').set(auth(token));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Image generation failed');
    // 不能把底层报错原样透出去
    expect(res.text).not.toContain('/home/pcz');
    expect(res.text).not.toContain('Protocol error');
  });

  it('generates PNG image', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '数学班', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();

    const res = await request(app).get('/api/schedule-image?start=2026-05-01&end=2026-05-07').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('supports range=week parameter', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '数学班', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();

    const res = await request(app).get('/api/schedule-image?range=week').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/schedule-image?start=2026-05-01&end=2026-05-07');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/schedule-image/monthly', () => {
  it('rejects missing year/month', async () => {
    const res = await request(app).get('/api/schedule-image/monthly').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('month 须为 0-11');
  });

  it('rejects out-of-range month', async () => {
    const res = await request(app).get('/api/schedule-image/monthly?year=2026&month=12').set(auth(token));
    expect(res.status).toBe(400);
    const res2 = await request(app).get('/api/schedule-image/monthly?year=2026&month=-1').set(auth(token));
    expect(res2.status).toBe(400);
  });

  it('rejects partially numeric year and month values', async () => {
    const res = await request(app).get('/api/schedule-image/monthly?year=2026oops&month=5x').set(auth(token));
    expect(res.status).toBe(400);
  });

  it('returns 404 when no classes exist', async () => {
    const res = await request(app).get('/api/schedule-image/monthly?year=2026&month=5').set(auth(token));
    expect(res.status).toBe(404);
  });

  it('generates monthly PNG image', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '数学班', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();

    const res = await request(app).get('/api/schedule-image/monthly?year=2026&month=5').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/schedule-image/monthly?year=2026&month=5');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/schedule-image/yearly', () => {
  it('rejects missing year', async () => {
    const res = await request(app).get('/api/schedule-image/yearly').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('year 须为 1900-2999');
  });

  it('rejects a partially numeric year', async () => {
    const res = await request(app).get('/api/schedule-image/yearly?year=2026oops').set(auth(token));
    expect(res.status).toBe(400);
  });

  it('returns 404 when no classes exist', async () => {
    const res = await request(app).get('/api/schedule-image/yearly?year=2026').set(auth(token));
    expect(res.status).toBe(404);
  });

  it('generates yearly PNG image', async () => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '数学班', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();

    const res = await request(app).get('/api/schedule-image/yearly?year=2026').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/schedule-image/yearly?year=2026');
    expect(res.status).toBe(401);
  });
});

// 日期参数的上下限是一整套（见 server/validations/dates.js）：周图走 isValidDate 已经带上了，
// 月/年图是自己解析 year 的，放行 1000~9999 的话同一个 router 的三个接口就互相矛盾，
// 而且 endYear 一拉就是十几张空白年表要 Puppeteer 渲染。
describe('图片接口的年份上下限', () => {
  it.each([
    '/api/schedule-image/monthly?year=1000&month=0',
    '/api/schedule-image/monthly?year=9999&month=0',
    '/api/schedule-image/yearly?year=1000',
    // 跨度故意做得小：'?year=2026&endYear=3000' 先被「最多 12 个年份」那条规则拦下，
    // 把 endYear 的上下限改回 1000~9999 它照样是 400——根本分不出是哪条拦的。
    '/api/schedule-image/yearly?year=2995&endYear=3000',
    '/api/schedule-image/monthly?year=2999&month=0&endYear=3000&endMonth=0',
    '/api/schedule-image?start=1899-12-31&end=1900-01-05',
  ])('rejects out-of-range years: %s', async (url) => {
    const res = await request(app).get(url).set(auth(token));
    expect(res.status).toBe(400);
  });

  it('越界的报错要把范围写出来，而不是只说格式不对', async () => {
    const res = await request(app).get('/api/schedule-image?start=1899-12-31&end=1900-01-05').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('1900-01-01 ~ 2999-12-31');
  });

  it.each([
    '/api/schedule-image/monthly?year=1900&month=0',
    '/api/schedule-image/yearly?year=2999',
  ])('accepts the boundary years themselves: %s', async (url) => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '数学班', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();

    const res = await request(app).get(url).set(auth(token));
    expect(res.status).toBe(200);
  });
});

// 多月/多年导出的跨度上限此前没有用例。放行的后果不是报错，而是一张没法看的图：
// endYear/endMonth 早于开始时区间为空，Puppeteer 截出来就是一张空白 PNG
// （这正是之前修过的那类"空白图"问题）；跨度太大则是一张长到没意义、
// 还要把浏览器撑爆的图。两头都得当场说清楚。
describe('多月 / 多年导出的跨度上限', () => {
  async function seedClass() {
    const { classes } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '图片班', grade: '高一', subject: '数学',
      studentCount: 1, unitPrice: 100, durationBilling: 60,
    }).run();
  }

  describe('monthly', () => {
    it.each([
      ['结束早于开始', { year: 2026, month: 5, endYear: 2026, endMonth: 4 }],
      ['结束年份更早', { year: 2026, month: 0, endYear: 2025, endMonth: 11 }],
      // 必须贴着边界：2028-01 是第 26 个月（monthSpan 25），把 > 23 写成 > 24
      // 照样拒——察觉不到。2028-00 才是第 25 个月（monthSpan 24），刚好越界一格。
      ['跨度超过 24 个月', { year: 2026, month: 0, endYear: 2028, endMonth: 0 }],
    ])('%s 时返回 400 并说明范围', async (_label, q) => {
      await seedClass();
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]));
      const res = await request(app).get(`/api/schedule-image/monthly?${qs}`).set(auth(token));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('导出范围须为 1-24 个月');
    });

    it.each([
      ['单月', { year: 2026, month: 5, endYear: 2026, endMonth: 5 }],
      ['正好 24 个月', { year: 2026, month: 0, endYear: 2027, endMonth: 11 }],
    ])('%s 是允许的', async (_label, q) => {
      await seedClass();
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]));
      const res = await request(app).get(`/api/schedule-image/monthly?${qs}`).set(auth(token));

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
    });
  });

  describe('yearly', () => {
    it.each([
      ['结束年份早于开始', { year: 2026, endYear: 2025 }],
      ['跨度超过 12 年', { year: 2026, endYear: 2038 }],
    ])('%s 时返回 400 并说明上限', async (_label, q) => {
      await seedClass();
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]));
      const res = await request(app).get(`/api/schedule-image/yearly?${qs}`).set(auth(token));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('12 个年份');
    });

    it('正好 12 个年份是允许的', async () => {
      await seedClass();
      const res = await request(app).get('/api/schedule-image/yearly?year=2026&endYear=2037').set(auth(token));
      expect(res.status).toBe(200);
    });
  });
});

// 出图前那次查询的日期窗口一直没人看过：generateMonthlyImage 被 mock 掉了，
// 现有用例只断言返回的是 PNG，从没检查递给它的是哪些排课。把月末那天写死成 28
// （new Date(ey, em+1, 0).getDate() → 28）整套测试照样全绿——29/30/31 号的课
// 会从导出的月历里静默消失，而图片本身看着完全正常。
describe('月历出图的查询窗口覆盖整月', () => {
  async function seedMonthEdges() {
    const { classes, schedules } = await import('../db/schema.js');
    const c = drizzleDb.insert(classes).values({
      teacherId, name: '月末班', grade: '高三', subject: '数学', studentCount: 1, unitPrice: 100,
    }).run();
    const classId = Number(c.lastInsertRowid);
    // 2026-01 有 31 天；每个月末边界各排一节。
    for (const date of ['2026-01-01', '2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31']) {
      drizzleDb.insert(schedules).values({
        classId, date, startTime: '09:00', endTime: '10:00', durationBilling: 60,
      }).run();
    }
    return classId;
  }

  it('31 天的月份，29/30/31 号的课都递给了出图函数', async () => {
    const { generateMonthlyImage } = await import('../services/image-gen-monthly.js');
    generateMonthlyImage.mockClear();
    await seedMonthEdges();

    const res = await request(app).get('/api/schedule-image/monthly')
      .query({ year: 2026, month: 0 }).set(auth(token));
    expect(res.status).toBe(200);

    const passed = generateMonthlyImage.mock.calls[0][0];
    const dates = passed.map(s => s.date).sort();
    expect(dates).toEqual(['2026-01-01', '2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31']);
  });

  // 2 月只有 28 天（2026 不是闰年）：窗口不能越到 3 月去。
  it('2 月的窗口停在 28 号，不把 3 月的课卷进来', async () => {
    const { classes, schedules } = await import('../db/schema.js');
    const { generateMonthlyImage } = await import('../services/image-gen-monthly.js');
    const c = drizzleDb.insert(classes).values({
      teacherId, name: '二月班', grade: '高三', subject: '数学', studentCount: 1, unitPrice: 100,
    }).run();
    const classId = Number(c.lastInsertRowid);
    for (const date of ['2026-02-28', '2026-03-01']) {
      drizzleDb.insert(schedules).values({
        classId, date, startTime: '09:00', endTime: '10:00', durationBilling: 60,
      }).run();
    }
    generateMonthlyImage.mockClear();

    const res = await request(app).get('/api/schedule-image/monthly')
      .query({ year: 2026, month: 1 }).set(auth(token));
    expect(res.status).toBe(200);
    const dates = generateMonthlyImage.mock.calls[0][0].map(s => s.date);
    expect(dates).toEqual(['2026-02-28']);
  });

  it('跨月导出时窗口一直延到最后一个月的月末', async () => {
    const { schedules } = await import('../db/schema.js');
    const { generateMonthlyImage } = await import('../services/image-gen-monthly.js');
    const classId = await seedMonthEdges();
    // 末月（3 月）的月末也得进来。只断言 1 月那几天的话，endDate 误用起始月份
    // （2026-03-31 变成 2026-01-31）照样通过。
    for (const date of ['2026-03-01', '2026-03-31']) {
      drizzleDb.insert(schedules).values({
        classId, date, startTime: '09:00', endTime: '10:00', durationBilling: 60,
      }).run();
    }
    generateMonthlyImage.mockClear();

    const res = await request(app).get('/api/schedule-image/monthly')
      .query({ year: 2026, month: 0, endYear: 2026, endMonth: 2 }).set(auth(token));
    expect(res.status).toBe(200);
    const dates = generateMonthlyImage.mock.calls[0][0].map(s => s.date);
    expect(dates).toContain('2026-01-31');
    expect(dates).toContain('2026-03-31');
  });
});
