import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/audit-log?limit=100&table=schedules&action=DELETE
router.get('/', (req, res) => {
  const { limit = 100, table, action } = req.query;
  const cap = Math.min(+limit, 500);

  let results = drizzleDb.select().from(auditLog)
    .where(eq(auditLog.teacherId, req.teacherId))
    .orderBy(desc(auditLog.id))
    .limit(cap * 4) // fetch extra for JS filtering
    .all();

  if (table) results = results.filter(r => r.tableName === table);
  if (action) results = results.filter(r => r.action === action);
  results = results.slice(0, cap);

  res.json(results.map(r => ({
    ...r,
    beforeData: r.beforeData ? JSON.parse(r.beforeData) : null,
    afterData: r.afterData ? JSON.parse(r.afterData) : null,
  })));
});

export default router;
