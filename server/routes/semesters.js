import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { semesters } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const result = drizzleDb.select().from(semesters)
    .where(eq(semesters.teacherId, req.teacherId)).all();
  res.json(result);
});

router.post('/', (req, res) => {
  const { name, type, startDate, endDate } = req.body;
  if (!name || !type || !startDate || !endDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const result = drizzleDb.insert(semesters).values({
    teacherId: req.teacherId, name, type, startDate, endDate,
  }).run();
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(semesters)
    .where(and(eq(semesters.id, +id), eq(semesters.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  drizzleDb.update(semesters).set(req.body).where(eq(semesters.id, +id)).run();
  res.json({ ok: true });
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
