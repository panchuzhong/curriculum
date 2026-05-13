import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

export function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      api_key TEXT UNIQUE,
      subjects TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE classes (
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
    CREATE TABLE pricing_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      min_students INTEGER NOT NULL,
      max_students INTEGER NOT NULL,
      price_per_student_per_hour REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE students (
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
    CREATE TABLE class_students (
      class_id INTEGER NOT NULL REFERENCES classes(id),
      student_id INTEGER NOT NULL REFERENCES students(id),
      PRIMARY KEY (class_id, student_id)
    );
    CREATE TABLE schedules (
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
    CREATE TABLE semesters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT
    );
    CREATE TABLE class_pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES classes(id),
      student_count INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      discount_amount REAL DEFAULT 0,
      discount_reason TEXT,
      effective_from TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_class_eff ON class_pricing(class_id, effective_from);
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id INTEGER,
      before_data TEXT,
      after_data TEXT
    );
  `);

  const drizzleDb = drizzle(db, { schema });
  return { db, drizzleDb };
}
