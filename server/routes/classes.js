import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { classes } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { getDefaultPrice } from '../db/seed.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const result = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false)))
    .all();
  res.json(result);
});

router.post('/', (req, res) => {
  const { name, grade, subject, studentCount, unitPrice, discountAmount, discountReason,
          isCompetition, defaultLocationName, defaultLocationLat, defaultLocationLng } = req.body;
  if (!name || !grade || !subject || studentCount == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const price = unitPrice ?? getDefaultPrice(req.teacherId, studentCount);
  const result = drizzleDb.insert(classes).values({
    teacherId: req.teacherId, name, grade, subject, studentCount,
    unitPrice: price, discountAmount: discountAmount ?? 0, discountReason,
    isCompetition: isCompetition ?? false,
    defaultLocationName, defaultLocationLat, defaultLocationLng,
  }).run();
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, +id), eq(classes.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  drizzleDb.update(classes).set(req.body).where(eq(classes.id, +id)).run();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, +id), eq(classes.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  drizzleDb.update(classes).set({ deleted: true }).where(eq(classes.id, +id)).run();
  res.json({ ok: true });
});

export default router;
