import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import bcrypt from 'bcryptjs';
import request from 'express';
import { createTestDb } from './setup.js';
import { classes, students, classStudents, schedules, pricingTiers, teachers, semesters } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

// We test the route logic directly by importing route modules
// and mocking drizzleDb. Since routes import from '../db/index.js',
// we test via a lightweight approach: test the core logic functions.

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function detectConflictGroups(daySchedules) {
  if (daySchedules.length < 2) return [];
  const sorted = [...daySchedules].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const groups = [];
  let group = [sorted[0]];
  let groupEnd = toMin(sorted[0].endTime) >= toMin(sorted[0].startTime)
    ? toMin(sorted[0].endTime)
    : toMin(sorted[0].endTime) + 24 * 60;

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    const sStart = toMin(s.startTime);
    const sEnd = toMin(s.endTime) >= sStart ? toMin(s.endTime) : toMin(s.endTime) + 24 * 60;
    if (sStart < groupEnd) {
      group.push(s);
      groupEnd = Math.max(groupEnd, sEnd);
    } else {
      if (group.length > 1) groups.push(group);
      group = [s];
      groupEnd = sEnd;
    }
  }
  if (group.length > 1) groups.push(group);
  return groups;
}

function calcDurationBilling(startTime, endTime, manual) {
  if (manual != null) return manual;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

describe('detectConflictGroups', () => {
  it('returns empty for single schedule', () => {
    const result = detectConflictGroups([
      { startTime: '09:00', endTime: '10:00' },
    ]);
    expect(result).toEqual([]);
  });

  it('detects overlapping schedules', () => {
    const result = detectConflictGroups([
      { startTime: '09:00', endTime: '10:30' },
      { startTime: '10:00', endTime: '11:00' },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].length).toBe(2);
  });

  it('returns empty for non-overlapping schedules', () => {
    const result = detectConflictGroups([
      { startTime: '09:00', endTime: '10:00' },
      { startTime: '10:00', endTime: '11:00' },
    ]);
    expect(result).toEqual([]);
  });

  it('detects three-way overlap', () => {
    const result = detectConflictGroups([
      { startTime: '09:00', endTime: '11:00' },
      { startTime: '09:30', endTime: '10:30' },
      { startTime: '10:00', endTime: '12:00' },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].length).toBe(3);
  });

  it('separates non-overlapping groups', () => {
    const result = detectConflictGroups([
      { startTime: '09:00', endTime: '10:00' },
      { startTime: '09:30', endTime: '10:30' },
      { startTime: '14:00', endTime: '15:00' },
      { startTime: '14:30', endTime: '15:30' },
    ]);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(2);
    expect(result[1].length).toBe(2);
  });

  it('handles empty array', () => {
    expect(detectConflictGroups([])).toEqual([]);
  });
});

describe('calcDurationBilling', () => {
  it('calculates normal duration', () => {
    expect(calcDurationBilling('09:00', '10:30', null)).toBe(90);
  });

  it('handles overnight (end < start)', () => {
    expect(calcDurationBilling('23:00', '01:00', null)).toBe(120);
  });

  it('uses manual override when provided', () => {
    expect(calcDurationBilling('09:00', '10:00', 45)).toBe(45);
  });

  it('uses manual override when zero', () => {
    expect(calcDurationBilling('09:00', '10:00', 0)).toBe(0);
  });
});

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
