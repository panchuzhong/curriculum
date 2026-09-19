import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';
import { logAudit } from '../services/audit.js';

let app, drizzleDb, token, teacherId;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/students', '../routes/students.js'));
  ({ token, id: teacherId } = await makeUser(drizzleDb));
  logAudit.mockClear();
});

describe('POST /api/students', () => {
  // 旧接口靠正则的隐式转换接受过数字年份；加类型守卫时一刀切掉的话，
  // 这些客户端连改个电话号码都会 400。
  it('birthDate 接受四位数字年份，但拒绝非标量', async () => {
    const ok = await request(app).post('/api/students').set(auth(token))
      .send({ name: '数字年份', birthDate: 1990 });
    expect(ok.status).toBe(200);
    // 光看 200 是不够的：数字会被绑成 REAL、按 TEXT 亲和性存成 "1990.0"，
    // 接口照样返回 200，坏在存下来的值上。
    expect(ok.body.birthDate).toBe('1990');

    // 而且要能原样改回去——客户端把读到的值再提交一次是最普通的操作，
    // 存成 "1990.0" 的话这一步会 400，那条记录从此改不动。
    const again = await request(app).put(`/api/students/${ok.body.id}`).set(auth(token))
      .send({ birthDate: ok.body.birthDate, phone: '13800000001' });
    expect(again.status).toBe(200);

    const bad = await request(app).post('/api/students').set(auth(token))
      .send({ name: '数组', birthDate: ['1990'] });
    expect(bad.status).toBe(400);

    // 小数年份不是"年份"，仍要拒
    const frac = await request(app).post('/api/students').set(auth(token))
      .send({ name: '小数', birthDate: 1990.5 });
    expect(frac.status).toBe(400);
  });

  // 同一个坑：手机号也是 TEXT 列，数字绑进去会存成 "13800000000.0"，
  // 接口返回 200，而客户端把读回来的值再提交一次就 400「手机号格式不正确」。
  it.each([['phone'], ['parentPhone']])('%s 收到数字时按字符串存，能原样改回去', async (field) => {
    const created = await request(app).post('/api/students').set(auth(token))
      .send({ name: `数字${field}`, [field]: 13800000000 });
    expect(created.status).toBe(200);
    expect(created.body[field]).toBe('13800000000');

    const again = await request(app).put(`/api/students/${created.body.id}`).set(auth(token))
      .send({ [field]: created.body[field], parentName: '改一下别的' });
    expect(again.status).toBe(200);
  });

  it('creates a student and returns full object', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', phone: '13800138000' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('张三');
    expect(res.body.phone).toBe('13800138000');
    expect(res.body.classIds).toEqual([]);
  });

  it('rejects empty name', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ phone: '13800138000' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid phone', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', phone: '123' });
    expect(res.status).toBe(400);
  });

  it('allows empty optional fields', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', phone: '', parentPhone: '', birthDate: '' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('rejects invalid birthDate', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', birthDate: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  it('rejects a calendar-impossible birthDate', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', birthDate: '2026-02-30' });
    expect(res.status).toBe(400);
  });

  it('deduplicates repeated classIds instead of crashing on the junction PK', async () => {
    const { classes } = await import('../db/schema.js');
    const r = drizzleDb.insert(classes).values({
      teacherId: 1, name: '数学班', grade: '高一', subject: '数学', studentCount: 2, unitPrice: 100,
    }).run();
    const classId = Number(r.lastInsertRowid);

    const create = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', classIds: [classId, classId, classId] });
    expect(create.status).toBe(200);
    expect(create.body.classIds).toEqual([classId]);

    const update = await request(app).put(`/api/students/${create.body.id}`).set(auth(token))
      .send({ classIds: [classId, classId] });
    expect(update.status).toBe(200);
    expect(update.body.classIds).toEqual([classId]);
  });
});

describe('GET /api/students', () => {
  it('lists students with classIds', async () => {
    await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    const res = await request(app).get('/api/students').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].classIds).toBeDefined();
  });

  it('sorts Chinese names before English, same name by ID desc', async () => {
    await request(app).post('/api/students').set(auth(token)).send({ name: 'Alice' });
    await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    await request(app).post('/api/students').set(auth(token)).send({ name: 'Bob' });
    await request(app).post('/api/students').set(auth(token)).send({ name: '李四' });

    const res = await request(app).get('/api/students').set(auth(token));
    expect(res.status).toBe(200);
    const names = res.body.map(s => s.name);
    // Chinese names first (sorted by pinyin), English last (sorted alphabetically)
    expect(names).toEqual(['李四', '张三', '张三', 'Alice', 'Bob']);
    // Same name: newer (higher ID) first
    const zhangs = res.body.filter(s => s.name === '张三');
    expect(zhangs[0].id).toBeGreaterThan(zhangs[1].id);
  });
});

describe('PUT /api/students/:id', () => {
  it('updates a student and returns full object', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    const res = await request(app).put(`/api/students/${id}`).set(auth(token)).send({ name: '李四' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.name).toBe('李四');
    expect(res.body.classIds).toEqual([]);
  });

  it('returns 404 for other teacher student', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/students/${id}`).set(auth(token2)).send({ name: 'hack' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/students/:id', () => {
  it('deletes student', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    const res = await request(app).delete(`/api/students/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/students').set(auth(token));
    expect(list.body).toHaveLength(0);
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await request(app).delete('/api/students/999999').set(auth(token));
    expect(res.status).toBe(404);
  });
});

