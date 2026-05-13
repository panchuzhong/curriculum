import { Router } from 'express';
import { drizzleDb, db } from '../db/index.js';
import { classes, students, classStudents, classPricing } from '../db/schema.js';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { getDefaultPrice } from '../db/seed.js';
import { logAudit } from '../services/audit.js';
import handle from '../validations/handle.js';
import { validateCreateClass, validateUpdateClass, validateClassStudent, validateCreatePricing, validateUpdatePricing } from '../validations/classes.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const includeDeleted = req.query.includeDeleted === 'true';
  const conditions = [eq(classes.teacherId, req.teacherId)];
  if (!includeDeleted) conditions.push(eq(classes.deleted, false));
  const result = drizzleDb.select().from(classes)
    .where(and(...conditions))
    .all();

  if (result.length > 0) {
    const ids = result.map(c => c.id);
    const ph = ids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT class_id, MAX(date || ' ' || start_time) as t FROM schedules WHERE class_id IN (${ph}) GROUP BY class_id`
    ).all(...ids);
    const last = Object.fromEntries(rows.map(r => [r.class_id, r.t]));
    result.sort((a, b) => (last[b.id] || '').localeCompare(last[a.id] || ''));
  }

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

  // Create initial pricing record
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  drizzleDb.insert(classPricing).values({
    classId: newId, studentCount, unitPrice: price,
    discountAmount: discountAmount ?? 0, discountReason,
    effectiveFrom: todayStr,
  }).run();

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

  let studentId, created;
  db.transaction(() => {
    const result = drizzleDb.insert(students).values({
      teacherId: req.teacherId, name, phone, parentPhone, birthDate, parentName, note,
    }).run();
    studentId = Number(result.lastInsertRowid);
    const existingLink = drizzleDb.select().from(classStudents)
      .where(and(eq(classStudents.classId, classId), eq(classStudents.studentId, studentId))).get();
    if (!existingLink) {
      drizzleDb.insert(classStudents).values({ classId, studentId }).run();
    }
    created = drizzleDb.select().from(students).where(eq(students.id, studentId)).get();
  })();
  const out = { ...created, classIds: [classId] };
  logAudit({ teacherId: req.teacherId, action: 'CREATE', tableName: 'students', recordId: studentId, after: out });
  res.json(out);
});

classStudentRouter.delete('/:studentId', (req, res) => {
  const { classId, studentId } = req.params;
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, +classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  const existing = drizzleDb.select().from(students)
    .where(and(eq(students.id, +studentId), eq(students.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Student not found' });

  const link = drizzleDb.select().from(classStudents)
    .where(and(eq(classStudents.classId, +classId), eq(classStudents.studentId, +studentId))).get();
  if (!link) return res.status(404).json({ error: 'Student not in this class' });

  drizzleDb.delete(classStudents)
    .where(and(eq(classStudents.classId, +classId), eq(classStudents.studentId, +studentId)))
    .run();
  logAudit({ teacherId: req.teacherId, action: 'DELETE', tableName: 'class_students', recordId: +studentId, before: { classId: +classId, studentId: +studentId }, after: null });
  res.json({ ok: true });
});

// ── Sub-resource: pricing records under a class ──
const pricingRouter = Router({ mergeParams: true });

// Get pricing history for a class
pricingRouter.get('/', (req, res) => {
  const classId = +req.params.classId;
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const records = drizzleDb.select().from(classPricing)
    .where(eq(classPricing.classId, classId))
    .orderBy(desc(classPricing.effectiveFrom))
    .all();
  res.json(records);
});

// Add a new pricing version
pricingRouter.post('/', validateCreatePricing, handle, (req, res) => {
  const classId = +req.params.classId;
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const { studentCount, unitPrice, effectiveFrom, discountAmount, discountReason } = req.body;

  // Check for duplicate effective date
  const existing = drizzleDb.select().from(classPricing)
    .where(and(eq(classPricing.classId, classId), eq(classPricing.effectiveFrom, effectiveFrom)))
    .get();
  if (existing) return res.status(409).json({ error: '该日期已有定价记录' });

  const result = drizzleDb.insert(classPricing).values({
    classId, studentCount, unitPrice,
    discountAmount: discountAmount ?? 0,
    discountReason,
    effectiveFrom,
  }).run();

  // Sync latest pricing to classes table
  const latest = drizzleDb.select().from(classPricing)
    .where(eq(classPricing.classId, classId))
    .orderBy(desc(classPricing.effectiveFrom))
    .get();
  if (latest) {
    drizzleDb.update(classes).set({
      studentCount: latest.studentCount,
      unitPrice: latest.unitPrice,
      discountAmount: latest.discountAmount,
      discountReason: latest.discountReason,
    }).where(eq(classes.id, classId)).run();
  }

  const created = drizzleDb.select().from(classPricing).where(eq(classPricing.id, Number(result.lastInsertRowid))).get();
  logAudit({ teacherId: req.teacherId, action: 'CREATE', tableName: 'class_pricing', recordId: created.id, after: created });
  res.json(created);
});

// Update a pricing record
pricingRouter.put('/:pricingId', validateUpdatePricing, handle, (req, res) => {
  const pricingId = +req.params.pricingId;
  const record = drizzleDb.select().from(classPricing).where(eq(classPricing.id, pricingId)).get();
  if (!record) return res.status(404).json({ error: 'Pricing record not found' });

  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, record.classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const allowed = ['studentCount', 'unitPrice', 'discountAmount', 'discountReason', 'effectiveFrom'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields' });

  // Check effectiveFrom uniqueness if changed
  if (updates.effectiveFrom && updates.effectiveFrom !== record.effectiveFrom) {
    const dup = drizzleDb.select().from(classPricing)
      .where(and(eq(classPricing.classId, record.classId), eq(classPricing.effectiveFrom, updates.effectiveFrom)))
      .get();
    if (dup) return res.status(409).json({ error: '该日期已有定价记录' });
  }

  drizzleDb.update(classPricing).set(updates).where(eq(classPricing.id, pricingId)).run();

  // Sync latest to classes table
  const latest = drizzleDb.select().from(classPricing)
    .where(eq(classPricing.classId, record.classId))
    .orderBy(desc(classPricing.effectiveFrom))
    .get();
  if (latest) {
    drizzleDb.update(classes).set({
      studentCount: latest.studentCount,
      unitPrice: latest.unitPrice,
      discountAmount: latest.discountAmount,
      discountReason: latest.discountReason,
    }).where(eq(classes.id, record.classId)).run();
  }

  const updated = drizzleDb.select().from(classPricing).where(eq(classPricing.id, pricingId)).get();
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'class_pricing', recordId: pricingId, before: record, after: updates });
  res.json(updated);
});

// Delete a pricing record (keep at least one)
pricingRouter.delete('/:pricingId', (req, res) => {
  const pricingId = +req.params.pricingId;
  const record = drizzleDb.select().from(classPricing).where(eq(classPricing.id, pricingId)).get();
  if (!record) return res.status(404).json({ error: 'Pricing record not found' });

  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, record.classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const count = drizzleDb.select({ id: classPricing.id }).from(classPricing)
    .where(eq(classPricing.classId, record.classId)).all();
  if (count.length <= 1) return res.status(400).json({ error: '至少保留一条定价记录' });

  drizzleDb.delete(classPricing).where(eq(classPricing.id, pricingId)).run();

  // Sync latest to classes table
  const latest = drizzleDb.select().from(classPricing)
    .where(eq(classPricing.classId, record.classId))
    .orderBy(desc(classPricing.effectiveFrom))
    .get();
  if (latest) {
    drizzleDb.update(classes).set({
      studentCount: latest.studentCount,
      unitPrice: latest.unitPrice,
      discountAmount: latest.discountAmount,
      discountReason: latest.discountReason,
    }).where(eq(classes.id, record.classId)).run();
  }

  logAudit({ teacherId: req.teacherId, action: 'DELETE', tableName: 'class_pricing', recordId: pricingId, before: record });
  res.json({ ok: true });
});

router.use('/:classId/pricing', pricingRouter);
router.use('/:classId/students', classStudentRouter);

export default router;
