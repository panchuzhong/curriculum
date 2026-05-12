import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const VALID_TABLES = new Set(['schedules', 'classes', 'students', 'holidays', 'class_students', 'pricing_tiers', 'semesters', 'teachers']);
const VALID_ACTIONS = new Set(['CREATE', 'UPDATE', 'DELETE', 'BATCH_CREATE', 'BATCH_UPDATE', 'BATCH_DELETE']);

// GET /api/audit-log?limit=100&table=schedules&action=DELETE
router.get('/', (req, res) => {
  const { limit = 100, table, action } = req.query;
  const cap = Math.max(1, Math.min(parseInt(limit) || 100, 500));

  if (table && !VALID_TABLES.has(table)) {
    return res.status(400).json({ error: `table 须为: ${[...VALID_TABLES].join('/')}` });
  }
  if (action && !VALID_ACTIONS.has(action)) {
    return res.status(400).json({ error: `action 须为: ${[...VALID_ACTIONS].join('/')}` });
  }

  const conditions = [eq(auditLog.teacherId, req.teacherId)];
  if (table) conditions.push(eq(auditLog.tableName, table));
  if (action) conditions.push(eq(auditLog.action, action));

  const results = drizzleDb.select().from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.id))
    .limit(cap)
    .all();

  res.json(results.map(r => ({
    ...r,
    beforeData: r.beforeData ? JSON.parse(r.beforeData) : null,
    afterData: r.afterData ? JSON.parse(r.afterData) : null,
  })));
});

export default router;
