import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { existsSync, mkdirSync } from 'fs';

const dbPath = process.env.DB_PATH || './data/data.db';

// Ensure data directory exists
if (!existsSync('./data')) mkdirSync('./data', { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const drizzleDb = drizzle(db, { schema });

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      api_key TEXT UNIQUE,
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
      class_id INTEGER NOT NULL REFERENCES classes(id),
      name TEXT NOT NULL,
      phone TEXT,
      parent_phone TEXT,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
}
