import { Router } from 'express';
import { drizzleDb, db } from '../db/index.js';
import { classes, pricingTiers, students, classStudents, schedules, holidays, semesters } from '../db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { writeFileSync } from 'fs';

const BACKUP_VERSION = 1;

const router = Router();
router.use(authMiddleware);

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
  };

  const json = JSON.stringify(data);
  const sizeMB = Buffer.byteLength(json, 'utf8') / (1024 * 1024);
  if (sizeMB > 50) {
    return res.status(413).json({ error: `备份数据过大（${sizeMB.toFixed(1)}MB），请清理历史数据后再试` });
  }

  res.setHeader('Content-Disposition', `attachment; filename="backup_${new Date().toISOString().slice(0, 10)}.json"`);
  res.type('json').send(json);
});

router.post('/restore', (req, res) => {
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

  // Save pre-restore snapshot
  try {
    const tid2 = tid;
    const teacherClasses = drizzleDb.select().from(classes).where(eq(classes.teacherId, tid2)).all();
    const cids = teacherClasses.map(c => c.id);
    const snapshot = {
      version: BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      classes: teacherClasses,
      pricingTiers: drizzleDb.select().from(pricingTiers).where(eq(pricingTiers.teacherId, tid2)).all(),
      students: drizzleDb.select().from(students).where(eq(students.teacherId, tid2)).all(),
      classStudents: cids.length > 0
        ? drizzleDb.select().from(classStudents).where(inArray(classStudents.classId, cids)).all()
        : [],
      schedules: cids.length > 0
        ? drizzleDb.select().from(schedules).where(inArray(schedules.classId, cids)).all()
        : [],
      holidays: drizzleDb.select().from(holidays).where(eq(holidays.teacherId, tid2)).all(),
      semesters: drizzleDb.select().from(semesters).where(eq(semesters.teacherId, tid2)).all(),
    };
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(`./data/backup_pre_restore_${ts}.json`, JSON.stringify(snapshot));
  } catch {
    // Non-fatal: snapshot failure shouldn't block restore
  }

  // Force all teacher-scoped records to belong to the authenticated teacher
  const forceOwner = arr => (arr || []).map(r => ({ ...r, teacherId: tid }));

  // Fix legacy createdAt that stored literal "CURRENT_TIMESTAMP"
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const fixTimestamps = arr => (arr || []).map(r => ({
    ...r,
    createdAt: (!r.createdAt || r.createdAt === 'CURRENT_TIMESTAMP') ? now : r.createdAt,
  }));

  const restoreData = {
    classes: fixTimestamps(forceOwner(data.classes)),
    pricingTiers: fixTimestamps(forceOwner(data.pricingTiers || [])),
    students: fixTimestamps(forceOwner(data.students)),
    classStudents: data.classStudents || [],
    schedules: fixTimestamps(data.schedules),
    holidays: forceOwner(data.holidays || []),
    semesters: fixTimestamps(forceOwner(data.semesters || [])),
  };

  // Validate schedule and classStudents references point to restored classes
  const classIds = new Set(restoreData.classes.map(c => c.id));
  const studentIds = new Set(restoreData.students.map(s => s.id));
  restoreData.schedules = restoreData.schedules.filter(s => classIds.has(s.classId));
  restoreData.classStudents = restoreData.classStudents.filter(l => classIds.has(l.classId) && studentIds.has(l.studentId));

  const counts = {};

  try {
    db.transaction(() => {
      const existingClassIds = drizzleDb.select({ id: classes.id })
        .from(classes).where(eq(classes.teacherId, tid)).all().map(c => c.id);

      if (existingClassIds.length > 0) {
        drizzleDb.delete(schedules).where(inArray(schedules.classId, existingClassIds)).run();
        drizzleDb.delete(classStudents).where(inArray(classStudents.classId, existingClassIds)).run();
      }
      drizzleDb.delete(classes).where(eq(classes.teacherId, tid)).run();
      drizzleDb.delete(students).where(eq(students.teacherId, tid)).run();
      drizzleDb.delete(pricingTiers).where(eq(pricingTiers.teacherId, tid)).run();
      drizzleDb.delete(semesters).where(eq(semesters.teacherId, tid)).run();
      drizzleDb.delete(holidays).where(eq(holidays.teacherId, tid)).run();

      if (restoreData.semesters.length) { drizzleDb.insert(semesters).values(restoreData.semesters).run(); }
      if (restoreData.pricingTiers.length) { drizzleDb.insert(pricingTiers).values(restoreData.pricingTiers).run(); }
      if (restoreData.students.length) { drizzleDb.insert(students).values(restoreData.students).run(); }
      if (restoreData.classes.length) { drizzleDb.insert(classes).values(restoreData.classes).run(); }
      if (restoreData.classStudents.length) { drizzleDb.insert(classStudents).values(restoreData.classStudents).run(); }
      if (restoreData.schedules.length) { drizzleDb.insert(schedules).values(restoreData.schedules).run(); }
      if (restoreData.holidays.length) { drizzleDb.insert(holidays).values(restoreData.holidays).run(); }

      counts.classes = restoreData.classes.length;
      counts.students = restoreData.students.length;
      counts.schedules = restoreData.schedules.length;
      counts.semesters = restoreData.semesters.length;
    })();
  } catch (err) {
    return res.status(500).json({ error: `还原失败: ${err.message || '未知错误'}（事务已回滚，原数据保留）` });
  }

  res.json({ ok: true, restored: counts });
});

export default router;
