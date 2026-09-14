import { Router } from 'express';
import { drizzleDb, db } from '../db/index.js';
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
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'year 须为4位年份' });
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

  let newId;
  try {
    // IMMEDIATE takes the write lock up front, so the duplicate check and the
    // insert serialize even against another process sharing the database file.
    newId = db.transaction(() => {
      const existing = drizzleDb.select().from(holidays)
        .where(and(eq(holidays.teacherId, req.teacherId), eq(holidays.date, date))).get();
      if (existing) throw new Error('DUPLICATE_DATE');
      const result = drizzleDb.insert(holidays).values({
        teacherId: req.teacherId, date, type, name,
      }).run();
      return Number(result.lastInsertRowid);
    }).immediate();
  } catch (e) {
    if (e.message === 'DUPLICATE_DATE') return res.status(409).json({ error: '该日期已有记录' });
    throw e;
  }
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

  // Dup check and update in one IMMEDIATE transaction (same cross-process
  // reasoning as the create route).
  try {
    db.transaction(() => {
      if (safeUpdates.date && safeUpdates.date !== existing.date) {
        const dup = drizzleDb.select().from(holidays)
          .where(and(eq(holidays.teacherId, req.teacherId), eq(holidays.date, safeUpdates.date))).get();
        if (dup) throw new Error('DUPLICATE_DATE');
      }
      drizzleDb.update(holidays).set(safeUpdates).where(eq(holidays.id, +id)).run();
    }).immediate();
  } catch (e) {
    if (e.message === 'DUPLICATE_DATE') return res.status(409).json({ error: '该日期已有记录' });
    throw e;
  }
  const updated = drizzleDb.select().from(holidays).where(eq(holidays.id, +id)).get();
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'holidays', recordId: +id, before: existing, after: updated });
  res.json(updated);
});

// Delete a holiday
router.delete('/:id', (req, res) => {
  const id = +req.params.id;
  if (!id || id < 1) return res.status(400).json({ error: '无效的ID' });
  const existing = drizzleDb.select().from(holidays)
    .where(and(eq(holidays.id, id), eq(holidays.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  drizzleDb.delete(holidays).where(eq(holidays.id, id)).run();
  logAudit({ teacherId: req.teacherId, action: 'DELETE', tableName: 'holidays', recordId: id, before: existing });
  res.json({ ok: true });
});

// Batch import holidays
router.post('/batch', validateBatchHolidays, handle, (req, res) => {
  const { items } = req.body; // [{date, type, name}]

  let count = 0;
  let skipped = 0;
  db.transaction(() => {
    for (const item of items) {
      const existing = drizzleDb.select().from(holidays)
        .where(and(eq(holidays.teacherId, req.teacherId), eq(holidays.date, item.date))).get();
      if (!existing) {
        drizzleDb.insert(holidays).values({
          teacherId: req.teacherId, date: item.date, type: item.type, name: item.name,
        }).run();
        count++;
      } else {
        skipped++;
      }
    }
  })();
  if (count > 0) {
    logAudit({ teacherId: req.teacherId, action: 'BATCH_CREATE', tableName: 'holidays', after: { count } });
  }
  res.json({ count, skipped });
});

export default router;
