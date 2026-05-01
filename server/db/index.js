import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { existsSync, mkdirSync } from 'fs';

const dbPath = process.env.DB_PATH || './data/data.db';

if (!existsSync('./data')) mkdirSync('./data', { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const drizzleDb = drizzle(db, { schema });
export { db };

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      api_key TEXT UNIQUE,
      subjects TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      name TEXT NOT NULL,
      grade TEXT NOT NULL,
      subject TEXT NOT NULL,
      student_count INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      discount_amount REAL DEFAULT 0,
      discount_reason TEXT,
      is_competition INTEGER DEFAULT 0,
      default_location_name TEXT,
      default_location_lat REAL,
      default_location_lng REAL,
      deleted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pricing_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      min_students INTEGER NOT NULL,
      max_students INTEGER NOT NULL,
      price_per_student_per_hour REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      name TEXT NOT NULL,
      birth_date TEXT,
      phone TEXT,
      parent_name TEXT,
      parent_phone TEXT,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS class_students (
      class_id INTEGER NOT NULL REFERENCES classes(id),
      student_id INTEGER NOT NULL REFERENCES students(id),
      PRIMARY KEY (class_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES classes(id),
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_billing INTEGER NOT NULL,
      location_name TEXT,
      location_lat REAL,
      location_lng REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id INTEGER,
      before_data TEXT,
      after_data TEXT
    );
    CREATE TABLE IF NOT EXISTS semesters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrations for existing databases
  try { db.exec(`ALTER TABLE teachers ADD COLUMN subjects TEXT`); } catch {}

  // Check if students table needs migration (old schema has class_id NOT NULL)
  const studentCols = db.prepare(`PRAGMA table_info(students)`).all();
  const hasOldSchema = studentCols.some(c => c.name === 'class_id' && c.notnull === 1);

  if (hasOldSchema) {
    // Migrate: create new table, copy data, replace
    db.exec(`
      CREATE TABLE IF NOT EXISTS class_students (
        class_id INTEGER NOT NULL REFERENCES classes(id),
        student_id INTEGER NOT NULL REFERENCES students(id),
        PRIMARY KEY (class_id, student_id)
      );
      CREATE TABLE IF NOT EXISTS students_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        birth_date TEXT,
        phone TEXT,
        parent_name TEXT,
        parent_phone TEXT,
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Copy data
    const getClassTeacher = db.prepare(`SELECT teacher_id FROM classes WHERE id = ?`);
    const oldStudents = db.prepare(`SELECT * FROM students`).all();
    const insertNew = db.prepare(`INSERT INTO students_new (id, teacher_id, name, phone, parent_phone, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertLink = db.prepare(`INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)`);

    for (const s of oldStudents) {
      const cls = getClassTeacher.get(s.class_id);
      const teacherId = cls ? cls.teacher_id : 1;
      insertNew.run(s.id, teacherId, s.name, s.phone, s.parent_phone, s.note, s.created_at);
      if (s.class_id) insertLink.run(s.class_id, s.id);
    }

    db.exec(`DROP TABLE students; ALTER TABLE students_new RENAME TO students;`);
  } else {
    // New schema - just ensure class_students exists
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS class_students (
        class_id INTEGER NOT NULL REFERENCES classes(id),
        student_id INTEGER NOT NULL REFERENCES students(id),
        PRIMARY KEY (class_id, student_id)
      )`);
    } catch {}
    // Add missing columns
    try { db.exec(`ALTER TABLE students ADD COLUMN teacher_id INTEGER`); } catch {}
    try { db.exec(`ALTER TABLE students ADD COLUMN birth_date TEXT`); } catch {}
    try { db.exec(`ALTER TABLE students ADD COLUMN parent_name TEXT`); } catch {}
  }

  // Ensure holidays table exists
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT
    )`);
  } catch {}
}
