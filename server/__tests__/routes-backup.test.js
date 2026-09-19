import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';
import { clearReportCache, getReportCache, setReportCache } from '../services/report-cache.js';

const fsMocks = vi.hoisted(() => ({
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ mtimeMs: 0, size: 1024 })),
  unlinkSync: vi.fn(),
  // writeFileSync 被打掉了，快照文件实际不落盘，所以还原快照的两步（存在性、读内容）
  // 得自己控。默认走真实实现（server/db/index.js 在加载时用 existsSync 建目录）。
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  // 还原前快照的内容只经过 writeFileSync，不落盘也就没法从磁盘读回来核对。
  // 抓下来才能断言它和导出走的是同一套教师过滤。
  writeFileSync: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  fsMocks.existsSync.mockImplementation(actual.existsSync);
  fsMocks.readFileSync.mockImplementation(actual.readFileSync);
  return {
    ...actual,
    writeFileSync: fsMocks.writeFileSync,
    // 快照是先写 .tmp 再改名的；writeFileSync 被打成了空操作，.tmp 根本不存在，
    // 真的 renameSync 会 ENOENT。
    renameSync: vi.fn(),
    readdirSync: fsMocks.readdirSync,
    statSync: fsMocks.statSync,
    unlinkSync: fsMocks.unlinkSync,
    existsSync: fsMocks.existsSync,
    readFileSync: fsMocks.readFileSync,
  };
});

let app, drizzleDb, token, teacherId;

beforeEach(async () => {
  clearReportCache();
  fsMocks.readdirSync.mockClear();
  fsMocks.statSync.mockClear();
  fsMocks.unlinkSync.mockClear();
  fsMocks.writeFileSync.mockClear();
  fsMocks.readdirSync.mockReturnValue([]);
  fsMocks.statSync.mockImplementation(() => ({ mtimeMs: 0, size: 1024 }));
  ({ app, drizzleDb } = await setupApp('/api/backup', '../routes/backup.js'));
  ({ id: teacherId, token } = await makeUser(drizzleDb));
});

describe('GET /api/backup', () => {
  it('exports empty data', async () => {
    const res = await request(app).get('/api/backup').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.classes).toEqual([]);
    expect(res.body.students).toEqual([]);
    expect(res.body.schedules).toEqual([]);
  });

  it('exports data with classes and schedules', async () => {
    const { classes, schedules } = await import('../db/schema.js');
    const cls = drizzleDb.insert(classes).values({
      teacherId, name: '数学班', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();
    const classId = Number(cls.lastInsertRowid);
    drizzleDb.insert(schedules).values({
      classId, date: '2026-05-01', startTime: '09:00', endTime: '11:00', durationBilling: 120,
    }).run();

    const res = await request(app).get('/api/backup').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.classes).toHaveLength(1);
    expect(res.body.schedules).toHaveLength(1);
    expect(res.body.classes[0].name).toBe('数学班');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/backup');
    expect(res.status).toBe(401);
  });
});

// 导出侧的 50MB 闸门此前一条用例都没有（还原侧那个有）。放宽了就是把一个巨大的
// JSON 一次性 send 出去，服务端先在内存里攒满；写死成永远超限则是谁都导不出来。
// 不去真造 50MB 数据——只把体积计算打桩，走的还是同一条分支。
describe('GET /api/backup 的体积上限', () => {
  afterEach(() => vi.restoreAllMocks());

  it('超过 50MB 时返回 413 并说明多大', async () => {
    vi.spyOn(Buffer, 'byteLength').mockReturnValue(60 * 1024 * 1024);
    const res = await request(app).get('/api/backup').set(auth(token));

    expect(res.status).toBe(413);
    expect(res.body.error).toContain('60.0MB');
    expect(res.body.error).toContain('备份数据过大');
  });

  it('不超过 50MB 时正常导出', async () => {
    vi.spyOn(Buffer, 'byteLength').mockReturnValue(49 * 1024 * 1024);
    const res = await request(app).get('/api/backup').set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
  });
});

// 还原前的快照是"先写 .tmp、再改名"落盘的。直接写的话，进程在写到一半被杀
// （OOM、容器重启）会留下一个名字合法、mtime 最新的残文件：它占掉 5 份配额里的一个、
// 挤掉真正的回滚点，而拿它撤销只会得到一句「快照文件无法读取」。
// 这个顺序此前没有用例——改成直接 writeFileSync 整套测试照样绿。
describe('还原前快照是先写 .tmp 再改名', () => {
  it('写的是 .tmp，随后才改名成 .json', async () => {
    const fs = await import('fs');
    fs.writeFileSync.mockClear();
    fs.renameSync.mockClear();

    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 1, classes: [], students: [], schedules: [] });
    expect(res.status).toBe(200);

    const written = fs.writeFileSync.mock.calls.map(c => String(c[0]));
    const snapshotWrites = written.filter(p => p.includes('snapshot') || p.endsWith('.tmp') || p.endsWith('.json'));
    expect(snapshotWrites.length).toBeGreaterThan(0);
    // 落盘的第一步必须是 .tmp，绝不能直接写 .json
    for (const w of snapshotWrites) expect(w.endsWith('.tmp')).toBe(true);

    // 然后才改名，且是从同一个 .tmp 改到 .json
    expect(fs.renameSync).toHaveBeenCalled();
    const [from, to] = fs.renameSync.mock.calls[0].map(String);
    expect(to.endsWith('.json')).toBe(true);
    // 临时名就是正式名后面加 .tmp（<base>.json.tmp -> <base>.json），
    // 这样计数用的 .json 后缀匹配不到它，残文件也就占不掉配额。
    expect(from).toBe(`${to}.tmp`);
  });
});

