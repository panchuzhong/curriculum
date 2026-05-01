import { drizzleDb } from '../db/index.js';
import { auditLog } from '../db/schema.js';

export function logAudit({ teacherId, action, tableName, recordId, before, after }) {
  try {
    drizzleDb.insert(auditLog).values({
      teacherId,
      timestamp: new Date().toISOString(),
      action,
      tableName,
      recordId: recordId ?? null,
      beforeData: before != null ? JSON.stringify(before) : null,
      afterData: after != null ? JSON.stringify(after) : null,
    }).run();
  } catch {
    // Audit failures must never break the main request
  }
}
