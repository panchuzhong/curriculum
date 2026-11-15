import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { setupApp, makeUser, auth } from './route-helpers.js';

// PUT 只认白名单字段（防 mass assignment）。这里原先测的是本文件自己写的一份过滤函数和
// 手抄的字段表：路由里的白名单整段删掉、或者把 teacherId 放进去，这些用例照样全绿。
// 现在直接打真的路由、看库里那一行：越权字段没动，正常字段（对照）照常写进去了——
// 没有对照的话，一个什么都不写的 PUT 也能让「没动」成立。
describe('PUT 忽略白名单以外的字段', () => {
  it('班级：teacherId / id / deleted / createdAt 改不动', async () => {
    const { app, drizzleDb } = await setupApp('/api/classes', '../routes/classes.js');
    const { classes } = await import('../db/schema.js');
    const me = await makeUser(drizzleDb);
    const other = await makeUser(drizzleDb, 'other');
    const id = Number(drizzleDb.insert(classes).values({
      teacherId: me.id, name: '数学班', grade: '高一', subject: '数学', studentCount: 1, unitPrice: 100,
    }).run().lastInsertRowid);
    const before = drizzleDb.select().from(classes).where(eq(classes.id, id)).get();

    const res = await request(app).put(`/api/classes/${id}`).set(auth(me.token))
      .send({ name: '改名班', teacherId: other.id, id: 9999, deleted: true, createdAt: '2000-01-01 00:00:00' });

    expect(res.status).toBe(200);
    expect(drizzleDb.select().from(classes).where(eq(classes.id, id)).get())
      .toMatchObject({ name: '改名班', teacherId: me.id, deleted: false, createdAt: before.createdAt });
    expect(drizzleDb.select().from(classes).where(eq(classes.id, 9999)).get()).toBeUndefined();
  });

  it('排课：id / createdAt 改不动', async () => {
    const { app, drizzleDb } = await setupApp('/api/schedules', '../routes/schedules.js');
    const { classes, schedules } = await import('../db/schema.js');
    const me = await makeUser(drizzleDb);
    const classId = Number(drizzleDb.insert(classes).values({
      teacherId: me.id, name: '数学班', grade: '高一', subject: '数学', studentCount: 1, unitPrice: 100,
    }).run().lastInsertRowid);
    const id = Number(drizzleDb.insert(schedules).values({
      classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00', durationBilling: 60,
    }).run().lastInsertRowid);
    const before = drizzleDb.select().from(schedules).where(eq(schedules.id, id)).get();

    const res = await request(app).put(`/api/schedules/${id}`).set(auth(me.token))
      .send({ locationName: '新教室', id: 9999, createdAt: '2000-01-01 00:00:00' });

    expect(res.status).toBe(200);
    expect(drizzleDb.select().from(schedules).where(eq(schedules.id, id)).get())
      .toMatchObject({ locationName: '新教室', createdAt: before.createdAt });
    expect(drizzleDb.select().from(schedules).where(eq(schedules.id, 9999)).get()).toBeUndefined();
  });

  it('学期：teacherId / id 改不动', async () => {
    const { app, drizzleDb } = await setupApp('/api/semesters', '../routes/semesters.js');
    const { semesters } = await import('../db/schema.js');
    const me = await makeUser(drizzleDb);
    const other = await makeUser(drizzleDb, 'other');
    const id = Number(drizzleDb.insert(semesters).values({
      teacherId: me.id, name: '2026春季', type: 'spring', startDate: '2026-02-20', endDate: '2026-07-01',
    }).run().lastInsertRowid);

    const res = await request(app).put(`/api/semesters/${id}`).set(auth(me.token))
      .send({ name: '改名学期', teacherId: other.id, id: 9999 });

    expect(res.status).toBe(200);
    expect(drizzleDb.select().from(semesters).where(eq(semesters.id, id)).get())
      .toMatchObject({ name: '改名学期', teacherId: me.id });
    expect(drizzleDb.select().from(semesters).where(eq(semesters.id, 9999)).get()).toBeUndefined();
  });
});