// 空串是界面上最普通的情况：StudentList 的表单把 birthDate 初始化成 ''，
// 而 validateCreateStudent 的 optional({ checkFalsy: true }) 会放行它，
// 所以每一个"没填出生日期"的学生存的都是 ''。还原时如果不把 '' 排除在校验之外，
// 一次健康库的备份→还原会把这些行全都算成"坏值"，回一句
// cleared: { studentBirthDates: N }，并把 '' 悄悄改写成 null。
describe('还原时空串的出生日期不算坏值', () => {
  it('全是空串时不报清理，也不改写成 null', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({
        version: 1, classes: [], schedules: [],
        students: [
          { id: 1, name: '没填生日A', birthDate: '' },
          { id: 2, name: '没填生日B', birthDate: '' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.cleared?.studentBirthDates).toBeUndefined();

    const { students } = await import('../db/schema.js');
    const rows = drizzleDb.select().from(students).all();
    expect(rows.map(r => r.birthDate).sort()).toEqual(['', '']);
  });

  // 对照：真正的坏值仍然要被清掉并报出来，否则上面那条也可能只是"这段逻辑整个没了"。
  it('真正的坏值仍然被清掉并计数', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({
        version: 1, classes: [], schedules: [],
        students: [
          { id: 1, name: '空串', birthDate: '' },
          { id: 2, name: '坏值', birthDate: '不是日期' },
          { id: 3, name: '好值', birthDate: '1990-05-01' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.cleared.studentBirthDates).toBe(1);

    const { students } = await import('../db/schema.js');
    const rows = drizzleDb.select().from(students).all();
    const byName = Object.fromEntries(rows.map(r => [r.name, r.birthDate]));
    expect(byName).toEqual({ 空串: '', 坏值: null, 好值: '1990-05-01' });
  });
});

describe('POST /api/backup/restore', () => {
  it('rejects invalid data', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send('not json');
    expect(res.status).toBe(400);
  });

  it('rejects wrong version', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 99, classes: [], students: [], schedules: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('版本');
  });

  // 三张必需表要一张张试。只发 {version:1} 的话循环在 classes 上就返回了，
  // students / schedules 两条永远走不到——把 schedules 从必需列表里删掉，用例照样绿。
  // 而还原是「先删后写」：少了 schedules 键的备份会被收下，教师整张排课表被清空，
  // 接口还回 200 {restored:{schedules:0}}。
  it.each(['classes', 'students', 'schedules'])('缺 %s 时拒绝还原', async (missing) => {
    const body = { version: 1, classes: [], students: [], schedules: [] };
    delete body[missing];
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`备份数据缺少 ${missing} 或格式不正确`);
  });

  // 数组里混进 null / 标量 / 嵌套数组时，pick() 会在 r.classId 上炸成一个带堆栈的
  // 空体 500（schedules:[null]），或者更糟——classStudents:['x'] 一路走到底，
  // 返回 200 而那一行被悄悄吞掉，用户以为还原成功了。必须当场说清是哪张表坏了。
  it.each([
    ['null 元素', 'schedules', [null]],
    ['标量元素', 'classStudents', ['x']],
    ['嵌套数组', 'holidays', [[]]],
    ['必需表里的标量', 'classes', [1]],
  ])('拒绝 %s 并指出是哪张表', async (_label, table, rows) => {
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 1, classes: [], students: [], schedules: [], [table]: rows });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`${table} 中存在非对象元素`);
  });

  it('restores data atomically', async () => {
    const { classes, schedules } = await import('../db/schema.js');
    const cls = drizzleDb.insert(classes).values({
      teacherId, name: '旧班级', grade: '初三', subject: '数学', studentCount: 2, unitPrice: 600,
    }).run();
    const oldClassId = Number(cls.lastInsertRowid);
    drizzleDb.insert(schedules).values({
      classId: oldClassId, date: '2026-04-01', startTime: '08:00', endTime: '10:00', durationBilling: 120,
    }).run();

    const backup = {
      version: 1,
      classes: [{ id: 10, teacherId, name: '新班级', grade: '高三', subject: '物理', studentCount: 1, unitPrice: 900 }],
      students: [],
      schedules: [{ id: 20, classId: 10, date: '2026-05-01', startTime: '14:00', endTime: '16:00', durationBilling: 120 }],
      classStudents: [],
      holidays: [],
      semesters: [],
      pricingTiers: [],
    };

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(backup);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.restored.classes).toBe(1);
    expect(res.body.restored.schedules).toBe(1);

    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.classes).toHaveLength(1);
    expect(exported.classes[0].name).toBe('新班级');
    expect(exported.schedules).toHaveLength(1);
  });

  it('replaces an existing class that has pricing history', async () => {
    const { classes, classPricing } = await import('../db/schema.js');
    const cls = drizzleDb.insert(classes).values({
      teacherId, name: '旧班级', grade: '初三', subject: '数学', studentCount: 2, unitPrice: 600,
    }).run();
    const oldClassId = Number(cls.lastInsertRowid);
    drizzleDb.insert(classPricing).values({
      classId: oldClassId, studentCount: 2, unitPrice: 600, effectiveFrom: '2026-01-01',
    }).run();

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1,
      classes: [{ id: 10, teacherId, name: '新班级', grade: '高三', subject: '物理', studentCount: 1, unitPrice: 900 }],
      students: [], schedules: [], classStudents: [], holidays: [], semesters: [], pricingTiers: [],
      classPricing: [{ id: 20, classId: 10, studentCount: 1, unitPrice: 900, effectiveFrom: '2026-02-01' }],
    });

    expect(res.status).toBe(200);
    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.classes.map(c => c.name)).toEqual(['新班级']);
    expect(exported.classPricing).toHaveLength(1);
    expect(exported.classPricing[0].classId).toBe(exported.classes[0].id);
  });

  it('remaps IDs that collide with another teacher while preserving relationships', async () => {
    const { classes } = await import('../db/schema.js');
    const { id: teacherId2, token: token2 } = await makeUser(drizzleDb, 'collision-owner');
    const other = drizzleDb.insert(classes).values({
      id: 50, teacherId: teacherId2, name: '他人班级', grade: '高一', subject: '数学', studentCount: 1, unitPrice: 100,
    }).run();
    expect(Number(other.lastInsertRowid)).toBe(50);

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1,
      classes: [{ id: 50, teacherId, name: '恢复班级', grade: '高三', subject: '物理', studentCount: 1, unitPrice: 900 }],
      students: [],
      schedules: [{ id: 70, classId: 50, date: '2026-05-01', startTime: '14:00', endTime: '16:00', durationBilling: 120 }],
      classStudents: [], holidays: [], semesters: [], pricingTiers: [], classPricing: [],
    });

    expect(res.status).toBe(200);
    const mine = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(mine.classes[0].id).not.toBe(50);
    expect(mine.schedules[0].classId).toBe(mine.classes[0].id);
    const theirs = (await request(app).get('/api/backup').set(auth(token2))).body;
    expect(theirs.classes).toEqual([expect.objectContaining({ id: 50, name: '他人班级' })]);
  });

  it('rejects duplicate relationship IDs before replacing current data', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1,
      classes: [
        { id: 1, name: 'A', grade: '高一', subject: '数学', studentCount: 1, unitPrice: 100 },
        { id: 1, name: 'B', grade: '高二', subject: '物理', studentCount: 1, unitPrice: 100 },
      ],
      students: [], schedules: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('唯一正整数');
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/backup/restore')
      .send({ version: 1, classes: [], students: [], schedules: [] });
    expect(res.status).toBe(401);
  });

  it('skips schedules with invalid classId references', async () => {
    const backup = {
      version: 1,
      classes: [{ id: 1, teacherId, name: '班', grade: '高三', subject: '数学', studentCount: 1, unitPrice: 100 }],
      students: [],
      schedules: [
        { id: 1, classId: 1, date: '2026-05-01', startTime: '09:00', endTime: '11:00', durationBilling: 120 },
        { id: 2, classId: 999, date: '2026-05-02', startTime: '09:00', endTime: '11:00', durationBilling: 120 },
      ],
      classStudents: [],
      holidays: [],
      semesters: [],
      pricingTiers: [],
    };

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(backup);
    expect(res.status).toBe(200);
    expect(res.body.restored.classes).toBe(1);
    expect(res.body.restored.schedules).toBe(1);

    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.schedules).toHaveLength(1);
    expect(exported.schedules[0].date).toBe('2026-05-01');
  });

  it('exports and restores audit log', async () => {
    const { auditLog } = await import('../db/schema.js');
    drizzleDb.insert(auditLog).values({
      teacherId, action: 'CREATE', tableName: 'classes', recordId: 1,
      timestamp: new Date().toISOString(), afterData: JSON.stringify({ name: 'audited' }),
    }).run();

    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.auditLog).toHaveLength(1);
    expect(exported.auditLog[0].action).toBe('CREATE');

    // Restore with the audit log preserved
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      ...exported,
      classes: [], students: [], schedules: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.restored.auditLog).toBe(1);
  });

  it('restore does not affect other teacher data', async () => {
    const { classes } = await import('../db/schema.js');
    // Teacher A has a class
    drizzleDb.insert(classes).values({
      teacherId, name: 'A的班级', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
    }).run();

    // Teacher B has a class
    const { id: teacherId2, token: token2 } = await makeUser(drizzleDb, 'teacherB');
    drizzleDb.insert(classes).values({
      teacherId: teacherId2, name: 'B的班级', grade: '高二', subject: '物理', studentCount: 2, unitPrice: 600,
    }).run();

    // Teacher A restores empty backup
    await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1, classes: [], students: [], schedules: [],
      classStudents: [], holidays: [], semesters: [], pricingTiers: [],
    });

    // Teacher B's data should be intact
    const exportB = await request(app).get('/api/backup').set(auth(token2));
    expect(exportB.body.classes).toHaveLength(1);
    expect(exportB.body.classes[0].name).toBe('B的班级');
  });

  it('clears report cache after restore', async () => {
    const cacheKey = { teacherId, start: '2026-05-01', end: '2026-05-31' };
    setReportCache(cacheKey, { count: 99 });
    expect(getReportCache(cacheKey)).toEqual({ count: 99 });

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1,
      classes: [],
      students: [],
      schedules: [],
      classStudents: [],
      holidays: [],
      semesters: [],
      pricingTiers: [],
    });

    expect(res.status).toBe(200);
    expect(getReportCache(cacheKey)).toBeNull();
  });
});

