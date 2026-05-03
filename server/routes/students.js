import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { students, classes, classStudents } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import handle from '../validations/handle.js';
import { validateCreateStudent, validateUpdateStudent } from '../validations/students.js';

const router = Router();
router.use(authMiddleware);

// Get all students for a teacher
router.get('/', (req, res) => {
  const result = drizzleDb.select().from(students)
    .where(eq(students.teacherId, req.teacherId)).all();
  const enriched = result.map(s => {
    const clsLinks = drizzleDb.select({ classId: classStudents.classId }).from(classStudents)
      .where(eq(classStudents.studentId, s.id)).all();
    return { ...s, classIds: clsLinks.map(l => l.classId) };
  });
  res.json(enriched);
});

// Get students for a specific class
router.get('/by-class/:classId', (req, res) => {
  const classId = +req.params.classId;
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const links = drizzleDb.select().from(classStudents)
    .where(eq(classStudents.classId, classId)).all();
  const studentIds = links.map(l => l.studentId);
  if (studentIds.length === 0) return res.json([]);

  const allStudents = drizzleDb.select().from(students)
    .where(eq(students.teacherId, req.teacherId)).all();
  res.json(allStudents.filter(s => studentIds.includes(s.id)));
});

// Create a student
router.post('/', validateCreateStudent, handle, (req, res) => {
  const { name, birthDate, phone, parentName, parentPhone, note, classIds } = req.body;

  const result = drizzleDb.insert(students).values({
    teacherId: req.teacherId, name, birthDate, phone, parentName, parentPhone, note,
  }).run();
  const studentId = result.lastInsertRowid;

  if (classIds && classIds.length > 0) {
    for (const classId of classIds) {
      const cls = drizzleDb.select().from(classes)
        .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId))).get();
      if (cls) {
        drizzleDb.insert(classStudents).values({ classId, studentId }).run();
      }
    }
  }

  res.json({ id: studentId });
});

// Update a student
router.put('/:id', validateUpdateStudent, handle, (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(students)
    .where(and(eq(students.id, +id), eq(students.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { name, birthDate, phone, parentName, parentPhone, note, classIds } = req.body;
  drizzleDb.update(students).set({
    name, birthDate, phone, parentName, parentPhone, note,
  }).where(eq(students.id, +id)).run();

  if (classIds !== undefined) {
    drizzleDb.delete(classStudents).where(eq(classStudents.studentId, +id)).run();
    for (const classId of classIds) {
      const cls = drizzleDb.select().from(classes)
        .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId))).get();
      if (cls) {
        drizzleDb.insert(classStudents).values({ classId, studentId: +id }).run();
      }
    }
  }

  res.json({ ok: true });
});

// Delete a student
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(students)
    .where(and(eq(students.id, +id), eq(students.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  drizzleDb.delete(classStudents).where(eq(classStudents.studentId, +id)).run();
  drizzleDb.delete(students).where(eq(students.id, +id)).run();
  res.json({ ok: true });
});

export default router;
