import { drizzleDb, db } from '../db/index.js';
import { auditLog } from '../db/schema.js';

const MAX_AUDIT_ROWS = 10000;

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

      const count = db.prepare('SELECT COUNT(*) as c FROM audit_log').get().c;
      if (count > MAX_AUDIT_ROWS) {
        db.prepare('DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log ORDER BY id ASC LIMIT ?)').run(count - MAX_AUDIT_ROWS);
      }
    })();
  } catch {
    // Audit failures must never break the main request
  }
}
