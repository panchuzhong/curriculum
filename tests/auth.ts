import { test as base, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import { randomUUID } from 'node:crypto';

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

// 这套夹具会改密码、删数据，而 TEST_USER.username 就是真实账号名 'pcz'：
//   · 密码对不上时直接 UPDATE teachers SET password_hash（把真人密码换成仓库里写死的那个）
//   · 清理时按前缀删 semesters / students / classes 及其子表
// DB_PATH 是可以覆盖的，而 playwright.config 的 `??=` 不会盖掉显式设的值，
// 所以 `DB_PATH=./data/data.db npx playwright test`（调试时很自然的一步）
// 会让上面这些操作全部落在真实数据上。先确认打开的确实是测试库再说。
if (!/e2e/i.test(E2E_DB_PATH)) {
  throw new Error(
    `E2E 夹具拒绝在 ${E2E_DB_PATH} 上运行：它会重置密码并删除数据。` +
    'DB_PATH 必须指向测试库（路径中需包含 "e2e"）。',
  );
}
let preparedTeacherId: number | null = null;
let prunedStaleRows = false;

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
        .run(TEST_USER.username, passwordHash, 'E2E Teacher', randomUUID(), JSON.stringify(DEFAULT_SUBJECTS));
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

export { toDateString, addDays, getCurrentMonday };

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

  // Semester tests add rows that were never removed, and the edit test used to
  // rename this very seed row, so each run left two more behind. They pile up
  // into several semesters covering the same dates, which makes "which semester
  // is current" ambiguous. Prune once per worker, before any test runs.
  //
  // The student and class CRUD tests leak the same way: each run leaves behind
  // a `E2E学生_<ts>` / `E2E编辑源_<ts>` / `E2E编辑后_<ts>` student and a
  // `E2E测试班_<ts>` class. Those names all start with the seed names, so after a
  // few runs the substring locator in 「按班级筛选学生」 matches several rows at
  // once and the test fails on a database that nothing is actually wrong with.
  //
  // Only E2E-prefixed rows are deleted. DB_PATH is overridable (playwright.config
  // defaults it with `??=`), and a bare `name <> seed` condition would wipe the
  // real teacher's roster if the suite were ever pointed at another database.
  if (!prunedStaleRows) {
    // 必须按名字前缀限定，不能只写 name <> 种子名。上面那段注释正是在说这件事，
    // 而这一条当初漏掉了：TEST_USER.username 是 'pcz'，也就是真实账号，
    // 一旦有人用 DB_PATH 指向正式库跑一次 E2E（调试时很自然的做法），
    // 这句就会把该教师**全部**真实学期删光，只留下一个 E2E春季学期。
    // 其余几条删除都带着 name LIKE 'E2E%' / 'E2E测试班%'，唯独这里没有。
    // 约定：本目录里新建学期的名字必须命中下面某个前缀，否则这里收不走。
    // 收不走的后果不是脏数据而已：semesters.spec.ts 的年份取自
    // 2400 + Date.now()%300、固定 2/1~6/30，攒够两行就会日期重叠，
    // 之后每次跑都在建学期那步 409「该教师已有日期重叠的学期」，永久卡住。
    // 当初只写了 E2E%/待删除%，漏掉了 semesters.spec.ts 的 待编辑_ 和它改名后的 编辑后_
    // ——那条用例只要中途失败，末尾的清理就不会跑，留下的正是这两种行。
    const SEMESTER_FIXTURE_PREFIXES = ['E2E', '待删除', '待编辑', '编辑后'];
    db.prepare(`DELETE FROM semesters WHERE teacher_id = ? AND name <> ?
      AND (${SEMESTER_FIXTURE_PREFIXES.map(() => 'name LIKE ?').join(' OR ')})`)
      .run(teacherId, 'E2E春季学期', ...SEMESTER_FIXTURE_PREFIXES.map(p => `${p}%`));
    db.prepare(`DELETE FROM class_students WHERE student_id IN
      (SELECT id FROM students WHERE teacher_id = ? AND name LIKE 'E2E%' AND name <> ?)`)
      .run(teacherId, 'E2E学生');
    db.prepare("DELETE FROM students WHERE teacher_id = ? AND name LIKE 'E2E%' AND name <> ?")
      .run(teacherId, 'E2E学生');
    // 先删指向班级的子表再删班级。schedules / class_students / class_pricing 三张表都
    // 外键引用 classes.id，而本文件的 better-sqlite3 连接没有开 foreign_keys（服务端
    // 在另一条连接上开了）：少删一张不会报错，只会静默留下指向已删班级的孤儿行，
    // 而真正开了外键的服务端的行为和这里就对不上了。
    const junkClasses = "SELECT id FROM classes WHERE teacher_id = ? AND name LIKE 'E2E测试班%'";
    db.prepare(`DELETE FROM schedules WHERE class_id IN (${junkClasses})`).run(teacherId);
    db.prepare(`DELETE FROM class_students WHERE class_id IN (${junkClasses})`).run(teacherId);
    db.prepare(`DELETE FROM class_pricing WHERE class_id IN (${junkClasses})`).run(teacherId);
    db.prepare(`DELETE FROM classes WHERE id IN (${junkClasses})`).run(teacherId);
    prunedStaleRows = true;
  }

  // Anchor the seeded semester to the run date, and re-anchor it on every run.
  // A fixed range silently drifts into the past; once every candidate schedule
  // falls outside it, the delete-preview test still passes but stops exercising
  // semester filtering at all. Starting at day(-22) keeps the day(-25) preview
  // schedule outside the semester so the straddle branch stays live.
  const today = new Date();
  const semesterStart = toDateString(addDays(today, -22));
  const semesterEnd = toDateString(addDays(today, 120));
  const semester = db.prepare('SELECT id FROM semesters WHERE teacher_id = ? AND name = ?')
    .get(teacherId, 'E2E春季学期') as { id: number } | undefined;
  if (semester) {
    db.prepare('UPDATE semesters SET start_date = ?, end_date = ? WHERE id = ?')
      .run(semesterStart, semesterEnd, semester.id);
  } else {
    db.prepare(
      'INSERT INTO semesters (teacher_id, name, type, start_date, end_date) VALUES (?, ?, ?, ?, ?)'
    ).run(teacherId, 'E2E春季学期', 'spring', semesterStart, semesterEnd);
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

  // Second seed class with schedules ONLY in the current week (never in May),
  // used by the reports class-filter test: the unfiltered year view spans two
  // months; filtering to this class must collapse the month chart to one.
  const englishRow = db.prepare('SELECT id FROM classes WHERE teacher_id = ? AND name = ? AND deleted = 0')
    .get(teacherId, 'E2E英语班') as { id: number } | undefined;
  let englishId = englishRow?.id;
  if (!englishId) {
    const result = db.prepare(
      `INSERT INTO classes
       (teacher_id, name, grade, subject, student_count, unit_price, discount_amount, is_competition)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(teacherId, 'E2E英语班', '高二', '英语', 1, 500, 0, 0);
    englishId = Number(result.lastInsertRowid);
  }
  const englishPricing = db.prepare('SELECT COUNT(*) AS count FROM class_pricing WHERE class_id = ?')
    .get(englishId) as { count: number };
  if (englishPricing.count === 0) {
    db.prepare('INSERT INTO class_pricing (class_id, student_count, unit_price, discount_amount, effective_from) VALUES (?, ?, ?, ?, ?)')
      .run(englishId, 1, 500, 0, '2026-01-01');
  }
  const englishDate = toDateString(addDays(monday, 1));
  const englishSchedule = db.prepare(
    'SELECT id FROM schedules WHERE class_id = ? AND date = ? AND start_time = ?'
  ).get(englishId, englishDate, '14:00');
  if (!englishSchedule) {
    db.prepare('INSERT INTO schedules (class_id, date, start_time, end_time, duration_billing, location_name) VALUES (?, ?, ?, ?, ?, ?)')
      .run(englishId, englishDate, '14:00', '15:30', 90, 'E2E教室');
  }
}

function getTestToken() {
  const teacherId = ensureTestUser();
  // Password changes bump pwd_version and revoke stale tokens, so the claim
  // must reflect the teacher's current version (legacy tokens are version 0).
  const db = new Database(E2E_DB_PATH);
  try {
    const row = db.prepare('SELECT pwd_version FROM teachers WHERE id = ?').get(teacherId) as { pwd_version?: number } | undefined;
    const pwdVersion = row?.pwd_version ?? 0;
    return jwt.sign({ teacherId, pwdVersion }, getJwtSecret(), { expiresIn: '7d' });
  } finally {
    db.close();
  }
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    const token = getTestToken();
    await page.addInitScript(value => {
      localStorage.setItem('token', value);
    }, token);
    const rawGoto = page.goto.bind(page);
    page.goto = async (...args) => {
      const response = await rawGoto(...args);
      const path = new URL(page.url()).pathname;
      if (path !== '/login' && path !== '/register') {
        await page.locator('nav').waitFor({ state: 'visible' });
        await page.locator('main').waitFor({ state: 'visible' });
      }
      return response;
    };
    await page.goto('/');
    await use(page);
  },
});

export { expect };
