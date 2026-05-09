import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { semesters } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import handle from '../validations/handle.js';
import { validateCreateSemester, validateUpdateSemester } from '../validations/semesters.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const result = drizzleDb.select().from(semesters)
    .where(eq(semesters.teacherId, req.teacherId)).all();
  res.json(result);
});

router.post('/', validateCreateSemester, handle, (req, res) => {
  const { name, type, startDate, endDate } = req.body;
  const result = drizzleDb.insert(semesters).values({
    teacherId: req.teacherId, name, type, startDate, endDate,
  }).run();
  const newId = Number(result.lastInsertRowid);
  const created = drizzleDb.select().from(semesters).where(eq(semesters.id, newId)).get();
  res.json(created);
});

router.put('/:id', validateUpdateSemester, handle, (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(semesters)
    .where(and(eq(semesters.id, +id), eq(semesters.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const allowed = ['name', 'type', 'startDate', 'endDate'];
  const safeUpdates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (Object.keys(safeUpdates).length === 0) return res.status(400).json({ error: 'No valid fields' });
  drizzleDb.update(semesters).set(safeUpdates).where(eq(semesters.id, +id)).run();
  const updated = drizzleDb.select().from(semesters).where(eq(semesters.id, +id)).get();
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(semesters)
    .where(and(eq(semesters.id, +id), eq(semesters.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  drizzleDb.delete(semesters).where(eq(semesters.id, +id)).run();
  res.json({ ok: true });
});

export default router;
