import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { students, classes } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

function verifyClassOwnership(classId, teacherId) {
  return drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, teacherId), eq(classes.deleted, false)))
    .get();
}

router.get('/:classId/students', (req, res) => {
  if (!verifyClassOwnership(+req.params.classId, req.teacherId)) {
    return res.status(404).json({ error: 'Class not found' });
  }
  const result = drizzleDb.select().from(students)
    .where(eq(students.classId, +req.params.classId)).all();
  res.json(result);
});

router.post('/:classId/students', (req, res) => {
  if (!verifyClassOwnership(+req.params.classId, req.teacherId)) {
    return res.status(404).json({ error: 'Class not found' });
  }
  const { name, phone, parentPhone, note } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = drizzleDb.insert(students).values({
    classId: +req.params.classId, name, phone, parentPhone, note,
  }).run();
  res.json({ id: result.lastInsertRowid });
});

router.delete('/:classId/students/:sid', (req, res) => {
  if (!verifyClassOwnership(+req.params.classId, req.teacherId)) {
    return res.status(404).json({ error: 'Class not found' });
  }
  drizzleDb.delete(students)
    .where(and(eq(students.id, +req.params.sid), eq(students.classId, +req.params.classId)))
    .run();
  res.json({ ok: true });
});

export default router;
