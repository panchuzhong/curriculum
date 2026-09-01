import { Router } from 'express';
import { drizzleDb, db } from '../db/index.js';
import { semesters } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { clearSemesterCache } from '../services/schedule-helpers.js';
import handle from '../validations/handle.js';
import { validateCreateSemester, validateUpdateSemester } from '../validations/semesters.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const result = drizzleDb.select().from(semesters)
    .where(eq(semesters.teacherId, req.teacherId)).all();
  res.json(result);
});

router.post('/', validateCreateSemester, handle, (req, res) => {
  const { name, type, startDate, endDate } = req.body;
  let created;
  try {
    // Overlap check + insert must be atomic so concurrent requests (e.g. from a
    // second server process sharing the SQLite file) cannot both pass the check.
    db.transaction(() => {
      // Half-open comparison: a semester that starts on the day another ends is
      // contiguous, not overlapping.
      const existing = drizzleDb.select().from(semesters)
        .where(eq(semesters.teacherId, req.teacherId)).all();
      const overlaps = existing.some(s => startDate < s.endDate && endDate > s.startDate);
      if (overlaps) {
        const err = new Error('overlapping semester');
        err.status = 409;
        throw err;
      }
      const result = drizzleDb.insert(semesters).values({
        teacherId: req.teacherId, name, type, startDate, endDate,
      }).run();
      created = drizzleDb.select().from(semesters).where(eq(semesters.id, Number(result.lastInsertRowid))).get();
    })();
  } catch (e) {
    if (e.status === 409) return res.status(409).json({ error: '该教师已有日期重叠的学期' });
    throw e;
  }
  logAudit({ teacherId: req.teacherId, action: 'CREATE', tableName: 'semesters', recordId: created.id, after: created });
  clearSemesterCache();
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
  // Cross-field validation using stored record as fallback
  const newStart = safeUpdates.startDate ?? existing.startDate;
  const newEnd = safeUpdates.endDate ?? existing.endDate;
  if (newEnd < newStart) return res.status(400).json({ error: '结束日期须不小于开始日期' });
  // Check for overlapping semesters (excluding current), atomically with update
  try {
    db.transaction(() => {
      const allSemesters = drizzleDb.select().from(semesters)
        .where(eq(semesters.teacherId, req.teacherId)).all();
      const overlaps = allSemesters.some(s => s.id !== +id && newStart < s.endDate && newEnd > s.startDate);
      if (overlaps) {
        const err = new Error('overlapping semester');
        err.status = 409;
        throw err;
      }
      drizzleDb.update(semesters).set(safeUpdates).where(eq(semesters.id, +id)).run();
    })();
  } catch (e) {
    if (e.status === 409) return res.status(409).json({ error: '该教师已有日期重叠的学期' });
    throw e;
  }
  const updated = drizzleDb.select().from(semesters).where(eq(semesters.id, +id)).get();
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'semesters', recordId: +id, before: existing, after: safeUpdates });
  clearSemesterCache();
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const id = +req.params.id;
  if (!id || id < 1) return res.status(400).json({ error: '无效的ID' });
  const existing = drizzleDb.select().from(semesters)
    .where(and(eq(semesters.id, id), eq(semesters.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  drizzleDb.delete(semesters).where(eq(semesters.id, id)).run();
  logAudit({ teacherId: req.teacherId, action: 'DELETE', tableName: 'semesters', recordId: id, before: existing });
  clearSemesterCache();
  res.json({ ok: true });
});

export default router;