describe('pre-restore snapshot retention', () => {
  it('keeps only the 5 newest snapshots and unlinks the rest', async () => {
    // Seven existing snapshots with descending mtimes: snap-0 newest ... snap-6 oldest.
    // 文件名带教师 id：数量限制是每人一份，别人连着还原不能把你的回滚点挤没。
    const names = Array.from({ length: 7 }, (_, i) => `.backup_pre_restore_${teacherId}_${i}.json`);
    fsMocks.readdirSync.mockReturnValue(names);
    fsMocks.statSync.mockImplementation((p) => {
      const idx = names.findIndex(n => p.endsWith(n));
      return { mtimeMs: 1000 - idx }; // lower index = newer
    });

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1,
      classes: [],
      students: [],
      schedules: [],
      classStudents: [],
      holidays: [],
      semesters: [],
      pricingTiers: [],
    });
    expect(res.status).toBe(200);

    expect(fsMocks.unlinkSync).toHaveBeenCalledTimes(2);
    const unlinked = fsMocks.unlinkSync.mock.calls.map(c => c[0]);
    expect(unlinked.some(p => p.endsWith(names[5]))).toBe(true);
    expect(unlinked.some(p => p.endsWith(names[6]))).toBe(true);
    expect(unlinked.some(p => p.endsWith(names[0]))).toBe(false);
  });

  it('never unlinks unrelated files in the data directory', async () => {
    fsMocks.readdirSync.mockReturnValue(['data.db', `.backup_pre_restore_${teacherId}_a.json`]);
    fsMocks.statSync.mockImplementation((p) => ({
      mtimeMs: p.endsWith('_a.json') ? 1 : 2,
    }));

    await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1, classes: [], students: [], schedules: [],
      classStudents: [], holidays: [], semesters: [], pricingTiers: [],
    });

    const unlinked = fsMocks.unlinkSync.mock.calls.map(c => c[0]);
    expect(unlinked.some(p => p.endsWith('data.db'))).toBe(false);
  });

  // 外部删掉一个文件（手动清理、卷 GC）时 unlink 会 ENOENT；不各自容错的话，
  // 剩下的清理全停，配额静静地不再生效。
  it('单个文件删不掉时不中断其余清理', async () => {
    const names = Array.from({ length: 7 }, (_, i) => `.backup_pre_restore_${teacherId}_${i}.json`);
    fsMocks.readdirSync.mockReturnValue(names);
    fsMocks.statSync.mockImplementation((p) => ({ mtimeMs: 1000 - names.findIndex(n => String(p).endsWith(n)) }));
    fsMocks.unlinkSync.mockClear();
    fsMocks.unlinkSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1, classes: [], students: [], schedules: [],
      classStudents: [], holidays: [], semesters: [], pricingTiers: [],
    });
    expect(res.status).toBe(200);
    // 两份超额的都试过，第一份抛了也不影响第二份
    expect(fsMocks.unlinkSync).toHaveBeenCalledTimes(2);
  });

  it('不动别的教师的快照', async () => {
    const mine = Array.from({ length: 7 }, (_, i) => `.backup_pre_restore_${teacherId}_${i}.json`);
    const theirs = Array.from({ length: 7 }, (_, i) => `.backup_pre_restore_${teacherId + 1}_${i}.json`);
    fsMocks.readdirSync.mockReturnValue([...mine, ...theirs]);
    fsMocks.statSync.mockImplementation((p) => ({ mtimeMs: p.endsWith('_0.json') ? 100 : 1, size: 1024 }));

    await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1, classes: [], students: [], schedules: [],
      classStudents: [], holidays: [], semesters: [], pricingTiers: [],
    });

    const unlinked = fsMocks.unlinkSync.mock.calls.map(c => String(c[0]));
    expect(unlinked.every(p => p.includes(`.backup_pre_restore_${teacherId}_`))).toBe(true);
    expect(unlinked.some(p => p.includes(`.backup_pre_restore_${teacherId + 1}_`))).toBe(false);
  });

  // 配额只数 .json。上面那条 .tmp 用例把文件挂在别的教师名下，根本进不了
  // 本教师的配额列表，所以把 .endsWith('.json') 整句删掉它也不会红。
  // 自己名下的一个 .tmp 掉进配额的话，它（mtime 最新）占一个名额，
  // 把第 5 份真正的回滚点挤掉。
  it('本教师的 .tmp 不占快照配额', async () => {
    const jsons = Array.from({ length: 5 }, (_, i) => `.backup_pre_restore_${teacherId}_${i}.json`);
    const ownTmp = `.backup_pre_restore_${teacherId}_writing.json.tmp`;
    fsMocks.readdirSync.mockReturnValue([...jsons, ownTmp]);
    const now = Date.now();
    // .tmp 最新（排在配额列表首位），且足够新、不会被陈旧 .tmp 那一轮扫走，
    // 所以它如果被删，只能是因为进了配额。
    fsMocks.statSync.mockImplementation((p) => ({
      mtimeMs: String(p).endsWith('.tmp') ? now : now - (1000 * (5 - Number(String(p).slice(-6, -5) || 0))),
      size: 1024,
    }));

    await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1, classes: [], students: [], schedules: [],
      classStudents: [], holidays: [], semesters: [], pricingTiers: [],
    });

    const unlinked = fsMocks.unlinkSync.mock.calls.map(c => String(c[0]));
    // 正好 5 份 .json，没超额，一份都不该删。
    // .tmp 掉进配额的话列表就是 6 项，而它 mtime 最新、排在首位，
    // 被 slice 掉的反而是最旧的那份真快照——断言得盯这个，
    // 而不是「.tmp 没被删」（那一条两种实现都成立）。
    expect(unlinked.filter(p => p.endsWith('.json')).length).toBe(0);
  });

  // 残留 .tmp 的清理是不分教师的，所以可能扫到另一个进程正写到一半的那一个
  // （同一进程内 write→rename 同步，插不进来；两个进程共用 dbDir 时不一定）。
  // 删中了对方就是 renameSync 抛 ENOENT、一份好备份被判 500，所以只收旧的。
  it('只清理陈旧的 .tmp，不碰刚写下的', async () => {
    const fresh = `.backup_pre_restore_${teacherId + 1}_fresh.json.tmp`;
    const stale = `.backup_pre_restore_${teacherId + 1}_stale.json.tmp`;
    fsMocks.readdirSync.mockReturnValue([fresh, stale]);
    const now = Date.now();
    fsMocks.statSync.mockImplementation((p) => ({
      mtimeMs: String(p).includes('_fresh') ? now : now - 2 * 60 * 60 * 1000,
      size: 1024,
    }));

    await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1, classes: [], students: [], schedules: [],
      classStudents: [], holidays: [], semesters: [], pricingTiers: [],
    });

    const unlinked = fsMocks.unlinkSync.mock.calls.map(c => String(c[0]));
    expect(unlinked.some(p => p.endsWith(stale))).toBe(true);
    expect(unlinked.some(p => p.endsWith(fresh))).toBe(false);
  });
});

