import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/audit-log?limit=100&table=schedules&action=DELETE
router.get('/', (req, res) => {
  const { limit = 100, table, action } = req.query;
  const cap = Math.min(+limit, 500);

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
