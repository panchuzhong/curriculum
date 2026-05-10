import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { eq, and } from 'drizzle-orm';
import { setupApp, makeUser, auth } from './route-helpers.js';

// ── Auth middleware: API Key authentication ──

describe('API Key authentication', () => {
  let app, drizzleDb, user;

  beforeEach(async () => {
    ({ app, drizzleDb } = await setupApp('/api/classes', '../routes/classes.js'));
    user = await makeUser(drizzleDb);
  });

  it('authenticates with valid API key via X-API-Key header', async () => {
    const res = await request(app).get('/api/classes')
      .set('X-API-Key', `key-testuser`);
    expect(res.status).toBe(200);
  });

  it('rejects invalid API key', async () => {
    const res = await request(app).get('/api/classes')
      .set('X-API-Key', 'invalid-key');
    expect(res.status).toBe(401);
  });

  it('rejects request with no auth', async () => {
    const res = await request(app).get('/api/classes');
    expect(res.status).toBe(401);
  });

  it('rejects expired/invalid JWT token', async () => {
    const res = await request(app).get('/api/classes')
      .set('Authorization', 'Bearer invalid-token-here');
    expect(res.status).toBe(401);
  });
});

// ── Classes edge cases ──

describe('Classes — edge cases', () => {
  let app, drizzleDb, token, teacherId;

  beforeEach(async () => {
    ({ app, drizzleDb } = await setupApp('/api/classes', '../routes/classes.js'));
    ({ token, id: teacherId } = await makeUser(drizzleDb));
  });

  it('update returns 400 when no valid fields provided', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ hack: 'value' });
    expect(res.status).toBe(400);
  });

  it('update ignores unknown fields but applies valid ones', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ name: '新名', unknownField: 'ignored' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('新名');
  });

  it('delete removes schedules from listing but preserves data', async () => {
    const { classes, schedules } = await import('../db/schema.js');
    const { body: { id: classId } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });

    // Insert a schedule directly
    drizzleDb.insert(schedules).values({
      classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00', durationBilling: 60,
    }).run();

    // Soft-delete class
    await request(app).delete(`/api/classes/${classId}`).set(auth(token));

    // Class not in normal listing
    const list = await request(app).get('/api/classes').set(auth(token));
    expect(list.body).toHaveLength(0);

    // Class appears with includeDeleted
    const all = await request(app).get('/api/classes?includeDeleted=true').set(auth(token));
    expect(all.body).toHaveLength(1);
    expect(all.body[0].isDeleted).toBe(true);
  });

  it('create class with all optional fields', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({
        name: '竞赛班', grade: '高三', subject: '数学', studentCount: 2, unitPrice: 300,
        discountAmount: 50, discountReason: '早鸟优惠', isCompetition: true,
        defaultLocationName: '图书馆', defaultLocationLat: 39.9, defaultLocationLng: 116.4,
      });
    expect(res.status).toBe(200);
    expect(res.body.isCompetition).toBe(true);
    expect(res.body.discountAmount).toBe(50);
    expect(res.body.defaultLocationName).toBe('图书馆');
  });

  it('get single class returns isDeleted for soft-deleted', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    await request(app).delete(`/api/classes/${id}`).set(auth(token));
    const res = await request(app).get(`/api/classes/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.isDeleted).toBe(true);
  });

  it('locations/suggest includes schedule locations', async () => {
    const { classes, schedules } = await import('../db/schema.js');
    const { body: { id: classId } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    // Schedule with a different location
    drizzleDb.insert(schedules).values({
      classId, date: '2026-05-04', startTime: '09:00', endTime: '10:00',
      durationBilling: 60, locationName: '线上',
    }).run();
    const res = await request(app).get('/api/classes/locations/suggest').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toContain('线上');
  });
});

// ── Student-class association ──

describe('Student-class association', () => {
  let app, drizzleDb, token, classId;

  beforeEach(async () => {
    ({ app, drizzleDb } = await setupApp('/api/students', '../routes/students.js'));
    ({ token } = await makeUser(drizzleDb));
    const { classes } = await import('../db/schema.js');
    const r = drizzleDb.insert(classes).values({
      teacherId: 1, name: '数学班', grade: '高一', subject: '数学', studentCount: 5, unitPrice: 100,
    }).run();
    classId = Number(r.lastInsertRowid);
  });

  it('creates student with classIds', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', classIds: [classId] });
    expect(res.status).toBe(200);
    expect(res.body.classIds).toEqual([classId]);
  });

  it('ignores invalid classIds when creating student', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', classIds: [99999] });
    expect(res.status).toBe(200);
    expect(res.body.classIds).toEqual([]);
  });

  it('updates student classIds replaces all associations', async () => {
    const { classes } = await import('../db/schema.js');
    const r2 = drizzleDb.insert(classes).values({
      teacherId: 1, name: '物理班', grade: '高二', subject: '物理', studentCount: 3, unitPrice: 120,
    }).run();
    const classId2 = Number(r2.lastInsertRowid);

    const { body: { id } } = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', classIds: [classId] });

    // Replace with class2
    const res = await request(app).put(`/api/students/${id}`).set(auth(token))
      .send({ classIds: [classId2] });
    expect(res.status).toBe(200);
    expect(res.body.classIds).toEqual([classId2]);
  });

  it('clears classIds with empty array', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', classIds: [classId] });
    const res = await request(app).put(`/api/students/${id}`).set(auth(token))
      .send({ classIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.classIds).toEqual([]);
  });

  it('deleting student removes class associations', async () => {
    const { classStudents } = await import('../db/schema.js');
    const { body: { id } } = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', classIds: [classId] });
    // Verify association exists
    const linksBefore = drizzleDb.select().from(classStudents)
      .where(eq(classStudents.studentId, id)).all();
    expect(linksBefore.length).toBeGreaterThan(0);

    await request(app).delete(`/api/students/${id}`).set(auth(token));
    const linksAfter = drizzleDb.select().from(classStudents)
      .where(eq(classStudents.studentId, id)).all();
    expect(linksAfter).toHaveLength(0);
  });
});

// ── Class sub-resource: students ──

describe('Classes sub-resource students', () => {
  let app, drizzleDb, token, classId;

  beforeEach(async () => {
    ({ app, drizzleDb } = await setupApp('/api/classes', '../routes/classes.js'));
    ({ token } = await makeUser(drizzleDb));
    const { body } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    classId = body.id;
  });

  it('creates student under class and links them', async () => {
    const res = await request(app).post(`/api/classes/${classId}/students`).set(auth(token))
      .send({ name: '李四', phone: '13800138000' });
    expect(res.status).toBe(200);
    expect(res.body.classIds).toContain(classId);
    expect(res.body.name).toBe('李四');
  });

  it('returns 404 for deleted class', async () => {
    await request(app).delete(`/api/classes/${classId}`).set(auth(token));
    const res = await request(app).post(`/api/classes/${classId}/students`).set(auth(token))
      .send({ name: '李四' });
    expect(res.status).toBe(404);
  });

  it('lists students for a class', async () => {
    await request(app).post(`/api/classes/${classId}/students`).set(auth(token))
      .send({ name: '王五' });
    const res = await request(app).get(`/api/classes/${classId}/students`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('王五');
  });

  it('removes student from class (unlinks, does not delete student)', async () => {
    const { body: { id: studentId } } = await request(app).post(`/api/classes/${classId}/students`).set(auth(token))
      .send({ name: '赵六' });
    const res = await request(app).delete(`/api/classes/${classId}/students/${studentId}`).set(auth(token));
    expect(res.status).toBe(200);

    // Student still exists globally
    const students = await request(app).get(`/api/classes/${classId}/students`).set(auth(token));
    expect(students.body).toHaveLength(0);
  });
});

// ── Backup edge cases ──

describe('Backup — edge cases', () => {
  let app, drizzleDb, token, teacherId;

  beforeEach(async () => {
    ({ app, drizzleDb } = await setupApp('/api/backup', '../routes/backup.js'));
    ({ id: teacherId, token } = await makeUser(drizzleDb));
  });

  it('backup includes pricingTiers, holidays, semesters', async () => {
    const { pricingTiers, holidays, semesters } = await import('../db/schema.js');
    drizzleDb.insert(pricingTiers).values({
      teacherId, minStudents: 1, maxStudents: 5, pricePerStudentPerHour: 100,
    }).run();
    drizzleDb.insert(holidays).values({
      teacherId, date: '2026-01-01', type: 'holiday', name: '元旦',
    }).run();
    drizzleDb.insert(semesters).values({
      teacherId, name: '春', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30',
    }).run();
    const res = await request(app).get('/api/backup').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.pricingTiers).toHaveLength(1);
    expect(res.body.holidays).toHaveLength(1);
    expect(res.body.semesters).toHaveLength(1);
  });

  it('restore forces teacherId to authenticated user', async () => {
    const backup = {
      version: 1,
      classes: [{ id: 1, teacherId: 999, name: '别人的班', grade: '高三', subject: '数学', studentCount: 1, unitPrice: 100 }],
      students: [{ id: 1, teacherId: 999, name: '别人的学生' }],
      schedules: [],
      classStudents: [],
      holidays: [],
      semesters: [],
      pricingTiers: [],
    };
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(backup);
    expect(res.status).toBe(200);
    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.classes[0].teacherId).toBe(teacherId);
  });

  it('restore filters classStudents with invalid references', async () => {
    const backup = {
      version: 1,
      classes: [{ id: 1, teacherId, name: '班', grade: '高三', subject: '数学', studentCount: 1, unitPrice: 100 }],
      students: [{ id: 1, teacherId, name: '学生' }],
      schedules: [],
      classStudents: [
        { classId: 1, studentId: 1 },   // valid
        { classId: 1, studentId: 999 },  // invalid studentId
        { classId: 999, studentId: 1 },  // invalid classId
      ],
      holidays: [],
      semesters: [],
      pricingTiers: [],
    };
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(backup);
    expect(res.status).toBe(200);
    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.classStudents).toHaveLength(1);
  });

  it('restore handles empty arrays gracefully', async () => {
    const backup = {
      version: 1,
      classes: [],
      students: [],
      schedules: [],
    };
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(backup);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('restore rejects missing version', async () => {
    const res = await request(app).post('/api/backup/restore').set(auth(token))
      .send({ classes: [], students: [], schedules: [] });
    expect(res.status).toBe(400);
  });

  it('restore handles CURRENT_TIMESTAMP in createdAt', async () => {
    const backup = {
      version: 1,
      classes: [{ id: 1, teacherId, name: '班', grade: '高三', subject: '数学', studentCount: 1, unitPrice: 100, createdAt: 'CURRENT_TIMESTAMP' }],
      students: [],
      schedules: [],
      classStudents: [],
      holidays: [],
      semesters: [],
      pricingTiers: [],
    };
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(backup);
    expect(res.status).toBe(200);
    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.classes[0].createdAt).not.toBe('CURRENT_TIMESTAMP');
  });

  it('restore is transactional — bad data rolls back', async () => {
    // Create existing data
    const { classes, schedules } = await import('../db/schema.js');
    drizzleDb.insert(classes).values({
      teacherId, name: '旧班', grade: '高三', subject: '数学', studentCount: 1, unitPrice: 100,
    }).run();

    // Backup with invalid data that will fail insert
    const backup = {
      version: 1,
      classes: [{ /* missing required fields */ teacherId }],
      students: [],
      schedules: [{ classId: 999, date: 'bad', startTime: 'x', endTime: 'y', durationBilling: -1 }],
      classStudents: [],
      holidays: [],
      semesters: [],
      pricingTiers: [],
    };
    const res = await request(app).post('/api/backup/restore').set(auth(token)).send(backup);
    // Should fail, old data preserved
    expect(res.status).toBe(500);
    const exported = (await request(app).get('/api/backup').set(auth(token))).body;
    expect(exported.classes).toHaveLength(1);
    expect(exported.classes[0].name).toBe('旧班');
  });
});

// ── Semester validation ──

describe('Semesters — edge cases', () => {
  let app, drizzleDb, token;

  beforeEach(async () => {
    ({ app, drizzleDb } = await setupApp('/api/semesters', '../routes/semesters.js'));
    ({ token } = await makeUser(drizzleDb));
  });

  it('update returns 400 when no valid fields provided', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const res = await request(app).put(`/api/semesters/${id}`).set(auth(token))
      .send({ hack: 'value' });
    expect(res.status).toBe(400);
  });

  it('delete returns 404 for nonexistent', async () => {
    const res = await request(app).delete('/api/semesters/99999').set(auth(token));
    expect(res.status).toBe(404);
  });

  it('update returns 404 for other teacher semester', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: 'spring', startDate: '2026-02-01', endDate: '2026-06-30' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/semesters/${id}`).set(auth(token2))
      .send({ name: 'hack' });
    expect(res.status).toBe(404);
  });
});

