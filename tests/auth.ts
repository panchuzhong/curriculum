import { test as base, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

export const TEST_USER = {
  username: 'pcz',
  password: 'test1234',
};

const DEFAULT_SUBJECTS = ['数学', '物理', '化学', '英语', '语文', '生物', '历史', '地理', '政治'];
const DEFAULT_TIERS = [
  { minStudents: 1, maxStudents: 1, pricePerStudentPerHour: 800 },
  { minStudents: 2, maxStudents: 2, pricePerStudentPerHour: 600 },
  { minStudents: 3, maxStudents: 3, pricePerStudentPerHour: 500 },
  { minStudents: 4, maxStudents: 4, pricePerStudentPerHour: 400 },
  { minStudents: 5, maxStudents: 999, pricePerStudentPerHour: 200 },
];

const E2E_DB_PATH = process.env.DB_PATH || './data/e2e.db';
let preparedTeacherId: number | null = null;

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const env = readFileSync('.env', 'utf-8');
  const match = env.match(/^JWT_SECRET=(.+)$/m);
  if (!match?.[1]) throw new Error('JWT_SECRET is required for E2E auth');
  return match[1].trim();
}

export function ensureTestUser() {
  const db = new Database(E2E_DB_PATH);
  try {
    if (preparedTeacherId) {
      ensureSeedData(db, preparedTeacherId);
      return preparedTeacherId;
    }

    const passwordHash = bcrypt.hashSync(TEST_USER.password, 12);
    const teacher = db.prepare('SELECT id, password_hash FROM teachers WHERE username = ?').get(TEST_USER.username) as { id: number, password_hash: string } | undefined;
    let teacherId = teacher?.id;

    if (teacher) {
      if (!bcrypt.compareSync(TEST_USER.password, teacher.password_hash)) {
        db.prepare('UPDATE teachers SET password_hash = ? WHERE id = ?').run(passwordHash, teacher.id);
      }
    } else {
      const result = db.prepare('INSERT INTO teachers (username, password_hash, name, api_key, subjects) VALUES (?, ?, ?, ?, ?)')
        .run(TEST_USER.username, passwordHash, 'E2E Teacher', uuidv4(), JSON.stringify(DEFAULT_SUBJECTS));
      teacherId = Number(result.lastInsertRowid);
    }

    const tierCount = db.prepare('SELECT COUNT(*) AS count FROM pricing_tiers WHERE teacher_id = ?').get(teacherId) as { count: number };
    if (tierCount.count === 0) {
      const insertTier = db.prepare('INSERT INTO pricing_tiers (teacher_id, min_students, max_students, price_per_student_per_hour) VALUES (?, ?, ?, ?)');
      for (const tier of DEFAULT_TIERS) {
        insertTier.run(teacherId, tier.minStudents, tier.maxStudents, tier.pricePerStudentPerHour);
      }
    }
    if (teacherId) ensureSeedData(db, teacherId);
    preparedTeacherId = teacherId ?? null;
  } finally {
    db.close();
  }
  if (!preparedTeacherId) throw new Error('Failed to prepare E2E test user');
  return preparedTeacherId;
}

function toDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getCurrentMonday() {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(today, diff);
}

function ensureSeedData(db: Database.Database, teacherId: number) {
  const classRow = db.prepare('SELECT id FROM classes WHERE teacher_id = ? AND name = ? AND deleted = 0')
    .get(teacherId, 'E2E数学班') as { id: number } | undefined;
  let classId = classRow?.id;

  if (!classId) {
    const result = db.prepare(
      `INSERT INTO classes
       (teacher_id, name, grade, subject, student_count, unit_price, discount_amount, is_competition, default_location_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(teacherId, 'E2E数学班', '高一', '数学', 2, 600, 0, 0, 'E2E教室');
    classId = Number(result.lastInsertRowid);
  }

  const pricingCount = db.prepare('SELECT COUNT(*) AS count FROM class_pricing WHERE class_id = ?')
    .get(classId) as { count: number };
  if (pricingCount.count === 0) {
    db.prepare(
      'INSERT INTO class_pricing (class_id, student_count, unit_price, discount_amount, effective_from) VALUES (?, ?, ?, ?, ?)'
    ).run(classId, 2, 600, 0, '2026-01-01');
  }

  const studentRow = db.prepare('SELECT id FROM students WHERE teacher_id = ? AND name = ?')
    .get(teacherId, 'E2E学生') as { id: number } | undefined;
  let studentId = studentRow?.id;
  if (!studentId) {
    const result = db.prepare(
      'INSERT INTO students (teacher_id, name, parent_name, parent_phone, note) VALUES (?, ?, ?, ?, ?)'
    ).run(teacherId, 'E2E学生', 'E2E家长', '13800000000', 'E2E seed');
    studentId = Number(result.lastInsertRowid);
  }

  const link = db.prepare('SELECT 1 FROM class_students WHERE class_id = ? AND student_id = ?')
    .get(classId, studentId);
  if (!link) {
    db.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, studentId);
  }

  const semester = db.prepare('SELECT id FROM semesters WHERE teacher_id = ? AND name = ?')
    .get(teacherId, 'E2E春季学期');
  if (!semester) {
    db.prepare(
      'INSERT INTO semesters (teacher_id, name, type, start_date, end_date) VALUES (?, ?, ?, ?, ?)'
    ).run(teacherId, 'E2E春季学期', 'spring', '2026-02-23', '2026-07-15');
  }

  const monday = getCurrentMonday();
  const dates = [toDateString(monday), toDateString(addDays(monday, 2)), '2026-05-13'];
  for (const date of dates) {
    const existing = db.prepare(
      'SELECT id FROM schedules WHERE class_id = ? AND date = ? AND start_time = ? AND end_time = ?'
    ).get(classId, date, '09:00', '10:30');
    if (!existing) {
      db.prepare(
        'INSERT INTO schedules (class_id, date, start_time, end_time, duration_billing, location_name) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(classId, date, '09:00', '10:30', 90, 'E2E教室');
    }
  }
}

function getTestToken() {
  const teacherId = ensureTestUser();
  return jwt.sign({ teacherId }, getJwtSecret(), { expiresIn: '7d' });
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    const token = getTestToken();
    await page.addInitScript(value => {
      localStorage.setItem('token', value);
    }, token);
    await page.goto('/');
    await use(page);
  },
});

export { expect };
