import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { pricingTiers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const result = drizzleDb.select().from(pricingTiers)
    .where(eq(pricingTiers.teacherId, req.teacherId)).all();
  res.json(result);
});

router.post('/', (req, res) => {
  const { minStudents, maxStudents, pricePerStudentPerHour } = req.body;
  if (minStudents == null || maxStudents == null || pricePerStudentPerHour == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const result = drizzleDb.insert(pricingTiers).values({
    teacherId: req.teacherId, minStudents, maxStudents, pricePerStudentPerHour,
  }).run();
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(pricingTiers)
    .where(and(eq(pricingTiers.id, +id), eq(pricingTiers.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  drizzleDb.update(pricingTiers).set(req.body).where(eq(pricingTiers.id, +id)).run();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  drizzleDb.delete(pricingTiers)
    .where(and(eq(pricingTiers.id, +id), eq(pricingTiers.teacherId, req.teacherId))).run();
  res.json({ ok: true });
});

export default router;
