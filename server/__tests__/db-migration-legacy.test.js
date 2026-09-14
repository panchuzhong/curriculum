import { describe, it, expect, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmp;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
  delete process.env.DB_PATH;
});

// Builds a database in the pre-junction shape that migration v2 detects:
// students.class_id NOT NULL.
function seedLegacyDb(path) {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE teachers (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, name TEXT NOT NULL, api_key TEXT UNIQUE, created_at TEXT);
    CREATE TABLE classes (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL,
      name TEXT NOT NULL, grade TEXT, subject TEXT, student_count INTEGER, unit_price REAL,
      discount_amount REAL DEFAULT 0, discount_reason TEXT, is_competition INTEGER DEFAULT 0,
      default_location_name TEXT, default_location_lat REAL, default_location_lng REAL,
      deleted INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE students (id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER NOT NULL,
      name TEXT NOT NULL, birth_date TEXT, phone TEXT, parent_name TEXT, parent_phone TEXT,
      note TEXT, created_at TEXT);
    INSERT INTO teachers (id, username, password_hash, name) VALUES (1, 't', 'h', 'T');
    INSERT INTO classes (id, teacher_id, name) VALUES (7, 1, '高一数学');
    INSERT INTO students (id, class_id, name) VALUES (3, 7, '张三');
  `);
  db.close();
}

describe('legacy database upgrade', () => {
  it.each([false, true])('repairs a missing pwd_version column even with an existing pricing table (recorded=%s)', async (recorded) => {
    tmp = mkdtempSync(join(tmpdir(), 'curr-password-mig-'));
    process.env.DB_PATH = join(tmp, 'legacy.db');
    vi.resetModules();
    const { initDb, db } = await import('../db/index.js');
    try {
      initDb();
      db.exec(`INSERT INTO teachers (username, password_hash, name) VALUES ('legacy', 'hash', 'Teacher');
        INSERT INTO classes (teacher_id, name, grade, subject, student_count, unit_price, created_at)
          VALUES (1, 'Priced', '高一', '数学', 2, 100, '2026-01-01 09:30:00'),
                 (1, 'Unpriced', '高一', '数学', 2, 100, '2026-02-01 09:30:00');
        INSERT INTO class_pricing (class_id, student_count, unit_price, effective_from)
          VALUES (1, 3, 150, '2026-03-01');
        ALTER TABLE teachers DROP COLUMN pwd_version;`);
      if (!recorded) db.exec('DELETE FROM _migrations');

      initDb();
      expect(db.prepare('SELECT pwd_version FROM teachers').get()).toEqual({ pwd_version: 0 });
      expect(db.prepare('SELECT version FROM _migrations ORDER BY version').all().map(r => r.version)).toEqual([1, 2, 3, 4]);
      expect(db.prepare('SELECT student_count, unit_price, effective_from FROM class_pricing WHERE class_id = 1').all())
        .toEqual([{ student_count: 3, unit_price: 150, effective_from: '2026-03-01' }]);
      if (!recorded) {
        expect(db.prepare('SELECT effective_from FROM class_pricing WHERE class_id = 2').get())
          .toEqual({ effective_from: '2026-02-01' });
      }
      expect(() => initDb()).not.toThrow();
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });

  // PRAGMA foreign_keys = ON makes SQLite's implicit DELETE during DROP TABLE
  // violate class_students.student_id, so migration v2 threw and initDb() never
  // returned — the server could not start against any pre-junction database.
  it('migrates a pre-junction students table without tripping foreign keys', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'curr-mig-'));
    const dbPath = join(tmp, 'legacy.db');
    seedLegacyDb(dbPath);

    process.env.DB_PATH = dbPath;
    vi.resetModules();
    const { initDb } = await import('../db/index.js');
    expect(() => initDb()).not.toThrow();

    const check = new Database(dbPath, { readonly: true });
    const student = check.prepare('SELECT id, teacher_id, name FROM students WHERE id = 3').get();
    const link = check.prepare('SELECT class_id, student_id FROM class_students').all();
    const cols = check.prepare('PRAGMA table_info(students)').all().map(c => c.name);
    check.close();

    expect(student).toMatchObject({ id: 3, teacher_id: 1, name: '张三' });
    expect(link).toEqual([{ class_id: 7, student_id: 3 }]);
    expect(cols).not.toContain('class_id');
  });

  // idx_schedules_unique was introduced after duplicate rows were already
  // possible; CREATE UNIQUE INDEX on such a database threw and the server never
  // started.
  it('removes duplicate schedule rows before creating the unique index', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'curr-dup-'));
    const dbPath = join(tmp, 'legacy.db');
    seedLegacyDb(dbPath);
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER NOT NULL,
        date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
        duration_billing INTEGER NOT NULL, location_name TEXT, location_lat REAL, location_lng REAL,
        created_at TEXT);
      INSERT INTO schedules (id, class_id, date, start_time, end_time, duration_billing) VALUES
        (1, 7, '2026-03-02', '09:00', '10:00', 60),
        (2, 7, '2026-03-02', '09:00', '10:30', 90),
        (3, 7, '2026-03-03', '09:00', '10:00', 60);
    `);
    db.close();

    process.env.DB_PATH = dbPath;
    vi.resetModules();
    const { initDb } = await import('../db/index.js');
    expect(() => initDb()).not.toThrow();

    const check = new Database(dbPath, { readonly: true });
    const ids = check.prepare('SELECT id FROM schedules ORDER BY id').all().map(r => r.id);
    check.close();
    expect(ids).toEqual([1, 3]);
  });

  it('creates the database directory named by DB_PATH, not a hardcoded ./data', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'curr-dir-'));
    const dbPath = join(tmp, 'nested', 'deeper', 'app.db');

    process.env.DB_PATH = dbPath;
    vi.resetModules();
    // Importing the module opens the database; a missing parent directory used
    // to surface as SQLITE_CANTOPEN while ./data was created in the cwd instead.
    await expect(import('../db/index.js')).resolves.toBeDefined();
  });

  // The pre-fix migrations swallowed every ALTER error, so a transient failure
  // (busy lock, full disk) was recorded as applied and the column stayed
  // missing forever — only pwd_version had a repair. Same repair for v1/v2.
  it('repairs subjects and student columns whose migration was falsely recorded', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'curr-col-repair-'));
    process.env.DB_PATH = join(tmp, 'legacy.db');
    vi.resetModules();
    const { initDb, db } = await import('../db/index.js');
    try {
      initDb();
      db.exec(`
        ALTER TABLE teachers DROP COLUMN subjects;
        ALTER TABLE students DROP COLUMN birth_date;
        ALTER TABLE students DROP COLUMN parent_name;`);

      initDb();
      const teacherCols = db.prepare('PRAGMA table_info(teachers)').all().map(c => c.name);
      const studentCols = db.prepare('PRAGMA table_info(students)').all().map(c => c.name);
      expect(teacherCols).toContain('subjects');
      expect(studentCols).toContain('birth_date');
      expect(studentCols).toContain('parent_name');
      expect(db.prepare('SELECT version FROM _migrations ORDER BY version').all().map(r => r.version))
        .toEqual([1, 2, 3, 4]);
    } finally {
      db.close();
    }
  });

  // A pre-v1.6.1 legacy database stores the literal 'CURRENT_TIMESTAMP' in
  // created_at. The v3 backfill derives effective_from from its first 10
  // chars, which used to yield 'CURRENT_TI' — a string that sorts after every
  // ISO date, so the initial pricing record never matched a lesson date.
  it('repairs literal CURRENT_TIMESTAMP created_at before the v3 backfill runs', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'curr-ts-repair-'));
    const dbPath = join(tmp, 'legacy.db');
    seedLegacyDb(dbPath);
    const seed = new Database(dbPath);
    // class_pricing.student_count is NOT NULL and the backfill is INSERT OR
    // IGNORE, so a legacy class without pricing values gets no record at all.
    seed.exec(`UPDATE classes SET created_at = 'CURRENT_TIMESTAMP', student_count = 3, unit_price = 100`);
    seed.close();

    process.env.DB_PATH = dbPath;
    vi.resetModules();
    const { initDb, db } = await import('../db/index.js');
    try {
      initDb();
      const rows = db.prepare('SELECT effective_from FROM class_pricing').all();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.effective_from))).toBe(true);
    } finally {
      db.close();
    }
  });
});
