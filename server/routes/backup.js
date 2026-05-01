import { Router } from 'express';
import { drizzleDb, db } from '../db/index.js';
import { classes, pricingTiers, students, classStudents, schedules, holidays, semesters } from '../db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const tid = req.teacherId;
  const teacherClasses = drizzleDb.select().from(classes).where(eq(classes.teacherId, tid)).all();
  const classIds = teacherClasses.map(c => c.id);

  const data = {
    version: 1,
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

  res.setHeader('Content-Disposition', `attachment; filename="backup_${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
});

router.post('/restore', (req, res) => {
  const tid = req.teacherId;
  const data = req.body;

  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Invalid backup data' });
  }

  // Force all teacher-scoped records to belong to the authenticated teacher
  const forceOwner = arr => (arr || []).map(r => ({ ...r, teacherId: tid }));

  const restoreData = {
    classes: forceOwner(data.classes),
    pricingTiers: forceOwner(data.pricingTiers),
    students: forceOwner(data.students),
    classStudents: data.classStudents || [],
    schedules: data.schedules || [],
    holidays: forceOwner(data.holidays),
    semesters: forceOwner(data.semesters),
  };

  const counts = {};

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

  res.json({ ok: true, restored: counts });
});

export default router;
