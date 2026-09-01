import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { drizzleDb, db, dbDir } from '../db/index.js';
import { classes, pricingTiers, students, classStudents, schedules, holidays, semesters, auditLog, classPricing } from '../db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { clearSemesterCache } from '../services/schedule-helpers.js';
import { clearReportCache } from '../services/report-cache.js';

const BACKUP_VERSION = 1;
const MAX_PRE_RESTORE_SNAPSHOTS = 5;
const RESTORE_CHUNK_SIZE = 50;

const router = Router();
router.use(authMiddleware);
if (process.env.NODE_ENV !== 'test') {
  router.use(rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }));
}

router.get('/', (req, res) => {
  const tid = req.teacherId;
  const teacherClasses = drizzleDb.select().from(classes).where(eq(classes.teacherId, tid)).all();
  const classIds = teacherClasses.map(c => c.id);

  const data = {
    version: BACKUP_VERSION,
    timestamp: new Date().toISOString(),
    classes: teacherClasses,
    pricingTiers: drizzleDb.select().from(pricingTiers).where(eq(pricingTiers.teacherId, tid)).all(),
    students: drizzleDb.select().from(students).where(eq(students.teacherId, tid)).all(),
    classStudents: classIds.length > 0
      ? drizzleDb.select().from(classStudents).where(inArray(classStudents.classId, classIds)).all()
      : [],
    schedules: classIds.length > 0
      ? drizzleDb.select().from(schedules).where(inArray(schedules.classId, classIds)).all()
      : [],
    holidays: drizzleDb.select().from(holidays).where(eq(holidays.teacherId, tid)).all(),
    semesters: drizzleDb.select().from(semesters).where(eq(semesters.teacherId, tid)).all(),
    classPricing: classIds.length > 0
      ? drizzleDb.select().from(classPricing).where(inArray(classPricing.classId, classIds)).all()
      : [],
    auditLog: drizzleDb.select().from(auditLog).where(eq(auditLog.teacherId, tid)).all(),
  };

  const json = JSON.stringify(data);
  const sizeMB = Buffer.byteLength(json, 'utf8') / (1024 * 1024);
  if (sizeMB > 50) {
    return res.status(413).json({ error: `备份数据过大（${sizeMB.toFixed(1)}MB），请清理历史数据后再试` });
  }

  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  res.setHeader('Content-Disposition', `attachment; filename="backup_${localDate}.json"`);
  res.type('json').send(json);
});

