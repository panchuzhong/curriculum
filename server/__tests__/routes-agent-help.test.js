import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { DATE_MIN, DATE_MAX } from '../validations/dates.js';

let app, token;

beforeAll(async () => {
  const { setupApp, makeUser, auth } = await import('./route-helpers.js');
  const result = await setupApp('/api/agent', '../routes/agent-help.js');
  app = result.app;
  const user = await makeUser(result.drizzleDb);
  token = user.token;
});

describe('GET /api/agent/help', () => {
  it('returns API documentation with auth', async () => {
    const res = await request(app).get('/api/agent/help').set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('课表管理系统 API');
    expect(res.body.version).toBeDefined();
    expect(res.body.endpoints).toBeDefined();
    expect(res.body.auth).toBeDefined();
  });

  it('includes endpoint list', async () => {
    const res = await request(app).get('/api/agent/help').set({ Authorization: `Bearer ${token}` });
    expect(typeof res.body.endpoints).toBe('object');
    expect(Object.keys(res.body.endpoints).length).toBeGreaterThan(0);
  });

  // toBeDefined 对 {} 也成立：把整段 auth 规则替换成空对象，原来的三条断言全绿。
  // 而 validationRules 全仓库只有这一条用例读它——它是这份机器可读契约的唯一守卫。
  // 所以要落到具体字段上：每组规则非空，且关键端点的必填项确实写进去了。
  it('includes validation rules', async () => {
    const res = await request(app).get('/api/agent/help').set({ Authorization: `Bearer ${token}` });
    const rules = res.body.validationRules;
    expect(rules).toBeDefined();

    // 每一组都得有内容，不能是空壳
    for (const group of ['auth', 'classes', 'students', 'schedules']) {
      expect(Object.keys(rules[group] ?? {}).length).toBeGreaterThan(0);
    }

    // 抽查几处真正的必填项：调用方就是照这些字段名构造请求的
    expect(Object.keys(rules.auth)).toEqual(expect.arrayContaining(['register', 'login', 'changePassword']));
    expect(rules.auth.register.username).toBeTruthy();
    expect(rules.auth.register.password).toBeTruthy();
    expect(Object.keys(rules.schedules)).toEqual(expect.arrayContaining(['create', 'batchCreate']));
    expect(rules.schedules.create.classId).toBeTruthy();
    expect(rules.schedules.create.date).toBeTruthy();
  });

  it('includes examples', async () => {
    const res = await request(app).get('/api/agent/help').set({ Authorization: `Bearer ${token}` });
    expect(res.body.examples).toBeDefined();
    expect(Object.keys(res.body.examples).length).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/agent/help');
    expect(res.status).toBe(401);
  });

  // 这份文档是对外发的，说的上下限必须就是服务端真正卡的那一对。
  // 写死成字面量的话，改了 DATE_MIN/DATE_MAX 这里不会报错，只会对着 API 客户端说假话。
  it('notes 里的日期上下限取自服务端常量', async () => {
    const { auth } = await import('./route-helpers.js');
    const res = await request(app).get('/api/agent/help').set(auth(token));
    // 用 filter + 唯一性断言，不用 find 取第一条：日后在它前面插入另一条带日期区间的
    // note，find 会改绑到那一条，两个 toContain 对着错的字符串通过，真正的上下限
    // 说明漂了也没人发现。多出一条就让测试红，由人来决定绑哪条。
    const notes = res.body.notes.filter(n => n.includes('YYYY-MM-DD') && n.includes('~'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain(DATE_MIN);
    expect(notes[0]).toContain(DATE_MAX);
  });

  it('version 就是 package.json 的版本', async () => {
    const { auth } = await import('./route-helpers.js');
    const res = await request(app).get('/api/agent/help').set(auth(token));
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
    expect(res.body.version).toBe(pkg.version);
  });

  // 挂上去却没写进文档的接口，拿 API Key 的客户端根本发现不了——/api/geocode 和
  // /api/geocode/status 就这么漏了一整轮。逐个手查会漏，让测试去比对挂载表。
  it('index.js 里挂载的每个 /api 前缀都有文档', async () => {
    const { auth } = await import('./route-helpers.js');
    const res = await request(app).get('/api/agent/help').set(auth(token));
    // 取「精确前缀集合」而不是把文档拼成一大坨做子串匹配：documented.includes('/api/schedule')
    // 会被已有的 'GET /api/schedules' 满足，于是新挂载的 /api/schedule 明明没写文档，
    // 这个断言照样绿——正是它要抓的那种遗漏。/api/class、/api/student、/api/semester、
    // /api/audit 同理。
    const documented = new Set(Object.values(res.body.endpoints)
      .flatMap(g => Object.keys(g))
      .map(k => k.match(/\/api\/[\w-]+/)?.[0])
      .filter(Boolean));

    const src = readFileSync(new URL('../index.js', import.meta.url), 'utf-8');
    // 引号形式和路径字符都放宽：只认单引号 + [a-z-] 的话，写成 app.use("/api/x")
    // 或 '/api/v2' 的新挂载一条都匹配不上，undocumented 依旧是空数组、测试照样绿——
    // 正好漏掉它本来要抓的那种遗漏。
    const mounted = [...src.matchAll(/app\.use\(\s*['"`](\/api\/[\w-]+)/g)].map(m => m[1]);
    // 兜底：真挂载数是 12，掉到个位数说明正则又失配了，而不是真的少了路由。
    expect(mounted.length).toBeGreaterThanOrEqual(10);

    // /api/agent 挂的是这份文档自己，文档里的键写作 /api/agent/help。
    const undocumented = mounted.filter(prefix => !documented.has(prefix));
    expect(undocumented).toEqual([]);
  });

  // 前缀那条拦不住「在已有前缀下新加一个端点却忘了写文档」：新的
  // GET /api/schedules/xyz 落在早就有文档的 /api/schedules 前缀里，照样绿。
  // 这份文档存在的意义就是被机器当真，漏一条就是错的。所以逐个端点比。
  it('每个真实存在的端点（方法+路径）都有文档', async () => {
    const { auth } = await import('./route-helpers.js');
    const res = await request(app).get('/api/agent/help').set(auth(token));

    const norm = (p) => p.replace(/:\w+/g, ':P');
    const documented = new Set(Object.values(res.body.endpoints)
      .flatMap(g => Object.keys(g))
      .map(k => k.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/\S*)/))
      .filter(Boolean)
      // 文档的键常把查询串写进去（'GET /api/schedule-image?start=...&end=...'），
      // 比的是路由，所以先去掉 ? 之后的部分。
      .map(m => `${m[1]} ${norm(m[2].split('?')[0])}`));

    const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf-8');
    const moduleOf = new Map([...idx.matchAll(/import\s+(\w+)\s+from\s+'(\.\/routes\/[^']+)'/g)]
      .map(m => [m[1], m[2]]));
    const mounts = [...idx.matchAll(/app\.use\(\s*'(\/api[^']*)'\s*,\s*(?:[\w.]+\s*,\s*)*(\w+)\s*\)/g)];

    const real = new Set();
    for (const [, prefix, varName] of mounts) {
      const file = moduleOf.get(varName);
      if (!file) continue;
      const src = readFileSync(new URL(`../${file.slice(2)}`, import.meta.url), 'utf-8');
      // 模块内部再挂的子路由（如 classes.js 里的 pricingRouter）要带上它的子路径
      const subPath = new Map();
      for (const m of src.matchAll(/(\w+)\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g)) subPath.set(m[3], m[2]);
      for (const m of src.matchAll(/(\w+)\.(get|post|put|delete|patch)\(\s*'([^']*)'/g)) {
        const base = prefix + (subPath.get(m[1]) || '');
        const full = (base + m[3]).replace(/\/\//g, '/').replace(/(.)\/$/, '$1');
        real.add(`${m[2].toUpperCase()} ${norm(full)}`);
      }
    }

    // 兜底：真实端点是 61 个，掉下来说明上面的正则失配了，而不是路由真的没了——
    // 没有这一条，解析一坏 undocumented 就是空数组，这个断言会无声通过。
    expect(real.size).toBeGreaterThanOrEqual(55);
    expect([...real].filter(r => !documented.has(r)).sort()).toEqual([]);
  });
});
