import { drizzleDb, db } from '../db/index.js';
import { auditLog } from '../db/schema.js';

export const MAX_AUDIT_ROWS = 10000;
const CLEANUP_INTERVAL = 100;
let insertCount = 0;

export function trimAuditLog({ teacherId, keep = MAX_AUDIT_ROWS }) {
  const keepCount = Math.max(0, Math.min(Number(keep) || 0, MAX_AUDIT_ROWS));
  const count = db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE teacher_id = ?').get(teacherId).c;
  const deleteCount = Math.max(0, count - keepCount);

  if (deleteCount > 0) {
    db.prepare(
      `DELETE FROM audit_log
       WHERE id IN (
         SELECT id FROM audit_log
         WHERE teacher_id = ?
         ORDER BY id ASC
         LIMIT ?
       )`
    ).run(teacherId, deleteCount);
  }

  return {
    keep: keepCount,
    before: count,
    deleted: deleteCount,
    remaining: count - deleteCount,
  };
}

export function logAudit({ teacherId, action, tableName, recordId, before, after }) {
  try {
    db.transaction(() => {
      drizzleDb.insert(auditLog).values({
        teacherId,
        timestamp: new Date().toISOString(),
        action,
        tableName,
        recordId: recordId ?? null,
        beforeData: before != null ? JSON.stringify(before) : null,
        afterData: after != null ? JSON.stringify(after) : null,
      }).run();

      insertCount++;
      if (insertCount % CLEANUP_INTERVAL !== 0) return;
      trimAuditLog({ teacherId });
    })();
  } catch (err) {
    // Audit failures must never break the main request
    console.error('Audit log error:', err.message);
  }
}
