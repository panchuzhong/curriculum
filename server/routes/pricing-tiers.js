import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { pricingTiers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import handle from '../validations/handle.js';
import { validateCreateTier, validateUpdateTier } from '../validations/pricing-tiers.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const result = drizzleDb.select().from(pricingTiers)
    .where(eq(pricingTiers.teacherId, req.teacherId)).all();
  res.json(result);
});

router.post('/', validateCreateTier, handle, (req, res) => {
  const { minStudents, maxStudents, pricePerStudentPerHour } = req.body;
  const result = drizzleDb.insert(pricingTiers).values({
    teacherId: req.teacherId, minStudents, maxStudents, pricePerStudentPerHour,
  }).run();
  const newId = Number(result.lastInsertRowid);
  const created = drizzleDb.select().from(pricingTiers).where(eq(pricingTiers.id, newId)).get();
  logAudit({ teacherId: req.teacherId, action: 'CREATE', tableName: 'pricing_tiers', recordId: newId, after: created });
  res.json(created);
});

router.put('/:id', validateUpdateTier, handle, (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(pricingTiers)
    .where(and(eq(pricingTiers.id, +id), eq(pricingTiers.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const allowed = ['minStudents', 'maxStudents', 'pricePerStudentPerHour'];
  const safeUpdates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (Object.keys(safeUpdates).length === 0) return res.status(400).json({ error: 'No valid fields' });
  // Cross-field validation using stored record as fallback
  const newMin = safeUpdates.minStudents ?? existing.minStudents;
  const newMax = safeUpdates.maxStudents ?? existing.maxStudents;
  if (newMax < newMin) return res.status(400).json({ error: '最大人数须不小于最小人数' });
  drizzleDb.update(pricingTiers).set(safeUpdates).where(eq(pricingTiers.id, +id)).run();
  const updated = drizzleDb.select().from(pricingTiers).where(eq(pricingTiers.id, +id)).get();
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'pricing_tiers', recordId: +id, before: existing, after: safeUpdates });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(pricingTiers)
    .where(and(eq(pricingTiers.id, +id), eq(pricingTiers.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  drizzleDb.delete(pricingTiers)
    .where(and(eq(pricingTiers.id, +id), eq(pricingTiers.teacherId, req.teacherId))).run();
  logAudit({ teacherId: req.teacherId, action: 'DELETE', tableName: 'pricing_tiers', recordId: +id, before: existing });
  res.json({ ok: true });
});

export default router;