describe('Audit log', () => {
  it('logs CREATE on POST /api/students', async () => {
    await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE', tableName: 'students',
    }));
  });

  it('logs UPDATE on PUT /api/students/:id', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    logAudit.mockClear();
    await request(app).put(`/api/students/${id}`).set(auth(token)).send({ name: '李四' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', tableName: 'students', recordId: id,
    }));
  });

  it('logs DELETE on DELETE /api/students/:id', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    logAudit.mockClear();
    await request(app).delete(`/api/students/${id}`).set(auth(token));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE', tableName: 'students', recordId: id,
    }));
  });

  it('rejects classIds that is not an array (400)', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    const res = await request(app).put(`/api/students/${id}`).set(auth(token))
      .send({ classIds: 'not-array' });
    expect(res.status).toBe(400);
  });
});

describe('Data isolation', () => {
  it('does not show other teacher students', async () => {
    await request(app).post('/api/students').set(auth(token)).send({ name: '我的学生' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/students').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });

  it('DELETE returns 404 for other teacher student', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token)).send({ name: '张三' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).delete(`/api/students/${id}`).set(auth(token2));
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/students/:id preserves links to soft-deleted classes', () => {
  async function seedClasses() {
    const { classes: classesTable, teachers } = await import('../db/schema.js');
    const teacher = drizzleDb.select().from(teachers).get();
    const mk = (name, deleted) => Number(drizzleDb.insert(classesTable).values({
      teacherId: teacher.id, name, grade: '高一', subject: '数学',
      studentCount: 1, unitPrice: 100, deleted,
    }).run().lastInsertRowid);
    return { teacherId: teacher.id, activeId: mk('在读班', false), deletedId: mk('已停课班', true) };
  }

  it('an unrelated field edit must not drop membership in a soft-deleted class', async () => {
    const { classStudents } = await import('../db/schema.js');
    const { activeId, deletedId } = await seedClasses();

    const created = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', classIds: [activeId] });
    const studentId = created.body.id;
    // The state a class soft-deleted after the student joined leaves behind.
    drizzleDb.insert(classStudents).values({ classId: deletedId, studentId }).run();

    // GET returns both ids, so the dialog round-trips both back on save.
    const before = await request(app).get('/api/students').set(auth(token));
    const seen = before.body.find(s => s.id === studentId).classIds;
    expect([...seen].sort((a, b) => a - b)).toEqual([activeId, deletedId].sort((a, b) => a - b));

    const res = await request(app).put(`/api/students/${studentId}`).set(auth(token))
      .send({ phone: '13900000000', classIds: seen });
    expect(res.status).toBe(200);
    expect([...res.body.classIds].sort((a, b) => a - b))
      .toEqual([activeId, deletedId].sort((a, b) => a - b));
  });

  it("still ignores another teacher's class id", async () => {
    const { classes: classesTable } = await import('../db/schema.js');
    const other = await makeUser(drizzleDb, 'otherteacher');
    const foreignId = Number(drizzleDb.insert(classesTable).values({
      teacherId: other.id, name: '别人的班', grade: '高一', subject: '数学',
      studentCount: 1, unitPrice: 100,
    }).run().lastInsertRowid);

    const created = await request(app).post('/api/students').set(auth(token)).send({ name: '李四' });
    const res = await request(app).put(`/api/students/${created.body.id}`).set(auth(token))
      .send({ classIds: [foreignId] });
    expect(res.status).toBe(200);
    expect(res.body.classIds).toEqual([]);
  });
});

describe('classIds given as numeric strings', () => {
  it('links on create and keeps links on update', async () => {
    const { classes } = await import('../db/schema.js');
    const teacherId = drizzleDb.select().from((await import('../db/schema.js')).teachers).get().id;
    const r = drizzleDb.insert(classes).values({
      teacherId, name: '数学班', grade: '高一', subject: '数学', studentCount: 5, unitPrice: 100,
    }).run();
    const classId = Number(r.lastInsertRowid);

    const created = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', classIds: [String(classId)] });
    expect(created.status).toBe(200);
    expect(created.body.classIds).toEqual([classId]);

    const updated = await request(app).put(`/api/students/${created.body.id}`).set(auth(token))
      .send({ name: '张三丰', classIds: [String(classId)] });
    expect(updated.status).toBe(200);
    expect(updated.body.classIds).toEqual([classId]);
  });
});

// classIds 里指向已软删班级的条目必须被丢掉。软删的班在列表、报表、冲突检测里
// 都当不存在，把学生挂上去等于建了一条谁也看不见、也删不掉的关系。
describe('建学生时 classIds 不认已删除的班', () => {
  it('指向软删班级的 classIds 被丢掉', async () => {
    const { classes, classStudents } = await import('../db/schema.js');
    const live = drizzleDb.insert(classes).values({
      teacherId, name: '在用的班', grade: '高一', subject: '数学', studentCount: 1, unitPrice: 100,
    }).run();
    const dead = drizzleDb.insert(classes).values({
      teacherId, name: '已删的班', grade: '高一', subject: '数学', studentCount: 1, unitPrice: 100, deleted: true,
    }).run();
    const liveId = Number(live.lastInsertRowid);
    const deadId = Number(dead.lastInsertRowid);

    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '新学生', classIds: [liveId, deadId] });
    expect(res.status).toBe(200);

    const links = drizzleDb.select().from(classStudents).all()
      .filter(l => l.studentId === res.body.id);
    expect(links.map(l => l.classId)).toEqual([liveId]);
  });
});

// 手机号的号段（1[3-9]）是有意义的：放宽成 1\d{10} 之后 12345678901 也会被收下。
describe('手机号号段校验', () => {
  it.each(['12000000000', '10000000000', '11111111111'])('%s 被拒', async (phone) => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: 'X', phone });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('手机号格式不正确');
  });

  it.each(['13800138000', '19900199000', '15012345678'])('%s 被接受', async (phone) => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: 'X', phone });
    expect(res.status).toBe(200);
  });
});
