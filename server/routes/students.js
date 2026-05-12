import { Router } from 'express';
import { drizzleDb, db } from '../db/index.js';
import { students, classes, classStudents } from '../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import handle from '../validations/handle.js';
import { validateCreateStudent, validateUpdateStudent } from '../validations/students.js';

const router = Router();
router.use(authMiddleware);

function getStudentWithClassIds(studentId) {
  const s = drizzleDb.select().from(students).where(eq(students.id, studentId)).get();
  if (!s) return null;
  const links = drizzleDb.select({ classId: classStudents.classId }).from(classStudents)
    .where(eq(classStudents.studentId, studentId)).all();
  return { ...s, classIds: links.map(l => l.classId) };
}

// Get all students for a teacher
router.get('/', (req, res) => {
  const result = drizzleDb.select().from(students)
    .where(eq(students.teacherId, req.teacherId)).all();
  const studentIds = result.map(s => s.id);
  const allLinks = studentIds.length
    ? drizzleDb.select({ studentId: classStudents.studentId, classId: classStudents.classId }).from(classStudents)
        .where(inArray(classStudents.studentId, studentIds)).all()
    : [];
  const linksByStudent = {};
  for (const l of allLinks) {
    (linksByStudent[l.studentId] ??= []).push(l.classId);
  }
  const isChinese = s => /[一-鿿]/.test(s.name);
  result.sort((a, b) => {
    const aC = isChinese(a), bC = isChinese(b);
    if (aC !== bC) return aC ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh') || b.id - a.id;
  });
  res.json(result.map(s => ({ ...s, classIds: linksByStudent[s.id] || [] })));
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

  const byClassStudents = drizzleDb.select().from(students)
    .where(and(eq(students.teacherId, req.teacherId), inArray(students.id, studentIds))).all();
  res.json(byClassStudents);
});

// Create a student
router.post('/', validateCreateStudent, handle, (req, res) => {
  const { name, birthDate, phone, parentName, parentPhone, note, classIds } = req.body;

  const result = drizzleDb.insert(students).values({
    teacherId: req.teacherId, name, birthDate, phone, parentName, parentPhone, note,
  }).run();
  const studentId = Number(result.lastInsertRowid);

  if (classIds && classIds.length > 0) {
    for (const classId of classIds) {
      const cls = drizzleDb.select().from(classes)
        .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
      if (cls) {
        drizzleDb.insert(classStudents).values({ classId, studentId }).run();
      }
    }
  }

  const created = getStudentWithClassIds(studentId);
  logAudit({ teacherId: req.teacherId, action: 'CREATE', tableName: 'students', recordId: studentId, after: created });
  res.json(created);
});

// Update a student
router.put('/:id', validateUpdateStudent, handle, (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(students)
    .where(and(eq(students.id, +id), eq(students.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const allowed = ['name', 'birthDate', 'phone', 'parentName', 'parentPhone', 'note'];
  const safeUpdates = Object.fromEntries(
    Object.entries(req.body).filter(([k, v]) => allowed.includes(k) && v !== undefined)
  );
  if (Object.keys(safeUpdates).length > 0) {
    drizzleDb.update(students).set(safeUpdates).where(eq(students.id, +id)).run();
  }

  const { classIds } = req.body;
  if (classIds !== undefined) {
    db.transaction(() => {
      drizzleDb.delete(classStudents).where(eq(classStudents.studentId, +id)).run();
      for (const classId of classIds) {
        const cls = drizzleDb.select().from(classes)
          .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
        if (cls) {
          drizzleDb.insert(classStudents).values({ classId, studentId: +id }).run();
        }
      }
    })();
  }

  const updated = getStudentWithClassIds(+id);
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'students', recordId: +id, before: existing, after: updated });
  res.json(updated);
});

// Delete a student
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(students)
    .where(and(eq(students.id, +id), eq(students.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.transaction(() => {
    drizzleDb.delete(classStudents).where(eq(classStudents.studentId, +id)).run();
    drizzleDb.delete(students).where(eq(students.id, +id)).run();
  })();
  logAudit({ teacherId: req.teacherId, action: 'DELETE', tableName: 'students', recordId: +id, before: existing });
  res.json({ ok: true });
});

export default router;