// 备份文件里的日期直接进库，不经过 body 校验：越界/乱码日期落进去之后，
// 所有视图都按区间查询，这些行既看不到也删不掉。旧版本服务端收过这种值，
// 所以不能整单拒——那样恰恰是需要回滚的人还原不了自己的快照。
describe('还原时的日期校验', () => {
  const baseBackup = (overrides) => ({
    version: 1,
    classes: [{ id: 10, name: '新班级', grade: '高三', subject: '物理', studentCount: 1, unitPrice: 900 }],
    students: [],
    schedules: [{ id: 20, classId: 10, date: '2026-05-01', startTime: '14:00', endTime: '16:00', durationBilling: 120 }],
    classStudents: [],
    holidays: [],
    semesters: [],
    pricingTiers: [],
    ...overrides,
  });

  it.each([
    ['schedules.date 越界', { schedules: [{ id: 20, classId: 10, date: '0261-01-01', startTime: '14:00', endTime: '16:00', durationBilling: 120 }] }, { schedules: 1 }],
    ['schedules.date 乱码', { schedules: [{ id: 20, classId: 10, date: 'not-a-date', startTime: '14:00', endTime: '16:00', durationBilling: 120 }] }, { schedules: 1 }],
    ['holidays 越界', { holidays: [{ id: 1, date: '3000-01-01', type: 'holiday', name: '越界' }] }, { holidays: 1 }],
  ])('%s 时丢掉该行并报数，其余照常还原', async (_label, overrides, expectedSkipped) => {
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(baseBackup(overrides));
    expect(res.status).toBe(200);
    expect(res.body.skipped).toEqual(expectedSkipped);
    // 班级照常还原：坏行不能把整个文件挡在门外
    expect(res.body.restored.classes).toBe(1);
    // skipped 点名的每张表都要有对应的 restored 数字，否则看不出丢了几分之几
    for (const table of Object.keys(res.body.skipped)) {
      expect(res.body.restored[table]).toBeTypeOf('number');
    }
  });

  it('日期字段是数组时不会抛 500', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(baseBackup({
      schedules: [{ id: 20, classId: 10, date: ['2026-05-01'], startTime: '14:00', endTime: '16:00', durationBilling: 120 }],
    }));
    expect(res.status).toBe(200);
    expect(res.body.skipped).toEqual({ schedules: 1 });
  });

  // 出生日期不参与区间查询，所以不卡上下限，只拦日历上站不住的值；
  // 而且只清这一个字段，不因此丢掉整个学生
  it.each([
    ['乱码', 'nope', true],
    ['日历上不存在', '2026-02-31', true],
    ['越界但合法的旧值', '0261-01-01', false],
    ['越界的年份', '1850', false],
    ['只写年份', '2010', false],
    ['留空', null, false],
  ])('students.birthDate %s', async (_label, birthDate, cleared) => {
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(baseBackup({
      students: [{ id: 1, name: 'A', birthDate }],
    }));
    expect(res.status).toBe(200);
    expect(res.body.restored.students).toBe(1);
    // 清字段不是丢行，分开报：skipped 的每个 key 都得能在 restored 里找到对应总数
    expect(res.body.cleared?.studentBirthDates).toBe(cleared ? 1 : undefined);
    expect(res.body.skipped).toBeUndefined();

    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.students[0].birthDate).toBe(cleared ? null : (birthDate ?? null));
  });

  // classId 没命中的行如果流到插入，classIdMap.get() 给出 undefined，而 class_id 是
  // notNull 外键：一条孤儿行就能把整个事务回滚成 500，用户根本还原不了。
  it.each([
    ['classPricing', { classPricing: [{ id: 1, classId: 999, studentCount: 1, unitPrice: 900, effectiveFrom: '2026-02-01' }] }],
    ['classStudents', { students: [{ id: 5, name: 'A' }], classStudents: [{ classId: 999, studentId: 5 }] }],
  ])('%s 引用不存在的班级时丢掉该行，不让整个还原 500', async (table, overrides) => {
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(baseBackup(overrides));
    expect(res.status).toBe(200);
    expect(res.body.skipped[table]).toBe(1);
    expect(res.body.restored.classes).toBe(1);
  });

  // 快照是撤销用的，要把库恢复到还原之前。原来库里就有的越界行也一并剔掉的话，
  // 这个「撤销」并没回到原状——恰恰是出了事才用到它的人最不能接受的。
  //
  // 内容从磁盘读，所以拿一个还活着的 id 配一份伪造的备份是绕不过去的。
  const SNAPSHOT_ID = '0f9f4b2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b';

  it('还原前快照不剔越界日期，且内容取自磁盘', async () => {
    const legacy = baseBackup({
      schedules: [{ id: 20, classId: 10, date: '0261-01-01', startTime: '14:00', endTime: '16:00', durationBilling: 120 }],
      holidays: [{ id: 1, date: '3000-01-01', type: 'holiday', name: '越界' }],
      students: [{ id: 5, name: 'A', birthDate: '2026-02-31' }],
    });

    // 普通备份：该剔的剔、该清的清
    const dropped = await request(app).post('/api/backup/restore').set(auth(token)).send(legacy);
    expect(dropped.body.skipped).toEqual({ schedules: 1, holidays: 1 });
    expect(dropped.body.cleared).toEqual({ studentBirthDates: 1 });

    // 快照：请求体里只给 id，内容服务端自己读
    fsMocks.existsSync.mockImplementation((path) => String(path).includes(SNAPSHOT_ID));
    fsMocks.readFileSync.mockImplementation(() => JSON.stringify({ ...legacy, teacherId }));
    const kept = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 1, undoSnapshot: SNAPSHOT_ID });
    expect(kept.status).toBe(200);
    expect(kept.body.skipped).toBeUndefined();
    expect(kept.body.cleared).toBeUndefined();
    expect(kept.body.restored.schedules).toBe(1);
    expect(kept.body.restored.holidays).toBe(1);

    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.students[0].birthDate).toBe('2026-02-31');

    // 撤销自身不写快照，所以不能报一个磁盘上不存在的回滚点：
    // 客户端拿它再撤销只会得到 404，「撤销」按钮就是个死键。
    expect(kept.body.preRestoreSnapshot).toBeUndefined();
  });

  // 快照文件自己带着 preRestoreSnapshot 字段。触发撤销的是另一个字段，否则把这份
  // 文件当普通备份 POST 回来会被当成撤销请求，而磁盘上那份早没了——手里握着数据却 404。
  it('直接 POST 快照文件的内容仍当普通备份还原', async () => {
    fsMocks.existsSync.mockImplementation(() => false);
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      ...baseBackup({}),
      preRestoreSnapshot: '11111111-2222-3333-4444-555555555555',
      teacherId,
    });
    expect(res.status).toBe(200);
    expect(res.body.restored.classes).toBe(1);
  });

  // 截断的写入仍可能解出合法 JSON（null），不再查一遍就是一个带堆栈的 500
  it.each(['null', '"不是对象"'])('快照文件内容为 %s 时给出干净的错误', async (content) => {
    fsMocks.existsSync.mockImplementation((path) => String(path).includes(SNAPSHOT_ID));
    fsMocks.readFileSync.mockImplementation(() => content);
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 1, undoSnapshot: SNAPSHOT_ID });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('快照文件无法读取');
  });

  // 读快照是同步的，写的时候又不卡大小，所以超过上限时要明说原因而不是默默堵着
  // 写到一半失败会留下一个名字合法但读不出来的文件，下次清理时它会挤掉真正的回滚点
  it('快照写入失败时清掉半成品', async () => {
    const fs = await import('fs');
    fs.writeFileSync.mockImplementationOnce(() => { throw new Error('ENOSPC'); });
    fsMocks.unlinkSync.mockClear();

    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(baseBackup({}));
    expect(res.status).toBe(500);
    const unlinked = fsMocks.unlinkSync.mock.calls.map(c => String(c[0]));
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toContain(`.backup_pre_restore_${teacherId}_`);
    // 后缀必须钉死：只看前缀的话，.json 和 .json.tmp 都能满足，
    // 两者调反了这条用例照样绿——而它们的后果是相反的。
    // 写到一半失败，该删的是半成品 .json.tmp。
    expect(unlinked[0].endsWith('.json.tmp')).toBe(true);
  });

  it('快照文件过大时返回 413', async () => {
    fsMocks.existsSync.mockImplementation((path) => String(path).includes(SNAPSHOT_ID));
    fsMocks.statSync.mockImplementation(() => ({ mtimeMs: 0, size: 60 * 1024 * 1024 }));
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 1, undoSnapshot: SNAPSHOT_ID });
    expect(res.status).toBe(413);
    // 光看状态码不够：这条路由前面还有 body-parser 的 50MB 413，换成那一个
    // 状态码一模一样。得确认说的是"快照太大"这件事。
    expect(res.body.error).toMatch(/快照/);
  });

  it('还原成功时返回快照 id，否则撤销路径根本无从进入', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(baseBackup({}));
    expect(res.status).toBe(200);
    expect(res.body.preRestoreSnapshot).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  // 写快照不卡大小，读回来卡 50 MB。数据超过这个数的教师要是拿到 preRestoreSnapshot，
  // 拿回来只会换一句 413——而它本该保护的数据已经被覆盖了。宁可不发这个句柄。
  it('快照大到撤销读不回来时，不发一个注定被拒的 preRestoreSnapshot', async () => {
    fsMocks.statSync.mockImplementation(() => ({ mtimeMs: 0, size: 51 * 1024 * 1024 }));
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(baseBackup({}));
    expect(res.status).toBe(200);
    expect(res.body.preRestoreSnapshot).toBeUndefined();
    expect(res.body.preRestoreSnapshotUnavailable).toContain('50 MB');
  });

  // 失败的还原没改动过数据，那份快照是多余的；留着的话重试几次就把真正的回滚点挤没了
  it('还原失败时不消耗回滚点', async () => {
    fsMocks.unlinkSync.mockClear();
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(baseBackup({
      schedules: [{ id: 20, classId: 10, startTime: '14:00', endTime: '16:00', durationBilling: 120 }],
    }));
    expect(res.status).toBe(500);
    // 删的是刚写的那份，而不是清理掉旧的
    const unlinked = fsMocks.unlinkSync.mock.calls.map(c => String(c[0]));
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toContain(`.backup_pre_restore_${teacherId}_`);
    // 这一步删的是已经写完的快照本体（.json）。删成 .json.tmp 的话，
    // 那份多余的快照就留在磁盘上，重试几次坏备份就把真正的回滚点挤光了
    // ——正是这条用例的名字。只比前缀分不出这两种。
    expect(unlinked[0].endsWith('.json')).toBe(true);
  });

  it.each([
    ['光写 true 不算', true, 400],
    ['格式不对不算', 'not-a-uuid', 400],
    ['路径穿越不算', '../../etc/passwd', 400],
    ['文件已被清理时明确报错，而不是静默按普通备份处理', '11111111-2222-3333-4444-555555555555', 404],
  ])('undoSnapshot %s', async (_label, value, status) => {
    fsMocks.existsSync.mockImplementation((path) => String(path).includes(SNAPSHOT_ID));
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 1, undoSnapshot: value });
    expect(res.status).toBe(status);
  });

  // 触发撤销看的是「这个字段在不在」，不是它真不真。写成 if (data.undoSnapshot) 的话，
  // undoSnapshot: null 这种明显是想撤销、只是值取错了的请求会被当成一次普通的内容还原，
  // 而请求体里那几张空表会把库清光，并且回 200——调用方以为撤销成功了，数据没了。
  it.each([['null', null], ['空字符串', ''], ['false', false], ['0', 0]])(
    'undoSnapshot 是 %s 时报 400，而不是当成普通还原把数据清光', async (_label, value) => {
      const { classes } = await import('../db/schema.js');
      drizzleDb.insert(classes).values({
        teacherId, name: '不该消失的班', grade: '高三', subject: '数学', studentCount: 3, unitPrice: 800,
      }).run();

      const res = await request(app).post('/api/backup/restore').set(auth(token))
        .send({ version: 1, undoSnapshot: value, classes: [], students: [], schedules: [] });
      expect(res.status).toBe(400);

      const after = await request(app).get('/api/backup').set(auth(token));
      expect(after.body.classes).toHaveLength(1);
    });

  // existsSync 和读之间文件没了（两个撤销请求撞一起，或者旁边一次成功还原把它
  // 当配额清了）仍然是「快照不在了」。报 500 的话调用方分不出它和「服务器坏了」。
  it('读快照时文件刚被删掉，还是 404 而不是 500', async () => {
    fsMocks.existsSync.mockImplementation((path) => String(path).includes(SNAPSHOT_ID));
    fsMocks.statSync.mockImplementation(() => {
      const err = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      throw err;
    });
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 1, undoSnapshot: SNAPSHOT_ID });
    expect(res.status).toBe(404);
  });

  it('schedules.date 是显式 null 时丢行而不是 500', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(baseBackup({
      schedules: [{ id: 20, classId: 10, date: null, startTime: '14:00', endTime: '16:00', durationBilling: 120 }],
    }));
    expect(res.status).toBe(200);
    expect(res.body.skipped).toEqual({ schedules: 1 });
  });

  it.each(['schedules', 'holidays'])('%s 缺少 date 列时整单报错，原数据不动', async (table) => {
    const { classes } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '旧班级', grade: '初三', subject: '数学', studentCount: 2, unitPrice: 600,
    }).run();

    const rows = table === 'schedules'
      ? [{ id: 20, classId: 10, startTime: '14:00', endTime: '16:00', durationBilling: 120 }]
      : [{ id: 1, type: 'holiday', name: '没有日期' }];
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send(baseBackup({ [table]: rows }));

    expect(res.status).toBe(500);
    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.classes).toHaveLength(1);
    expect(exported.classes[0].name).toBe('旧班级');
  });

  it('全部合法时不带 skipped 字段', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(baseBackup({
      schedules: [{ id: 20, classId: 10, date: '1900-01-01', startTime: '14:00', endTime: '16:00', durationBilling: 120 }],
      semesters: [{ id: 1, name: '边界', type: 'spring', startDate: '1900-01-01', endDate: '2999-12-31' }],
    }));
    expect(res.status).toBe(200);
    expect(res.body.restored.schedules).toBe(1);
    expect(res.body.skipped).toBeUndefined();
    expect(res.body.cleared).toBeUndefined();
  });

  // semesters 和 classPricing 的越界/倒挂行不丢：两个列表接口都不按日期过滤，
  // 用户在学期管理/定价历史里看得见也改得了；定价还进 matchPricing，丢了会悄悄
  // 改变报表收入——一次本应无损的导出-还原往返不能改数据。
  it.each([
    ['倒挂的学期', { semesters: [{ id: 1, name: '倒挂', type: 'spring', startDate: '2026-12-01', endDate: '2026-01-01' }] }],
    ['越界的学期', { semesters: [{ id: 1, name: '越界', type: 'spring', startDate: '1899-09-01', endDate: '1900-01-15' }] }],
    // 不是日期的字符串也不丢：前端的 getDefaultScheduleRange /
    // getDefaultsFromSemesters 自己会把这种行筛掉，不靠还原把它删掉。
    ['只有年份的学期', { semesters: [{ id: 1, name: '年份', type: 'spring', startDate: '2026', endDate: '2026' }] }],
    ['越界的定价', { classPricing: [{ id: 1, classId: 10, studentCount: 1, unitPrice: 900, effectiveFrom: '0261-01-01' }] }],
  ])('%s 照常还原，不计入 skipped', async (_label, overrides) => {
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(baseBackup(overrides));
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBeUndefined();
    const table = Object.keys(overrides)[0];
    expect(res.body.restored[table]).toBe(1);
  });
});

