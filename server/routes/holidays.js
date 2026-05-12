import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { holidays } from '../db/schema.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import handle from '../validations/handle.js';
import { validateCreateHoliday, validateUpdateHoliday, validateBatchHolidays } from '../validations/holidays.js';

const router = Router();
router.use(authMiddleware);

// Get all holidays for a teacher
router.get('/', (req, res) => {
  const result = drizzleDb.select().from(holidays)
    .where(eq(holidays.teacherId, req.teacherId)).all();
  res.json(result);
});

// Get holidays for a specific year
router.get('/:year', (req, res) => {
  const year = req.params.year;
  const result = drizzleDb.select().from(holidays)
    .where(and(
      eq(holidays.teacherId, req.teacherId),
      gte(holidays.date, `${year}-01-01`),
      lte(holidays.date, `${year}-12-31`),
    )).all();
  res.json(result);
});

// Create a holiday
router.post('/', validateCreateHoliday, handle, (req, res) => {
  const { date, type, name } = req.body;

  // Check for duplicate
  const existing = drizzleDb.select().from(holidays)
    .where(and(eq(holidays.teacherId, req.teacherId), eq(holidays.date, date))).get();
  if (existing) return res.status(409).json({ error: '该日期已有记录' });

  const result = drizzleDb.insert(holidays).values({
    teacherId: req.teacherId, date, type, name,
  }).run();
  const newId = Number(result.lastInsertRowid);
  const created = drizzleDb.select().from(holidays).where(eq(holidays.id, newId)).get();
  logAudit({ teacherId: req.teacherId, action: 'CREATE', tableName: 'holidays', recordId: newId, after: created });
  res.json(created);
});

// Update a holiday
router.put('/:id', validateUpdateHoliday, handle, (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(holidays)
    .where(and(eq(holidays.id, +id), eq(holidays.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const allowed = ['date', 'type', 'name'];
  const safeUpdates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (Object.keys(safeUpdates).length === 0) return res.status(400).json({ error: 'No valid fields' });

  // Check for duplicate date when changing date
  if (safeUpdates.date && safeUpdates.date !== existing.date) {
    const dup = drizzleDb.select().from(holidays)
      .where(and(eq(holidays.teacherId, req.teacherId), eq(holidays.date, safeUpdates.date))).get();
    if (dup) return res.status(409).json({ error: '该日期已有记录' });
  }

  drizzleDb.update(holidays).set(safeUpdates).where(eq(holidays.id, +id)).run();
  const updated = drizzleDb.select().from(holidays).where(eq(holidays.id, +id)).get();
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'holidays', recordId: +id, before: existing, after: updated });
  res.json(updated);
});

// Delete a holiday
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(holidays)
    .where(and(eq(holidays.id, +id), eq(holidays.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  drizzleDb.delete(holidays).where(eq(holidays.id, +id)).run();
  logAudit({ teacherId: req.teacherId, action: 'DELETE', tableName: 'holidays', recordId: +id, before: existing });
  res.json({ ok: true });
});

// Batch import holidays
router.post('/batch', validateBatchHolidays, handle, (req, res) => {
  const { items } = req.body; // [{date, type, name}]

  let count = 0;
  for (const item of items) {
    if (!item.date || !item.type) continue;
    const existing = drizzleDb.select().from(holidays)
      .where(and(eq(holidays.teacherId, req.teacherId), eq(holidays.date, item.date))).get();
    if (!existing) {
      drizzleDb.insert(holidays).values({
        teacherId: req.teacherId, date: item.date, type: item.type, name: item.name,
      }).run();
      count++;
    }
  }
  if (count > 0) {
    logAudit({ teacherId: req.teacherId, action: 'BATCH_CREATE', tableName: 'holidays', after: { count } });
  }
  res.json({ count });
});

export default router;
