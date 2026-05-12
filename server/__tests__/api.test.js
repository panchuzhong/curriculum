import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './setup.js';
import { classes, students, classStudents, schedules, teachers, semesters } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

describe('Database operations', () => {
  let db, drizzleDb;

  beforeEach(() => {
    const test = createTestDb();
    db = test.db;
    drizzleDb = test.drizzleDb;
  });

  it('creates and queries a teacher', () => {
    const result = drizzleDb.insert(teachers).values({
      username: 'testteacher',
      passwordHash: 'hash',
      name: 'Test Teacher',
      apiKey: 'test-key',
    }).run();
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);

    const teacher = drizzleDb.select().from(teachers).where(eq(teachers.username, 'testteacher')).get();
    expect(teacher.name).toBe('Test Teacher');
  });

  it('creates class with pricing and queries back', () => {
    const t = drizzleDb.insert(teachers).values({
      username: 'testteacher2',
      passwordHash: 'hash',
      name: 'Teacher 2',
    }).run();
    const teacherId = Number(t.lastInsertRowid);

    drizzleDb.insert(classes).values({
      teacherId, name: 'Math Class', grade: '高一', subject: '数学',
      studentCount: 3, unitPrice: 500,
    }).run();

    const cls = drizzleDb.select().from(classes)
      .where(and(eq(classes.teacherId, teacherId), eq(classes.deleted, false))).get();
    expect(cls.name).toBe('Math Class');
    expect(cls.unitPrice).toBe(500);
  });

  it('soft-deletes a class', () => {
    const t = drizzleDb.insert(teachers).values({
      username: 'testteacher3', passwordHash: 'hash', name: 'Teacher 3',
    }).run();
    const teacherId = Number(t.lastInsertRowid);

    const c = drizzleDb.insert(classes).values({
      teacherId, name: 'Del Class', grade: '高二', subject: '英语',
      studentCount: 2, unitPrice: 400,
    }).run();
    const classId = Number(c.lastInsertRowid);

    drizzleDb.update(classes).set({ deleted: true }).where(eq(classes.id, classId)).run();

    const active = drizzleDb.select().from(classes)
      .where(and(eq(classes.teacherId, teacherId), eq(classes.deleted, false))).all();
    expect(active).toEqual([]);
  });

  it('manages class-student junction', () => {
    const t = drizzleDb.insert(teachers).values({
      username: 'testteacher4', passwordHash: 'hash', name: 'Teacher 4',
    }).run();
    const teacherId = Number(t.lastInsertRowid);

    const c = drizzleDb.insert(classes).values({
      teacherId, name: 'Junction Class', grade: '高三', subject: '物理',
      studentCount: 1, unitPrice: 600,
    }).run();
    const classId = Number(c.lastInsertRowid);

    const s = drizzleDb.insert(students).values({
      teacherId, name: 'Student A',
    }).run();
    const studentId = Number(s.lastInsertRowid);

    drizzleDb.insert(classStudents).values({ classId, studentId }).run();

    const links = drizzleDb.select().from(classStudents)
      .where(eq(classStudents.classId, classId)).all();
    expect(links.length).toBe(1);
    expect(links[0].studentId).toBe(studentId);
  });

  it('creates schedule and calculates revenue', () => {
    const t = drizzleDb.insert(teachers).values({
      username: 'testteacher5', passwordHash: 'hash', name: 'Teacher 5',
    }).run();
    const teacherId = Number(t.lastInsertRowid);

    const c = drizzleDb.insert(classes).values({
      teacherId, name: 'Rev Class', grade: '初一', subject: '语文',
      studentCount: 5, unitPrice: 200, discountAmount: 50,
    }).run();
    const classId = Number(c.lastInsertRowid);

    drizzleDb.insert(schedules).values({
      classId, date: '2025-06-01', startTime: '09:00', endTime: '10:30',
      durationBilling: 90,
    }).run();
    drizzleDb.insert(schedules).values({
      classId, date: '2025-06-03', startTime: '14:00', endTime: '15:30',
      durationBilling: 90,
    }).run();

    const scheds = drizzleDb.select().from(schedules)
      .where(eq(schedules.classId, classId)).all();
    expect(scheds.length).toBe(2);

    const totalMinutes = scheds.reduce((sum, s) => sum + s.durationBilling, 0);
    const hours = totalMinutes / 60;
    const revenue = (200 * 5 - 50) * hours;
    expect(revenue).toBe(2850); // (1000-50) * 3
  });

  it('manages semesters', () => {
    const t = drizzleDb.insert(teachers).values({
      username: 'testteacher6', passwordHash: 'hash', name: 'Teacher 6',
    }).run();
    const teacherId = Number(t.lastInsertRowid);

    drizzleDb.insert(semesters).values({
      teacherId, name: '2025 Spring', type: 'spring',
      startDate: '2025-02-17', endDate: '2025-06-30',
    }).run();

    const sems = drizzleDb.select().from(semesters)
      .where(eq(semesters.teacherId, teacherId)).all();
    expect(sems.length).toBe(1);
    expect(sems[0].name).toBe('2025 Spring');
  });
});