// 还原时每张表都用一份白名单 pick() 掉未知字段。名单少一个字段，那一列就在
// 「导出-还原」之后静默变成 null/默认值：手机号、节假日名称、档位单价、优惠金额
// ——接口照样回 200，而备份恰恰是出事之后唯一的退路。
// 逐字段写断言会漏掉下一个新增的列，所以直接拿 drizzle schema 当真源：
// 每一列都塞一个和默认值不同的值，走一遍往返，再整行比对。
describe('导出-还原的字段保真', () => {
  // 还原会重新分配主键并重映射外键，这几列本来就该变。
  const REMAPPED = new Set(['id', 'classId', 'studentId']);

  const stripIds = rows => rows
    .map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !REMAPPED.has(k))))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  async function seedEveryColumn() {
    const schema = await import('../db/schema.js');
    const cls = drizzleDb.insert(schema.classes).values({
      teacherId, name: '竞赛班', grade: '高三', subject: '数学', studentCount: 4,
      unitPrice: 880.5, discountAmount: 60.25, discountReason: '老生续费',
      isCompetition: true, defaultLocationName: '一号教室',
      defaultLocationLat: 31.2304, defaultLocationLng: 121.4737,
      deleted: true, createdAt: '2026-01-02 03:04:05',
    }).run();
    const classId = Number(cls.lastInsertRowid);
    // 学生 id 显式给成 101/102，让它和班级 id（1/2）错开。真实库里这两个序列
    // 各涨各的、极少对齐，而全新的测试库两边都从 1 开始——一旦对齐，
    // 「把 studentId 错用 classIdMap 去映射」这种接错人的还原会返回同一个数字，
    // 任何断言都看不出来（第 28 轮正是这么发现这条用例是空的）。
    const stu = drizzleDb.insert(schema.students).values({
      id: 101,
      teacherId, name: '张三', birthDate: '2008-05-06', phone: '13800138000',
      parentName: '张父', parentPhone: '13900139000', note: '走读',
      createdAt: '2026-01-02 03:04:06',
    }).run();
    const studentId = Number(stu.lastInsertRowid);
    drizzleDb.insert(schema.classStudents).values({ classId, studentId }).run();

    // 第二个班和第二个学生只为一件事：让「关系接错人」这种错有地方可接。
    // 只有一条关系时，还原把 studentId 映射成 classId 也照样指回唯一那个人，
    // 任何断言都看不出来。第二个学生不进任何班，所以关系表仍只有一行。
    drizzleDb.insert(schema.classes).values({
      teacherId, name: '语文班', grade: '高二', subject: '语文', studentCount: 2,
      unitPrice: 700, discountAmount: 0, discountReason: null, isCompetition: false,
      defaultLocationName: null, defaultLocationLat: null, defaultLocationLng: null,
      deleted: false, createdAt: '2026-01-02 03:04:12',
    }).run();
    drizzleDb.insert(schema.students).values({
      id: 102, teacherId, name: '李四', createdAt: '2026-01-02 03:04:13',
    }).run();
    // 李四也进竞赛班：一个班挂两个学生，还原把名单缩成一个人才看得出来。
    drizzleDb.insert(schema.classStudents).values({ classId, studentId: 102 }).run();
    drizzleDb.insert(schema.schedules).values({
      classId, date: '2026-05-01', startTime: '09:00', endTime: '11:00',
      durationBilling: 120, locationName: '二号教室',
      locationLat: 31.1, locationLng: 121.2, createdAt: '2026-01-02 03:04:07',
    }).run();
    drizzleDb.insert(schema.classPricing).values({
      classId, studentCount: 4, unitPrice: 880.5, discountAmount: 60.25,
      discountReason: '老生续费', effectiveFrom: '2026-03-01',
      createdAt: '2026-01-02 03:04:08',
    }).run();
    drizzleDb.insert(schema.pricingTiers).values({
      teacherId, minStudents: 2, maxStudents: 5, pricePerStudentPerHour: 245.75,
      createdAt: '2026-01-02 03:04:09',
    }).run();
    drizzleDb.insert(schema.semesters).values({
      teacherId, name: '2026春季', type: 'spring',
      startDate: '2026-03-01', endDate: '2026-07-15', createdAt: '2026-01-02 03:04:10',
    }).run();
    drizzleDb.insert(schema.holidays).values({
      teacherId, date: '2026-02-17', type: 'holiday', name: '春节',
    }).run();
    drizzleDb.insert(schema.auditLog).values({
      teacherId, timestamp: '2026-01-02 03:04:11', action: 'UPDATE',
      tableName: 'classes', recordId: classId,
      beforeData: '{"unitPrice":800}', afterData: '{"unitPrice":880.5}',
    }).run();
    return schema;
  }

  const TABLES = ['classes', 'students', 'classStudents', 'schedules',
    'classPricing', 'pricingTiers', 'semesters', 'holidays', 'auditLog'];

  it('每张表的每一列都原样走完一次往返', async () => {
    await seedEveryColumn();

    const before = await request(app).get('/api/backup').set(auth(token));
    expect(before.status).toBe(200);
    for (const t of TABLES) {
      expect(before.body[t].length, t).toBe(['classes', 'students', 'classStudents'].includes(t) ? 2 : 1);
    }

    const restore = await request(app).post('/api/backup/restore').set(auth(token)).send(before.body);
    // 名单里少掉一个 notNull 列（如 pricePerStudentPerHour）会让插入失败、整单回滚成 500。
    expect(restore.status).toBe(200);

    const after = await request(app).get('/api/backup').set(auth(token));
    expect(after.status).toBe(200);
    for (const t of TABLES) {
      expect(stripIds(after.body[t]), `${t} 在往返后变了`).toEqual(stripIds(before.body[t]));
    }
  });

  // 上面那条比的是「列的值」，主键和外键都被 stripIds 摘掉了——而 classStudents
  // 一共就只有这两列，摘完就是拿 [{}] 和 [{}] 比，任何指错人的还原都看不出来。
  // 还原会重新分配主键，所以关系只能按名字比：把 id 翻译回班名/人名再对。
  it('还原后关系仍指向同一个班和同一个人，而不是被重映射到别人身上', async () => {
    await seedEveryColumn();

    const before = await request(app).get('/api/backup').set(auth(token));
    const restore = await request(app).post('/api/backup/restore').set(auth(token)).send(before.body);
    expect(restore.status).toBe(200);
    const after = await request(app).get('/api/backup').set(auth(token));

    // id → 名字，两边各翻一次，再比名字。
    const byName = (dump) => {
      const cls = new Map(dump.classes.map(c => [c.id, c.name]));
      const stu = new Map(dump.students.map(s => [s.id, s.name]));
      return {
        classStudents: dump.classStudents.map(l => [cls.get(l.classId), stu.get(l.studentId)]).sort(),
        schedules: dump.schedules.map(r => [cls.get(r.classId), r.date, r.startTime]).sort(),
        classPricing: dump.classPricing.map(p => [cls.get(p.classId), p.effectiveFrom, p.unitPrice]).sort(),
      };
    };

    expect(byName(after.body)).toEqual(byName(before.body));
    // 断言具体指向谁，而不只是「两边一样」——两边同时错成一样的话上一行也过。
    expect(byName(after.body).classStudents).toEqual([['竞赛班', '张三'], ['竞赛班', '李四']].sort());
    expect(byName(after.body).schedules).toEqual([['竞赛班', '2026-05-01', '09:00']]);
    expect(byName(after.body).classPricing).toEqual([['竞赛班', '2026-03-01', 880.5]]);
    // 名字解析不出来（外键指向了不存在的行）会变成 undefined，这里明确排掉。
    for (const pair of byName(after.body).classStudents) expect(pair).not.toContain(undefined);
  });

  // 上面那条只有在每一列都带着「和默认值不同的值」时才拦得住漏字段。
  // 这条保证新增的列不会悄悄漏出种子数据之外——否则它在往返里两边都是 null，
  // 比对永远相等，而还原名单少了它同样没人知道。
  it('种子数据覆盖了 schema 里的每一列', async () => {
    const schema = await seedEveryColumn();
    const { getTableColumns } = await import('drizzle-orm');
    const res = await request(app).get('/api/backup').set(auth(token));

    for (const t of TABLES) {
      const cols = Object.keys(getTableColumns(schema[t]));
      // 第一行才是种满每一列的那行；第二个班/学生是给关系断言用的，字段是空的。
      const row = res.body[t][0];
      expect(Object.keys(row).sort(), `${t} 导出的列与 schema 不一致`).toEqual(cols.sort());
      // 只查非空还不够：deleted/isCompetition/discountAmount 都有默认值，种子值撞上
      // 默认值的话，名单里漏掉这一列在往返两边都是同一个值，比对照样相等。
      const columns = getTableColumns(schema[t]);
      const weak = cols.filter(c => {
        const v = row[c];
        if (v === null || v === undefined) return true;
        const d = columns[c].default;
        return (typeof d === 'number' || typeof d === 'boolean' || typeof d === 'string') && v === d;
      });
      expect(weak, `${t} 的这些列没有种子值或与默认值相同，往返比对拦不住漏字段`).toEqual([]);
    }
  });
});

