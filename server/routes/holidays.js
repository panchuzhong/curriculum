import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { holidays } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

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
    .where(and(eq(holidays.teacherId, req.teacherId))).all()
    .filter(h => h.date.startsWith(year));
  res.json(result);
});

// Create a holiday
router.post('/', (req, res) => {
  const { date, type, name } = req.body;
  if (!date || !type) return res.status(400).json({ error: 'date and type required' });

  // Check for duplicate
  const existing = drizzleDb.select().from(holidays)
    .where(and(eq(holidays.teacherId, req.teacherId), eq(holidays.date, date))).get();
  if (existing) return res.status(409).json({ error: '该日期已有记录' });

  const result = drizzleDb.insert(holidays).values({
    teacherId: req.teacherId, date, type, name,
  }).run();
  res.json({ id: result.lastInsertRowid });
});

// Update a holiday
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(holidays)
    .where(and(eq(holidays.id, +id), eq(holidays.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  drizzleDb.update(holidays).set(req.body).where(eq(holidays.id, +id)).run();
  res.json({ ok: true });
});

// Delete a holiday
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(holidays)
    .where(and(eq(holidays.id, +id), eq(holidays.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  drizzleDb.delete(holidays).where(eq(holidays.id, +id)).run();
  res.json({ ok: true });
});

// Batch import holidays
router.post('/batch', (req, res) => {
  const { items } = req.body; // [{date, type, name}]
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

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
  res.json({ count });
});

export default router;
