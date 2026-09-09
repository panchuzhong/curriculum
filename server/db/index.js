import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const dbPath = process.env.DB_PATH || './data/data.db';

// Derive the directory from DB_PATH: hardcoding ./data left a stray directory
// in the cwd and still failed with SQLITE_CANTOPEN for any other location.
export const dbDir = dirname(dbPath);
if (dbDir && !existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Wait briefly on lock contention instead of failing immediately — matters when
// multiple server processes share the same SQLite file.
db.pragma('busy_timeout = 5000');

export const drizzleDb = drizzle(db, { schema });
export { db };

const migrations = [
  {
    version: 1,
    name: 'add_teacher_subjects',
    up(db) {
      try { db.exec(`ALTER TABLE teachers ADD COLUMN subjects TEXT`); } catch {}
    },
  },
  {
    version: 2,
    name: 'migrate_students_to_junction',
    up(db) {
      const studentCols = db.prepare(`PRAGMA table_info(students)`).all();
      const hasOldSchema = studentCols.some(c => c.name === 'class_id' && c.notnull === 1);

      db.exec(`CREATE TABLE IF NOT EXISTS class_students (
        class_id INTEGER NOT NULL REFERENCES classes(id),
        student_id INTEGER NOT NULL REFERENCES students(id),
        PRIMARY KEY (class_id, student_id)
      )`);

      if (hasOldSchema) {
        db.exec(`CREATE TABLE IF NOT EXISTS students_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          teacher_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          birth_date TEXT,
          phone TEXT,
          parent_name TEXT,
          parent_phone TEXT,
          note TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
        const getClassTeacher = db.prepare(`SELECT teacher_id FROM classes WHERE id = ?`);
        const oldStudents = db.prepare(`SELECT * FROM students`).all();
        const insertNew = db.prepare(`INSERT INTO students_new (id, teacher_id, name, birth_date, phone, parent_name, parent_phone, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const insertLink = db.prepare(`INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)`);

        for (const s of oldStudents) {
          const cls = getClassTeacher.get(s.class_id);
          const teacherId = cls ? cls.teacher_id : 1;
          insertNew.run(s.id, teacherId, s.name, s.birth_date, s.phone, s.parent_name, s.parent_phone, s.note, s.created_at);
          if (s.class_id) insertLink.run(s.class_id, s.id);
        }
        db.exec(`DROP TABLE students; ALTER TABLE students_new RENAME TO students;`);
      } else {
        for (const col of ['teacher_id', 'birth_date', 'parent_name']) {
          try { db.exec(`ALTER TABLE students ADD COLUMN ${col === 'teacher_id' ? 'teacher_id INTEGER' : col === 'birth_date' ? 'birth_date TEXT' : 'parent_name TEXT'}`); } catch {}
        }
      }
    },
  },
  {
    version: 3,
    name: 'create_class_pricing',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS class_pricing (
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
      `);
      // Backfill: one initial record per class using current pricing
      db.exec(`
        INSERT OR IGNORE INTO class_pricing (class_id, student_count, unit_price, discount_amount, discount_reason, effective_from)
        SELECT id, student_count, unit_price, COALESCE(discount_amount, 0), discount_reason, substr(COALESCE(created_at, '2000-01-01'), 1, 10)
        FROM classes WHERE NOT EXISTS (SELECT 1 FROM class_pricing WHERE class_id = classes.id)
      `);
    },
  },
  {
    version: 4,
    name: 'add_teacher_pwd_version',
    up(db) {
      try { db.exec(`ALTER TABLE teachers ADD COLUMN pwd_version INTEGER NOT NULL DEFAULT 0`); } catch {}
    },
  },
];

export function initDb() {
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      api_key TEXT UNIQUE,
      subjects TEXT,
      pwd_version INTEGER NOT NULL DEFAULT 0,
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

  // Run pending migrations
  const applied = new Set(
    db.prepare(`SELECT version FROM _migrations`).all().map(r => r.version)
  );
  const hasClassPricing = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='class_pricing'`).get();

  // An untracked legacy database must run the idempotent migrations: having
  // class_pricing proves nothing about newer columns such as pwd_version.
  // Repair ledgers written by the previous blanket "all applied" shortcut.
  const teacherCols = db.prepare('PRAGMA table_info(teachers)').all();
  if (applied.has(4) && !teacherCols.some(c => c.name === 'pwd_version')) {
    db.prepare('DELETE FROM _migrations WHERE version = 4').run();
    applied.delete(4);
  }
  if (applied.has(3) && !hasClassPricing) {
    db.prepare(`DELETE FROM _migrations WHERE version = 3`).run();
    applied.delete(3);
  }

  const pending = migrations.filter(m => !applied.has(m.version));
  if (pending.length > 0) {
    // v2 swaps the students table with DROP + RENAME. DROP TABLE performs an
    // implicit DELETE that trips class_students' foreign key, and that check
    // cannot be deferred (defer_foreign_keys does not cover it), so foreign
    // keys have to be off — which PRAGMA only honours outside a transaction.
    // Each migration still commits atomically, so a failure cannot leave a
    // half-applied schema that wedges the next start.
    db.pragma('foreign_keys = OFF');
    try {
      for (const m of pending) {
        db.transaction(() => {
          m.up(db);
          db.prepare(`INSERT INTO _migrations (version, name) VALUES (?, ?)`).run(m.version, m.name);
        })();
      }
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  // idx_schedules_unique postdates duplicate detection, so a database written
  // before it can hold identical (class_id, date, start_time) rows; CREATE
  // UNIQUE INDEX then throws and the server never starts. Keep the oldest row.
  const hasUniqueIdx = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_schedules_unique'").get();
  if (!hasUniqueIdx) {
    const { changes } = db.prepare(
      'DELETE FROM schedules WHERE id NOT IN (SELECT MIN(id) FROM schedules GROUP BY class_id, date, start_time)'
    ).run();
    if (changes > 0) console.warn(`Removed ${changes} duplicate schedule row(s) before creating idx_schedules_unique`);
  }

  // Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date);
    CREATE INDEX IF NOT EXISTS idx_schedules_classId ON schedules(class_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_date_classId ON schedules(date, class_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_classId_date ON schedules(class_id, date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_unique ON schedules(class_id, date, start_time);
    CREATE INDEX IF NOT EXISTS idx_classes_teacherId_deleted ON classes(teacher_id, deleted);
    CREATE INDEX IF NOT EXISTS idx_students_teacherId ON students(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_holidays_teacherId_date ON holidays(teacher_id, date);
    CREATE INDEX IF NOT EXISTS idx_semesters_teacherId ON semesters(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_class_students_classId ON class_students(class_id);
    CREATE INDEX IF NOT EXISTS idx_class_students_studentId ON class_students(student_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_teacherId ON audit_log(teacher_id);
  `);

  // Fix legacy createdAt that stored literal "CURRENT_TIMESTAMP" string
  for (const table of ['classes', 'students', 'schedules', 'pricing_tiers', 'semesters']) {
    db.exec(`UPDATE ${table} SET created_at = datetime('now') WHERE created_at = 'CURRENT_TIMESTAMP'`);
  }
}