router.post('/restore', express.json({ limit: '50mb' }), (req, res) => {
  const tid = req.teacherId;
  const data = req.body;

  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Invalid backup data' });
  }

  if (data.version !== BACKUP_VERSION) {
    return res.status(400).json({ error: `不支持的备份版本（当前: v${BACKUP_VERSION}, 文件: v${data.version ?? '未知'}）` });
  }

  const requiredTables = ['classes', 'students', 'schedules'];
  for (const table of requiredTables) {
    if (!Array.isArray(data[table])) {
      return res.status(400).json({ error: `备份数据缺少 ${table} 或格式不正确` });
    }
  }

  // Version 1 relationships use exported class/student IDs as local keys. They
  // must be present and unique so they can be safely remapped to fresh global
  // SQLite IDs during restore.
  for (const table of ['classes', 'students']) {
    const ids = data[table].map(row => row?.id);
    if (ids.some(id => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: `${table} 中的 id 须为唯一正整数` });
    }
  }

  // Save pre-restore snapshot — abort if snapshot fails (data loss risk)
  try {
    const teacherClasses = drizzleDb.select().from(classes).where(eq(classes.teacherId, tid)).all();
    const cids = teacherClasses.map(c => c.id);
    const snapshot = {
      version: BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      classes: teacherClasses,
      pricingTiers: drizzleDb.select().from(pricingTiers).where(eq(pricingTiers.teacherId, tid)).all(),
      students: drizzleDb.select().from(students).where(eq(students.teacherId, tid)).all(),
      classStudents: cids.length > 0
        ? drizzleDb.select().from(classStudents).where(inArray(classStudents.classId, cids)).all()
        : [],
      schedules: cids.length > 0
        ? drizzleDb.select().from(schedules).where(inArray(schedules.classId, cids)).all()
        : [],
      holidays: drizzleDb.select().from(holidays).where(eq(holidays.teacherId, tid)).all(),
      semesters: drizzleDb.select().from(semesters).where(eq(semesters.teacherId, tid)).all(),
      classPricing: cids.length > 0
        ? drizzleDb.select().from(classPricing).where(inArray(classPricing.classId, cids)).all()
        : [],
      auditLog: drizzleDb.select().from(auditLog).where(eq(auditLog.teacherId, tid)).all(),
    };
    writeFileSync(join(dbDir, `.backup_pre_restore_${randomUUID()}.json`), JSON.stringify(snapshot));
    prunePreRestoreSnapshots();
  } catch (e) {
    console.error('Backup snapshot failed:', e);
    return res.status(500).json({ error: '还原前备份快照失败' });
  }

  // Force all teacher-scoped records to belong to the authenticated teacher
  const forceOwner = arr => (arr || []).map(r => ({ ...r, teacherId: tid }));

  // Fix legacy createdAt that stored literal "CURRENT_TIMESTAMP"
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const fixTimestamps = arr => (arr || []).map(r => ({
    ...r,
    createdAt: (!r.createdAt || r.createdAt === 'CURRENT_TIMESTAMP') ? now : r.createdAt,
  }));

  const arr = (v) => Array.isArray(v) ? v : [];

  // Strip unexpected fields from each record to prevent injection
  const pick = (record, allowed) => {
    const out = {};
    for (const key of allowed) {
      if (record[key] !== undefined) out[key] = record[key];
    }
    return out;
  };

  const classFields = ['id', 'teacherId', 'name', 'grade', 'subject', 'studentCount', 'unitPrice', 'discountAmount', 'discountReason', 'isCompetition', 'defaultLocationName', 'defaultLocationLat', 'defaultLocationLng', 'deleted', 'createdAt'];
  const studentFields = ['id', 'teacherId', 'name', 'birthDate', 'phone', 'parentName', 'parentPhone', 'note', 'createdAt'];
  const scheduleFields = ['id', 'classId', 'date', 'startTime', 'endTime', 'durationBilling', 'locationName', 'locationLat', 'locationLng', 'createdAt'];
  const semesterFields = ['id', 'teacherId', 'name', 'type', 'startDate', 'endDate', 'createdAt'];
  const holidayFields = ['id', 'teacherId', 'date', 'type', 'name'];
  const pricingTierFields = ['id', 'teacherId', 'minStudents', 'maxStudents', 'pricePerStudentPerHour', 'createdAt'];
  const classPricingFields = ['id', 'classId', 'studentCount', 'unitPrice', 'discountAmount', 'discountReason', 'effectiveFrom', 'createdAt'];
  const classStudentFields = ['classId', 'studentId'];
  const auditLogFields = ['id', 'teacherId', 'timestamp', 'action', 'tableName', 'recordId', 'beforeData', 'afterData'];

  const restoreData = {
    classes: fixTimestamps(forceOwner(arr(data.classes))).map(r => pick(r, classFields)),
    pricingTiers: fixTimestamps(forceOwner(arr(data.pricingTiers))).map(r => pick(r, pricingTierFields)),
    students: fixTimestamps(forceOwner(arr(data.students))).map(r => pick(r, studentFields)),
    classStudents: arr(data.classStudents).map(r => pick(r, classStudentFields)),
    schedules: fixTimestamps(arr(data.schedules)).map(r => pick(r, scheduleFields)),
    holidays: forceOwner(arr(data.holidays)).map(r => pick(r, holidayFields)),
    semesters: fixTimestamps(forceOwner(arr(data.semesters))).map(r => pick(r, semesterFields)),
    classPricing: arr(data.classPricing).map(r => pick(r, classPricingFields)),
    auditLog: forceOwner(arr(data.auditLog)).map(r => pick(r, auditLogFields)),
  };

  // Validate schedule, classStudents, classPricing references point to restored classes
  const classIds = new Set(restoreData.classes.map(c => c.id));
  const studentIds = new Set(restoreData.students.map(s => s.id));
  restoreData.schedules = restoreData.schedules.filter(s => classIds.has(s.classId));
  restoreData.classStudents = restoreData.classStudents.filter(l => classIds.has(l.classId) && studentIds.has(l.studentId));
  restoreData.classPricing = restoreData.classPricing.filter(p => classIds.has(p.classId));

  const counts = {};

  try {
    db.transaction(() => {
      const existingClassIds = drizzleDb.select({ id: classes.id })
        .from(classes).where(eq(classes.teacherId, tid)).all().map(c => c.id);

      if (existingClassIds.length > 0) {
        drizzleDb.delete(schedules).where(inArray(schedules.classId, existingClassIds)).run();
        drizzleDb.delete(classStudents).where(inArray(classStudents.classId, existingClassIds)).run();
        // class_pricing has an immediate foreign key to classes, so it must be
        // removed before its parent classes.
        drizzleDb.delete(classPricing).where(inArray(classPricing.classId, existingClassIds)).run();
      }
      drizzleDb.delete(classes).where(eq(classes.teacherId, tid)).run();
      drizzleDb.delete(students).where(eq(students.teacherId, tid)).run();
      drizzleDb.delete(pricingTiers).where(eq(pricingTiers.teacherId, tid)).run();
      drizzleDb.delete(semesters).where(eq(semesters.teacherId, tid)).run();
      drizzleDb.delete(holidays).where(eq(holidays.teacherId, tid)).run();
      drizzleDb.delete(auditLog).where(eq(auditLog.teacherId, tid)).run();

      const withoutId = ({ id, ...row }) => row;
      const insertChunks = (table, rows, transform = row => row) => {
        for (let i = 0; i < rows.length; i += RESTORE_CHUNK_SIZE) {
          drizzleDb.insert(table).values(rows.slice(i, i + RESTORE_CHUNK_SIZE).map(transform)).run();
        }
      };
      const insertAndMapIds = (table, rows, transform = withoutId) => {
        const idMap = new Map();
        // SQLite does not guarantee RETURNING row order for a multi-row
        // INSERT. Insert relationship roots individually so lastInsertRowid
        // provides an unambiguous old-ID -> new-ID mapping. The surrounding
        // transaction keeps this efficient; dependent bulk rows remain
        // chunked below.
        for (const row of rows) {
          const result = drizzleDb.insert(table).values(transform(row)).run();
          idMap.set(row.id, Number(result.lastInsertRowid));
        }
        return idMap;
      };

      insertChunks(semesters, restoreData.semesters, withoutId);
      if (restoreData.semesters.length) clearSemesterCache();
      insertChunks(pricingTiers, restoreData.pricingTiers, withoutId);
      const studentIdMap = insertAndMapIds(students, restoreData.students);
      const classIdMap = insertAndMapIds(classes, restoreData.classes);
      insertChunks(classStudents, restoreData.classStudents, row => ({
        classId: classIdMap.get(row.classId),
        studentId: studentIdMap.get(row.studentId),
      }));
      insertChunks(schedules, restoreData.schedules, row => ({
        ...withoutId(row), classId: classIdMap.get(row.classId),
      }));
      insertChunks(classPricing, restoreData.classPricing, row => ({
        ...withoutId(row), classId: classIdMap.get(row.classId),
      }));
      insertChunks(holidays, restoreData.holidays, withoutId);
      // Audit recordId values describe historical records and intentionally
      // remain unchanged; only the audit row's own global ID is regenerated.
      insertChunks(auditLog, restoreData.auditLog, withoutId);

      counts.classes = restoreData.classes.length;
      counts.students = restoreData.students.length;
      counts.schedules = restoreData.schedules.length;
      counts.semesters = restoreData.semesters.length;
      counts.auditLog = restoreData.auditLog.length;
    })();
  } catch (err) {
    console.error('Backup restore failed:', err);
    return res.status(500).json({ error: '还原失败，事务已回滚，原数据保留' });
  }

  clearSemesterCache();
  clearReportCache(tid);
  res.json({ ok: true, restored: counts });
});

// Keep only the newest pre-restore snapshots; restore is rare, so keeping a
// handful of rollback points is enough and prevents unbounded disk growth.
function prunePreRestoreSnapshots() {
  const files = readdirSync(dbDir)
    .filter(f => f.startsWith('.backup_pre_restore_') && f.endsWith('.json'))
    .map(f => {
      const stats = statSync(join(dbDir, f));
      return { name: f, mtime: stats.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  for (const { name } of files.slice(MAX_PRE_RESTORE_SNAPSHOTS)) {
    unlinkSync(join(dbDir, name));
  }
}

export default router;