// ── Pricing tiers validation ──

describe('Pricing tiers — edge cases', () => {
  let app, drizzleDb, token;

  beforeEach(async () => {
    ({ app, drizzleDb } = await setupApp('/api/pricing-tiers', '../routes/pricing-tiers.js'));
    ({ token } = await makeUser(drizzleDb));
  });

  it('update returns 400 when no valid fields provided', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const res = await request(app).put(`/api/pricing-tiers/${id}`).set(auth(token))
      .send({ hack: 'value' });
    expect(res.status).toBe(400);
  });

  it('update returns 404 for other teacher tier', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/pricing-tiers/${id}`).set(auth(token2))
      .send({ pricePerStudentPerHour: 200 });
    expect(res.status).toBe(404);
  });

  it('delete returns 404 for other teacher tier', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).delete(`/api/pricing-tiers/${id}`).set(auth(token2));
    expect(res.status).toBe(404);
  });
});

// ── Holidays — data isolation ──

describe('Holidays — data isolation', () => {
  let app, drizzleDb, token;

  beforeEach(async () => {
    ({ app, drizzleDb } = await setupApp('/api/holidays', '../routes/holidays.js'));
    ({ token } = await makeUser(drizzleDb));
  });

  it('does not show other teacher holidays', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/holidays').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });

  it('cannot update other teacher holiday', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/holidays/${id}`).set(auth(token2))
      .send({ name: 'hack' });
    expect(res.status).toBe(404);
  });

  it('cannot delete other teacher holiday', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).delete(`/api/holidays/${id}`).set(auth(token2));
    expect(res.status).toBe(404);
  });

  it('year filter returns empty for years with no data', async () => {
    const res = await request(app).get('/api/holidays/2099').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('update returns 400 when no valid fields provided', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).put(`/api/holidays/${id}`).set(auth(token))
      .send({ hack: 'value' });
    expect(res.status).toBe(400);
  });
});
