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
});