// 备份端点的教师隔离一直只有 classes 有断言（routes-backup.test.js 的
// "remaps IDs that collide" 和导出用例）。第 29 轮证实：把 classStudents /
// schedules / classPricing 三条导出查询的 where 去掉，1250 全绿——下载下来的
// 备份 JSON 里会带上别的教师的排课（日期、时间、地点、计费分钟）、师生关系和
// 定价历史，而界面上什么都看不出来。
describe('备份的教师隔离', () => {
  let otherId, otherToken;

  // 给另一个教师铺一份完整的数据，且 id 故意从 101 起，和本教师的错开。
  async function seedOtherTeacher() {
    const schema = await import('../db/schema.js');
    ({ id: otherId, token: otherToken } = await makeUser(drizzleDb, 'otherteacher'));
    drizzleDb.insert(schema.classes).values({
      id: 101, teacherId: otherId, name: '别人的班', grade: '高一', subject: '化学',
      studentCount: 5, unitPrice: 999,
    }).run();
    drizzleDb.insert(schema.students).values({
      id: 101, teacherId: otherId, name: '别人的学生', phone: '13700137000',
    }).run();
    drizzleDb.insert(schema.classStudents).values({ classId: 101, studentId: 101 }).run();
    drizzleDb.insert(schema.schedules).values({
      id: 101, classId: 101, date: '2026-06-01', startTime: '08:00', endTime: '09:00',
      durationBilling: 60, locationName: '别人的教室',
    }).run();
    drizzleDb.insert(schema.classPricing).values({
      id: 101, classId: 101, studentCount: 5, unitPrice: 999, effectiveFrom: '2026-01-01',
    }).run();
    drizzleDb.insert(schema.pricingTiers).values({
      id: 101, teacherId: otherId, minStudents: 1, maxStudents: 9, pricePerStudentPerHour: 999,
    }).run();
    drizzleDb.insert(schema.semesters).values({
      id: 101, teacherId: otherId, name: '别人的学期', type: 'spring',
      startDate: '2026-03-01', endDate: '2026-07-01',
    }).run();
    drizzleDb.insert(schema.holidays).values({
      id: 101, teacherId: otherId, date: '2026-04-05', type: 'holiday', name: '别人的假',
    }).run();
    drizzleDb.insert(schema.auditLog).values({
      id: 101, teacherId: otherId, timestamp: '2026-01-01 00:00:00', action: 'CREATE',
      tableName: 'classes', recordId: 101, beforeData: null, afterData: '{"secret":1}',
    }).run();
    return schema;
  }

  it('导出里不含另一个教师的任何一行', async () => {
    await seedOtherTeacher();
    const schema = await import('../db/schema.js');
    // 本教师自己也要有数据，否则 classIds 为空会走 [] 短路，测不到 where。
    const mine = drizzleDb.insert(schema.classes).values({
      teacherId, name: '我的班', grade: '高三', subject: '数学', studentCount: 1, unitPrice: 100,
    }).run();
    const myClassId = Number(mine.lastInsertRowid);
    drizzleDb.insert(schema.schedules).values({
      classId: myClassId, date: '2026-06-02',
      startTime: '10:00', endTime: '11:00', durationBilling: 60, locationName: '我的教室',
    }).run();
    // 关系表和定价也得有本教师自己的行，否则下面按引用查的两个循环一次都不跑。
    const myStu = drizzleDb.insert(schema.students).values({ teacherId, name: '我的学生' }).run();
    drizzleDb.insert(schema.classStudents).values({
      classId: myClassId, studentId: Number(myStu.lastInsertRowid),
    }).run();
    drizzleDb.insert(schema.classPricing).values({
      classId: myClassId, studentCount: 1, unitPrice: 100, effectiveFrom: '2026-02-01',
    }).run();

    const res = await request(app).get('/api/backup').set(auth(token));
    expect(res.status).toBe(200);

    for (const t of ['classes', 'students', 'classStudents', 'schedules',
      'classPricing', 'pricingTiers', 'semesters', 'holidays', 'auditLog']) {
      for (const row of res.body[t]) {
        if ('teacherId' in row) expect(row.teacherId, `${t} 混进了别的教师`).toBe(teacherId);
      }
    }
    // classStudents / schedules / classPricing 没有 teacherId 列，靠引用认：
    // 每一行指向的班级（和学生）都必须在这份导出自己的 classes/students 里。
    // 泄漏进来的行引用的是别人的班，id 落在集合外——这比找字符串靠谱，
    // classStudents 整行就只有两个数字，根本没有字符串可找。
    const myClassIds = new Set(res.body.classes.map(c => c.id));
    const myStudentIds = new Set(res.body.students.map(r => r.id));
    for (const t of ['schedules', 'classPricing', 'classStudents']) {
      for (const row of res.body[t]) {
        expect(myClassIds.has(row.classId), `${t} 引用了不属于本教师的班级 ${row.classId}`).toBe(true);
      }
    }
    for (const row of res.body.classStudents) {
      expect(myStudentIds.has(row.studentId), `classStudents 引用了别的教师的学生 ${row.studentId}`).toBe(true);
    }

    const body = JSON.stringify(res.body);
    for (const marker of ['别人的教室', '别人的班', '别人的学生', '别人的假', '别人的学期', '"secret"']) {
      expect(body, `导出里出现了 ${marker}`).not.toContain(marker);
    }
    expect(body).toContain('我的教室');
  });

  // 还原前快照和导出各写了一份教师过滤（backup.js 的 185/188/193 对 36/39/44），
  // 而快照是出事后唯一的退路。它漏进别人的行，撤销就会把别人的数据写进本教师账下。
  it('还原前快照里也不含另一个教师的任何一行', async () => {
    const schema = await seedOtherTeacher();
    const mine = drizzleDb.insert(schema.classes).values({
      teacherId, name: '我的班', grade: '高三', subject: '数学', studentCount: 1, unitPrice: 100,
    }).run();
    const myClassId = Number(mine.lastInsertRowid);
    drizzleDb.insert(schema.schedules).values({
      classId: myClassId, date: '2026-06-02', startTime: '10:00', endTime: '11:00',
      durationBilling: 60, locationName: '我的教室',
    }).run();
    const myStu = drizzleDb.insert(schema.students).values({ teacherId, name: '我的学生' }).run();
    drizzleDb.insert(schema.classStudents).values({
      classId: myClassId, studentId: Number(myStu.lastInsertRowid),
    }).run();
    drizzleDb.insert(schema.classPricing).values({
      classId: myClassId, studentCount: 1, unitPrice: 100, effectiveFrom: '2026-02-01',
    }).run();

    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 1, classes: [], students: [], schedules: [] });
    expect(res.status).toBe(200);

    const writes = fsMocks.writeFileSync.mock.calls.filter(c => String(c[0]).includes('pre_restore'));
    expect(writes).toHaveLength(1);
    const snap = JSON.parse(writes[0][1]);

    for (const t of ['classes', 'students', 'pricingTiers', 'semesters', 'holidays', 'auditLog']) {
      for (const row of snap[t] || []) expect(row.teacherId, `快照的 ${t} 混进了别的教师`).toBe(teacherId);
    }
    const snapClassIds = new Set(snap.classes.map(c => c.id));
    for (const t of ['schedules', 'classPricing', 'classStudents']) {
      expect((snap[t] || []).length, `快照的 ${t} 是空的，下面的循环白跑`).toBeGreaterThan(0);
      for (const row of snap[t]) {
        expect(snapClassIds.has(row.classId), `快照的 ${t} 引用了别人的班 ${row.classId}`).toBe(true);
      }
    }
    expect(JSON.stringify(snap)).not.toContain('别人的');
  });

  it('还原不会改动另一个教师的数据', async () => {
    const schema = await seedOtherTeacher();
    const before = drizzleDb.select().from(schema.schedules).all().filter(r => r.classId === 101);

    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 1, classes: [], students: [], schedules: [] });
    expect(res.status).toBe(200);

    expect(drizzleDb.select().from(schema.schedules).all().filter(r => r.classId === 101)).toEqual(before);
    expect(drizzleDb.select().from(schema.classes).all().filter(r => r.teacherId === otherId)).toHaveLength(1);
    expect(drizzleDb.select().from(schema.auditLog).all().filter(r => r.teacherId === otherId)).toHaveLength(1);
    expect(drizzleDb.select().from(schema.pricingTiers).all().filter(r => r.teacherId === otherId)).toHaveLength(1);
  });

  // forceOwner：请求体里带着别人的 teacherId 也得改写成调用者自己的，
  // 否则一个已登录的教师能往别人账下写伪造的审计记录和定价档位。
  it.each(['pricingTiers', 'auditLog', 'semesters', 'holidays', 'classes', 'students'])(
    '%s 里伪造的 teacherId 被改写成调用者自己', async (table) => {
      await seedOtherTeacher();
      const rows = {
        classes: [{ id: 1, teacherId: otherId, name: '伪造', grade: '高三', subject: '数学', studentCount: 1, unitPrice: 1 }],
        students: [{ id: 1, teacherId: otherId, name: '伪造' }],
        pricingTiers: [{ id: 1, teacherId: otherId, minStudents: 1, maxStudents: 2, pricePerStudentPerHour: 1 }],
        auditLog: [{ id: 1, teacherId: otherId, timestamp: '2026-01-01 00:00:00', action: 'CREATE', tableName: 'classes', recordId: 1 }],
        semesters: [{ id: 1, teacherId: otherId, name: '伪造', type: 'spring', startDate: '2026-03-01', endDate: '2026-07-01' }],
        holidays: [{ id: 1, teacherId: otherId, date: '2026-04-06', type: 'holiday', name: '伪造' }],
      }[table];

      const res = await request(app).post('/api/backup/restore').set(auth(token))
        .send({ version: 1, classes: [], students: [], schedules: [], [table]: rows });
      expect(res.status).toBe(200);

      // 每张表各认各的：写死一个跨表通用的谓词太容易悄悄匹配不到，
      // 那样循环体一次都不跑，断言就是空的。
      const isMine = {
        classes: r => r.name === '伪造',
        students: r => r.name === '伪造',
        semesters: r => r.name === '伪造',
        holidays: r => r.name === '伪造',
        pricingTiers: r => r.pricePerStudentPerHour === 1,
        auditLog: r => r.tableName === 'classes' && r.recordId === 1,
      }[table];

      const schema = await import('../db/schema.js');
      const all = drizzleDb.select().from(schema[table]).all();
      const written = all.filter(isMine);
      expect(written.length, `${table} 没找到刚还原进去的那一行`).toBe(1);
      expect(written[0].teacherId).toBe(teacherId);
      // 别人的那一行原封不动。
      expect(all.filter(r => r.teacherId === otherId)).toHaveLength(1);
    });

  // 还原要重新分配主键。不重分配的话，备份里的 id 撞上别的教师已占用的同一个 id，
  // 整个事务回滚成 500——用户手里明明有备份却还原不了。
  it.each([
    ['students', { students: [{ id: 101, teacherId: 999, name: '撞号的学生' }] }],
    ['holidays', { holidays: [{ id: 101, teacherId: 999, date: '2026-04-07', type: 'holiday', name: '撞号的假' }] }],
    ['pricingTiers', { pricingTiers: [{ id: 101, teacherId: 999, minStudents: 1, maxStudents: 2, pricePerStudentPerHour: 1 }] }],
    ['semesters', { semesters: [{ id: 101, teacherId: 999, name: '撞号的学期', type: 'spring', startDate: '2026-03-01', endDate: '2026-07-01' }] }],
    ['auditLog', { auditLog: [{ id: 101, teacherId: 999, timestamp: '2026-01-01 00:00:00', action: 'CREATE', tableName: 'classes', recordId: 1 }] }],
  ])('%s 的主键与别的教师相撞时照样还原成功', async (table, payload) => {
    await seedOtherTeacher();
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ version: 1, classes: [], students: [], schedules: [], ...payload });
    expect(res.status).toBe(200);
    expect(res.body.restored[table]).toBe(1);
    // 别的教师那一行还在，没被覆盖。
    const schema = await import('../db/schema.js');
    expect(drizzleDb.select().from(schema[table]).all().filter(r => r.teacherId === otherId)).toHaveLength(1);
  });

  it('classPricing 的主键相撞时也照样还原成功', async () => {
    await seedOtherTeacher();
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send({
      version: 1, students: [], schedules: [],
      classes: [{ id: 7, teacherId: 999, name: '我的班', grade: '高三', subject: '数学', studentCount: 1, unitPrice: 100 }],
      classPricing: [{ id: 101, classId: 7, studentCount: 1, unitPrice: 100, effectiveFrom: '2026-01-01' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.restored.classPricing).toBe(1);
    const schema = await import('../db/schema.js');
    expect(drizzleDb.select().from(schema.classPricing).all().filter(r => r.classId === 101)).toHaveLength(1);
  });
});
