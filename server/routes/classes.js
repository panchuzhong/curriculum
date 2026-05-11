import { Router } from 'express';
import { drizzleDb, db } from '../db/index.js';
import { classes, students, classStudents, schedules } from '../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { getDefaultPrice } from '../db/seed.js';
import { logAudit } from '../services/audit.js';
import handle from '../validations/handle.js';
import { validateCreateClass, validateUpdateClass, validateClassStudent } from '../validations/classes.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const includeDeleted = req.query.includeDeleted === 'true';
  const conditions = [eq(classes.teacherId, req.teacherId)];
  if (!includeDeleted) conditions.push(eq(classes.deleted, false));
  const result = drizzleDb.select().from(classes)
    .where(and(...conditions))
    .all();
  res.json(result.map(c => ({ ...c, isDeleted: !!c.deleted })));
});

router.get('/locations/suggest', (req, res) => {
  const classLocs = db.prepare(
    "SELECT DISTINCT default_location_name FROM classes WHERE teacher_id = ? AND default_location_name IS NOT NULL AND default_location_name != '' AND deleted = 0"
  ).all(req.teacherId).map(r => r.default_location_name);
  const schedLocs = db.prepare(
    "SELECT DISTINCT s.location_name FROM schedules s JOIN classes c ON s.class_id = c.id WHERE c.teacher_id = ? AND s.location_name IS NOT NULL AND s.location_name != ''"
  ).all(req.teacherId).map(r => r.location_name);
  res.json([...new Set([...classLocs, ...schedLocs])].sort());
});

router.get('/:id', (req, res) => {
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, +req.params.id), eq(classes.teacherId, req.teacherId))).get();
  if (!cls) return res.status(404).json({ error: 'Not found' });
  res.json({ ...cls, isDeleted: !!cls.deleted });
});

router.post('/', validateCreateClass, handle, (req, res) => {
  const { name, grade, subject, studentCount, unitPrice, discountAmount, discountReason,
          isCompetition, defaultLocationName, defaultLocationLat, defaultLocationLng } = req.body;
  const price = unitPrice ?? getDefaultPrice(req.teacherId, studentCount);
  const result = drizzleDb.insert(classes).values({
    teacherId: req.teacherId, name, grade, subject, studentCount,
    unitPrice: price, discountAmount: discountAmount ?? 0, discountReason,
    isCompetition: isCompetition ?? false,
    defaultLocationName, defaultLocationLat, defaultLocationLng,
  }).run();
  const newId = Number(result.lastInsertRowid);
  const created = drizzleDb.select().from(classes).where(eq(classes.id, newId)).get();
  logAudit({ teacherId: req.teacherId, action: 'CREATE', tableName: 'classes', recordId: newId,
    after: { name, grade, subject, studentCount, unitPrice: price } });
  res.json({ ...created, isDeleted: !!created.deleted });
});

router.put('/:id', validateUpdateClass, handle, (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, +id), eq(classes.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const allowed = ['name', 'grade', 'subject', 'studentCount', 'unitPrice', 'discountAmount', 'discountReason', 'isCompetition', 'defaultLocationName', 'defaultLocationLat', 'defaultLocationLng'];
  const safeUpdates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (Object.keys(safeUpdates).length === 0) return res.status(400).json({ error: 'No valid fields' });
  drizzleDb.update(classes).set(safeUpdates).where(eq(classes.id, +id)).run();
  const updated = drizzleDb.select().from(classes).where(eq(classes.id, +id)).get();
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'classes', recordId: +id, before: existing, after: safeUpdates });
  res.json({ ...updated, isDeleted: !!updated.deleted });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, +id), eq(classes.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  drizzleDb.update(classes).set({ deleted: true }).where(eq(classes.id, +id)).run();
  logAudit({ teacherId: req.teacherId, action: 'DELETE', tableName: 'classes', recordId: +id, before: existing });
  res.json({ ok: true });
});

// Restore a soft-deleted class
router.post('/:id/restore', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, +id), eq(classes.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!existing.deleted) return res.status(400).json({ error: '该班级未被删除,无需恢复' });
  drizzleDb.update(classes).set({ deleted: false }).where(eq(classes.id, +id)).run();
  const restored = drizzleDb.select().from(classes).where(eq(classes.id, +id)).get();
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'classes', recordId: +id, before: existing, after: { deleted: false } });
  res.json({ ...restored, isDeleted: !!restored.deleted });
});

// ── Sub-resource: students under a class ──
const classStudentRouter = Router({ mergeParams: true });

classStudentRouter.get('/', (req, res) => {
  const classId = +req.params.classId;
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const links = drizzleDb.select().from(classStudents)
    .where(eq(classStudents.classId, classId)).all();
  const studentIds = links.map(l => l.studentId);
  if (studentIds.length === 0) return res.json([]);

  const classStudentsData = drizzleDb.select().from(students)
    .where(and(eq(students.teacherId, req.teacherId), inArray(students.id, studentIds))).all();
  res.json(classStudentsData);
});

classStudentRouter.post('/', validateClassStudent, handle, (req, res) => {
  const classId = +req.params.classId;
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const { name, phone, parentPhone, birthDate, parentName, note } = req.body;

  const result = drizzleDb.insert(students).values({
    teacherId: req.teacherId, name, phone, parentPhone, birthDate, parentName, note,
  }).run();
  const studentId = Number(result.lastInsertRowid);
  drizzleDb.insert(classStudents).values({ classId, studentId }).run();
  const created = drizzleDb.select().from(students).where(eq(students.id, studentId)).get();
  const out = { ...created, classIds: [classId] };
  logAudit({ teacherId: req.teacherId, action: 'CREATE', tableName: 'students', recordId: studentId, after: out });
  res.json(out);
});

classStudentRouter.delete('/:studentId', (req, res) => {
  const { classId, studentId } = req.params;
  const existing = drizzleDb.select().from(students)
    .where(and(eq(students.id, +studentId), eq(students.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  drizzleDb.delete(classStudents)
    .where(and(eq(classStudents.classId, +classId), eq(classStudents.studentId, +studentId)))
    .run();
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'class_students', recordId: +studentId, before: { classId: +classId, studentId: +studentId }, after: null });
  res.json({ ok: true });
});

router.use('/:classId/students', classStudentRouter);

export default router;
