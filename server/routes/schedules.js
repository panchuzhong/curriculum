import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { schedules, classes, semesters, holidays, classStudents, classPricing } from '../db/schema.js';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { isHoliday } from '../services/holidays.js';
import handle from '../validations/handle.js';
import { validateCreateSchedule, validateBatchCreate, validateBatchUpdate, validateBatchDelete, validateUpdateSchedule } from '../validations/schedules.js';
import { logAudit } from '../services/audit.js';
import { toLocalDateStr, toMin, resolveRange, toCSV, detectConflictGroups, getScheduleWithClass, calcDurationBilling, getTeacherSemesters } from '../services/schedule-helpers.js';

const router = Router();
router.use(authMiddleware);

function getConflictsForSchedule(scheduleId, teacherId) {
  const s = drizzleDb.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
  if (!s) return [];
  const teacherClasses = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, teacherId), eq(classes.deleted, false))).all();
  const classMap = {};
  teacherClasses.forEach(c => classMap[c.id] = c);
  const teacherClassIds = Object.keys(classMap).map(Number);
  const daySchedules = drizzleDb.select().from(schedules)
    .where(and(eq(schedules.date, s.date), inArray(schedules.classId, teacherClassIds))).all()
    .filter(x => x.id !== scheduleId);
  const conflicts = [];
  const sStart = toMin(s.startTime);
  const sEnd = toMin(s.endTime) >= sStart ? toMin(s.endTime) : toMin(s.endTime) + 24 * 60;
  for (const other of daySchedules) {
    const oStart = toMin(other.startTime);
    const oEnd = toMin(other.endTime) >= oStart ? toMin(other.endTime) : toMin(other.endTime) + 24 * 60;
    if (sStart < oEnd && oStart < sEnd) {
      const cls = classMap[other.classId];
      conflicts.push({ id: other.id, classId: other.classId, className: cls?.name, startTime: other.startTime, endTime: other.endTime });
    }
  }
  return conflicts;
}

// ── CRUD ──

router.get('/', (req, res) => {
  const { classId, studentId, limit, offset } = req.query;
  const { start, end } = resolveRange(req.query);
  if (!start || !end) return res.status(400).json({ error: 'start/end or range required' });
  const pageLimit = limit ? Math.max(1, Math.min(parseInt(limit) || 100, 1000)) : null;
  const pageOffset = offset ? Math.max(0, parseInt(offset) || 0) : 0;

  const teacherClasses = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
  let classIds = teacherClasses.map(c => c.id);
  if (classIds.length === 0) return res.json([]);
  if (classId) {
    const queryClassIds = classId.split(',').map(Number).filter(Boolean);
    if (queryClassIds.length) classIds = classIds.filter(id => queryClassIds.includes(id));
  }
  if (studentId) {
    const studentClasses = drizzleDb.select({ classId: classStudents.classId }).from(classStudents)
      .where(eq(classStudents.studentId, +studentId)).all();
    const studentClassIds = new Set(studentClasses.map(c => c.classId));
    classIds = classIds.filter(id => studentClassIds.has(id));
  }

  let query = drizzleDb.select().from(schedules)
    .where(and(gte(schedules.date, start), lte(schedules.date, end), inArray(schedules.classId, classIds)))
    .orderBy(schedules.date, schedules.startTime);
  if (pageLimit != null) query = query.limit(pageLimit).offset(pageOffset);
  const result = query.all();

  const classMap = {};
  teacherClasses.forEach(c => classMap[c.id] = c);

  res.json(result.map(s => ({ ...s, class: classMap[s.classId] })));
});

router.post('/', validateCreateSchedule, handle, (req, res) => {
  const { classId, date, startTime, endTime, durationBilling, locationName, locationLat, locationLng } = req.body;
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const billing = calcDurationBilling(startTime, endTime, durationBilling);
  const result = drizzleDb.insert(schedules).values({
    classId, date, startTime, endTime, durationBilling: billing,
    locationName: locationName ?? cls.defaultLocationName,
    locationLat: locationLat ?? cls.defaultLocationLat,
    locationLng: locationLng ?? cls.defaultLocationLng,
  }).run();
  const created = getScheduleWithClass(Number(result.lastInsertRowid), req.teacherId);
  logAudit({ teacherId: req.teacherId, action: 'CREATE', tableName: 'schedules', recordId: created.id, after: created });
  const warnings = getConflictsForSchedule(created.id, req.teacherId);
  res.json({ ...created, warnings: warnings.length > 0 ? warnings : undefined });
});

// ── Batch operations (must be before /:id routes) ──

router.post('/batch', validateBatchCreate, handle, (req, res) => {
  const { classId, semesterId, weekday, dates: manualDates, startTime, endTime, durationBilling, preview } = req.body;
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const billing = calcDurationBilling(startTime, endTime, durationBilling);
  let targetDates = [];

  if (manualDates && manualDates.length > 0) {
    targetDates = manualDates;
    // Check that dates mode doesn't cross semester boundaries
    const teacherSemesters = getTeacherSemesters(drizzleDb, req.teacherId);
    if (teacherSemesters.length > 0) {
      const inSemester = targetDates.filter(d =>
        teacherSemesters.some(sem => d >= sem.startDate && d <= sem.endDate)
      );
      if (inSemester.length > 0 && inSemester.length < targetDates.length) {
        return res.status(400).json({ error: '日期跨学期边界（部分在学期内、部分在学期外），请分批操作' });
      }
    }
  } else if (semesterId && weekday != null) {
    const semester = drizzleDb.select().from(semesters)
      .where(and(eq(semesters.id, semesterId), eq(semesters.teacherId, req.teacherId))).get();
    if (!semester) return res.status(404).json({ error: 'Semester not found' });

    const today = toLocalDateStr(new Date());
    const semesterStart = today > semester.startDate ? today : semester.startDate;
    const current = new Date(semesterStart + 'T00:00:00');
    const end = new Date(semester.endDate + 'T00:00:00');

    // Fetch user-defined holidays + workdays for this teacher.
    // workday entries override built-in/user holidays (调休: 上班日).
    const userHolidays = drizzleDb.select({ date: holidays.date, type: holidays.type })
      .from(holidays).where(eq(holidays.teacherId, req.teacherId)).all();
    const userHolidayDates = new Set(userHolidays.filter(h => h.type === 'holiday').map(h => h.date));
    const userWorkdayDates = new Set(userHolidays.filter(h => h.type === 'workday').map(h => h.date));

    while (current <= end) {
      const dateStr = toLocalDateStr(current);
      const isOff = !userWorkdayDates.has(dateStr) && (isHoliday(dateStr) || userHolidayDates.has(dateStr));
      if (current.getDay() === weekday && !isOff) {
        targetDates.push(dateStr);
      }
      current.setDate(current.getDate() + 1);
    }
  } else {
    return res.status(400).json({ error: 'Provide semesterId+weekday or dates[]' });
  }

  if (targetDates.length === 0) {
    return res.status(400).json({ error: 'No valid dates to schedule' });
  }

  if (preview) {
    return res.json({ count: targetDates.length, dates: targetDates });
  }

  const allValues = targetDates.map(date => ({
    classId, date, startTime, endTime, durationBilling: billing,
    locationName: cls.defaultLocationName,
    locationLat: cls.defaultLocationLat,
    locationLng: cls.defaultLocationLng,
  }));
  // Chunk inserts to stay within SQLite's default 999-parameter limit
  const CHUNK = 50;
  const idList = [];
  for (let i = 0; i < allValues.length; i += CHUNK) {
    const result = drizzleDb.insert(schedules).values(allValues.slice(i, i + CHUNK)).run();
    const firstId = Number(result.lastInsertRowid);
    for (let j = 0; j < Math.min(CHUNK, allValues.length - i); j++) {
      idList.push(firstId + j);
    }
  }
  logAudit({ teacherId: req.teacherId, action: 'BATCH_CREATE', tableName: 'schedules', after: { count: idList.length, ids: idList } });
  res.json({ count: idList.length, ids: idList });
});

router.put('/batch', validateBatchUpdate, handle, (req, res) => {
  const { classId, fromDate, toDate, weekday, semesterOnly = true, updates } = req.body;
  if (!classId || !updates || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'classId and updates required' });
  }

  // Require at least one scoping filter to prevent accidental mass updates
  if (!fromDate && !toDate && weekday == null) {
    return res.status(400).json({ error: 'fromDate, toDate, or weekday required to scope the update' });
  }

  const allowed = new Set(['startTime', 'endTime', 'durationBilling', 'locationName', 'locationLat', 'locationLng']);
  const safeUpdates = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.has(k)));
  if (Object.keys(safeUpdates).length === 0) {
    return res.status(400).json({ error: 'No valid fields in updates' });
  }

  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  // When toDate is set without fromDate, default lower bound to today
  const effectiveFromDate = fromDate || (toDate ? toLocalDateStr(new Date()) : undefined);

  const conditions = [eq(schedules.classId, classId)];
  if (effectiveFromDate) conditions.push(gte(schedules.date, effectiveFromDate));
  if (toDate) conditions.push(lte(schedules.date, toDate));

  let candidates = drizzleDb.select().from(schedules)
    .where(and(...conditions)).all();

  if (weekday != null) {
    candidates = candidates.filter(s => new Date(s.date + 'T00:00:00').getDay() === +weekday);
  }

  let semesterFiltered = 0;
  if (semesterOnly) {
    const teacherSemesters = getTeacherSemesters(drizzleDb, req.teacherId);
    if (teacherSemesters.length > 0) {
      const inSemester = candidates.filter(s =>
        teacherSemesters.some(sem => s.date >= sem.startDate && s.date <= sem.endDate)
      );
      // Only filter when the candidate set straddles semester boundaries.
      // All-in or all-out scopes reflect a clear user intent and should pass through.
      if (inSemester.length > 0 && inSemester.length < candidates.length) {
        semesterFiltered = candidates.length - inSemester.length;
        candidates = inSemester;
      }
    }
  }

  if (candidates.length === 0) {
    const resp = { count: 0, ids: [] };
    if (semesterFiltered > 0) {
      resp.semesterFiltered = semesterFiltered;
      resp.hint = `${semesterFiltered}条记录因不在当前学期内被过滤，如需修改请设置 semesterOnly=false`;
    }
    return res.json(resp);
  }

  const updatedIds = candidates.map(s => s.id);
  if (updatedIds.length > 0) {
    if (safeUpdates.startTime !== undefined || safeUpdates.endTime !== undefined) {
      const startTime = safeUpdates.startTime;
      const endTime = safeUpdates.endTime;
      if (startTime && endTime) {
        safeUpdates.durationBilling = safeUpdates.durationBilling ?? calcDurationBilling(startTime, endTime, null);
      }
      if (safeUpdates.durationBilling == null && updatedIds.length > 1) {
        const uniqueStarts = new Set(candidates.map(c => c.startTime));
        const uniqueEnds = new Set(candidates.map(c => c.endTime));
        if (uniqueStarts.size > 1 || uniqueEnds.size > 1) {
          return res.status(400).json({ error: '批量修改多条不同时间的排课时，请同时提供 durationBilling 或完整指定 startTime 和 endTime' });
        }
        safeUpdates.durationBilling = calcDurationBilling(startTime || candidates[0].startTime, endTime || candidates[0].endTime, null);
      } else if (safeUpdates.durationBilling == null) {
        safeUpdates.durationBilling = calcDurationBilling(startTime || candidates[0].startTime, endTime || candidates[0].endTime, null);
      }
    }
    drizzleDb.update(schedules).set(safeUpdates).where(inArray(schedules.id, updatedIds)).run();
  }

  logAudit({
    teacherId: req.teacherId, action: 'BATCH_UPDATE', tableName: 'schedules',
    after: { count: updatedIds.length, ids: updatedIds, classId, updates: safeUpdates },
  });
  const resp = { count: updatedIds.length, ids: updatedIds };
  if (semesterFiltered > 0) {
    resp.semesterFiltered = semesterFiltered;
    resp.hint = `${semesterFiltered}条记录因不在当前学期内被过滤，如需修改请设置 semesterOnly=false`;
  }
  res.json(resp);
});

router.delete('/batch', validateBatchDelete, handle, (req, res) => {
  const { ids, start, end, classId, fromDate, semesterOnly = true, dryRun } = req.body;

  if (ids && Array.isArray(ids) && ids.length > 0) {
    const teacherClasses = drizzleDb.select({ id: classes.id }).from(classes)
      .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
    const ownedClassIds = teacherClasses.map(c => c.id);
    let candidates = ownedClassIds.length === 0 ? [] : drizzleDb.select({ id: schedules.id, classId: schedules.classId, date: schedules.date })
      .from(schedules).where(and(inArray(schedules.id, ids.map(Number)), inArray(schedules.classId, ownedClassIds))).all();

    let semesterFiltered = 0;
    if (semesterOnly !== false) {
      const teacherSemesters = getTeacherSemesters(drizzleDb, req.teacherId);
      if (teacherSemesters.length > 0) {
        const inSemester = candidates.filter(s =>
          teacherSemesters.some(sem => s.date >= sem.startDate && s.date <= sem.endDate)
        );
        if (inSemester.length > 0 && inSemester.length < candidates.length) {
          semesterFiltered = candidates.length - inSemester.length;
          candidates = inSemester;
        }
      }
    }

    const toDelete = candidates.map(s => s.id);
    if (!dryRun) {
      if (toDelete.length > 0) drizzleDb.delete(schedules).where(inArray(schedules.id, toDelete)).run();
      logAudit({ teacherId: req.teacherId, action: 'BATCH_DELETE', tableName: 'schedules', after: { count: toDelete.length, ids: toDelete } });
    }
    const resp = { count: toDelete.length, ids: toDelete };
    if (semesterFiltered > 0) {
      resp.semesterFiltered = semesterFiltered;
      resp.hint = `${semesterFiltered}条记录因不在当前学期内被过滤，如需删除请设置 semesterOnly=false`;
    }
    return res.json(resp);
  }

  if (classId && fromDate) {
    const cls = drizzleDb.select().from(classes)
      .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    let candidates = drizzleDb.select({ id: schedules.id, date: schedules.date })
      .from(schedules).where(and(eq(schedules.classId, classId), gte(schedules.date, fromDate))).all();

    let semesterFiltered = 0;
    if (semesterOnly !== false) {
      const teacherSemesters = getTeacherSemesters(drizzleDb, req.teacherId);
      if (teacherSemesters.length > 0) {
        const inSemester = candidates.filter(s =>
          teacherSemesters.some(sem => s.date >= sem.startDate && s.date <= sem.endDate)
        );
        if (inSemester.length > 0 && inSemester.length < candidates.length) {
          semesterFiltered = candidates.length - inSemester.length;
          candidates = inSemester;
        }
      }
    }

    if (candidates.length === 0) {
      const resp = { count: 0, ids: [] };
      if (semesterFiltered > 0) {
        resp.semesterFiltered = semesterFiltered;
        resp.hint = `${semesterFiltered}条记录因不在当前学期内被过滤，如需删除请设置 semesterOnly=false`;
      }
      return res.json(resp);
    }

    const toDelete = candidates.map(s => s.id);
    if (!dryRun) {
      drizzleDb.delete(schedules).where(inArray(schedules.id, toDelete)).run();
      logAudit({
        teacherId: req.teacherId, action: 'BATCH_DELETE', tableName: 'schedules',
        after: { count: toDelete.length, ids: toDelete, classId, fromDate },
      });
    }
    const resp = { count: toDelete.length, ids: toDelete };
    if (semesterFiltered > 0) {
      resp.semesterFiltered = semesterFiltered;
      resp.hint = `${semesterFiltered}条记录因不在当前学期内被过滤，如需删除请设置 semesterOnly=false`;
    }
    return res.json(resp);
  }

  if (start && end) {
    const teacherClasses = drizzleDb.select({ id: classes.id }).from(classes)
      .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
    let classIds = teacherClasses.map(c => c.id);
    if (classId) {
      const queryClassIds = String(classId).split(',').map(Number).filter(Boolean);
      if (queryClassIds.length) classIds = classIds.filter(id => queryClassIds.includes(id));
    }
    if (classIds.length === 0) {
      return res.json({ count: 0, ids: [] });
    }
    let candidates = drizzleDb.select({ id: schedules.id, classId: schedules.classId, date: schedules.date })
      .from(schedules).where(and(gte(schedules.date, start), lte(schedules.date, end), inArray(schedules.classId, classIds))).all();

    let semesterFiltered = 0;
    if (semesterOnly !== false) {
      const teacherSemesters = getTeacherSemesters(drizzleDb, req.teacherId);
      if (teacherSemesters.length > 0) {
        const inSemester = candidates.filter(s =>
          teacherSemesters.some(sem => s.date >= sem.startDate && s.date <= sem.endDate)
        );
        if (inSemester.length > 0 && inSemester.length < candidates.length) {
          semesterFiltered = candidates.length - inSemester.length;
          candidates = inSemester;
        }
      }
    }

    const toDelete = candidates.map(s => s.id);
    if (!dryRun) {
      if (toDelete.length > 0) drizzleDb.delete(schedules).where(inArray(schedules.id, toDelete)).run();
      logAudit({ teacherId: req.teacherId, action: 'BATCH_DELETE', tableName: 'schedules', after: { count: toDelete.length, ids: toDelete, start, end } });
    }
    const resp = { count: toDelete.length, ids: toDelete };
    if (semesterFiltered > 0) {
      resp.semesterFiltered = semesterFiltered;
      resp.hint = `${semesterFiltered}条记录因不在当前学期内被过滤，如需删除请设置 semesterOnly=false`;
    }
    return res.json(resp);
  }

  res.status(400).json({ error: 'Provide ids[], start+end, or classId+fromDate' });
});

// ── Single-item CRUD (:id routes) ──

router.put('/:id', validateUpdateSchedule, handle, (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(schedules).where(eq(schedules.id, +id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, existing.classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(403).json({ error: 'Forbidden' });

  const allowed = ['classId', 'date', 'startTime', 'endTime', 'durationBilling', 'locationName', 'locationLat', 'locationLng'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields' });

  // Validate new classId belongs to this teacher and is not deleted
  if (updates.classId !== undefined) {
    const newCls = drizzleDb.select().from(classes)
      .where(and(eq(classes.id, updates.classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
    if (!newCls) return res.status(403).json({ error: 'Forbidden' });
  }
  if (updates.startTime !== undefined || updates.endTime !== undefined) {
    updates.durationBilling = calcDurationBilling(
      updates.startTime || existing.startTime,
      updates.endTime || existing.endTime,
      updates.durationBilling,
    );
  }
  drizzleDb.update(schedules).set(updates).where(eq(schedules.id, +id)).run();
  const updated = getScheduleWithClass(+id, req.teacherId);
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'schedules', recordId: +id, before: existing, after: updated });
  const warnings = getConflictsForSchedule(+id, req.teacherId);
  res.json({ ...updated, warnings: warnings.length > 0 ? warnings : undefined });
});

router.delete('/:id', (req, res) => {
  const existing = drizzleDb.select().from(schedules).where(eq(schedules.id, +req.params.id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, existing.classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(403).json({ error: 'Forbidden' });
  drizzleDb.delete(schedules).where(eq(schedules.id, +req.params.id)).run();
  logAudit({ teacherId: req.teacherId, action: 'DELETE', tableName: 'schedules', recordId: +req.params.id, before: existing });
  res.json({ ok: true });
});

// ── Summary & Export ──

router.get('/summary', (req, res) => {
  const { start, end, format } = resolveRange(req.query);
  if (!start || !end) return res.status(400).json({ error: 'start/end or range required' });

  const teacherClasses = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
  const classMap = {};
  teacherClasses.forEach(c => classMap[c.id] = c);
  let classIds = teacherClasses.map(c => c.id);
  if (req.query.classId) {
    const queryClassIds = req.query.classId.split(',').map(Number).filter(Boolean);
    if (queryClassIds.length) classIds = classIds.filter(id => queryClassIds.includes(id));
  }
  if (classIds.length === 0) {
    const empty = { count: 0, hours: 0, revenue: 0, byClass: [], bySubject: [], byGrade: [] };
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(toCSV([['班级', '年级', '学科', '课次', '课时数(小时)', '收入(元)']]));
    }
    return res.json(empty);
  }

  const scheds = drizzleDb.select().from(schedules)
    .where(and(gte(schedules.date, start), lte(schedules.date, end), inArray(schedules.classId, classIds)))
    .all();

  // Load class_pricing for revenue calculation
  const allPricing = drizzleDb.select().from(classPricing)
    .where(inArray(classPricing.classId, classIds)).all();
  const pricingByClass = {};
  for (const p of allPricing) {
    (pricingByClass[p.classId] ??= []).push(p);
  }
  for (const arr of Object.values(pricingByClass)) {
    arr.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  }
  function matchPricing(cid, date) {
    const records = pricingByClass[cid];
    if (!records || records.length === 0) return null;
    let match = null;
    for (const p of records) {
      if (p.effectiveFrom <= date) match = p;
      else break;
    }
    return match;
  }

  const byClassMap = {};
  for (const s of scheds) {
    if (!byClassMap[s.classId]) byClassMap[s.classId] = { count: 0, minutes: 0, revenue: 0 };
    byClassMap[s.classId].count++;
    byClassMap[s.classId].minutes += s.durationBilling;
    const p = matchPricing(s.classId, s.date);
    const cls = classMap[s.classId];
    const unit = p?.unitPrice ?? cls?.unitPrice ?? 0;
    const cnt = p?.studentCount ?? cls?.studentCount ?? 0;
    const disc = p?.discountAmount ?? cls?.discountAmount ?? 0;
    byClassMap[s.classId].revenue += (unit * cnt - disc) * (s.durationBilling / 60);
  }

  const byClass = Object.entries(byClassMap).map(([cid, agg]) => {
    const cls = classMap[+cid];
    const hours = agg.minutes / 60;
    return { classId: +cid, name: cls.name, subject: cls.subject, grade: cls.grade, count: agg.count, hours, revenue: agg.revenue };
  }).sort((a, b) => b.revenue - a.revenue || a.classId - b.classId);

  if (format === 'csv') {
    const rows = [['班级', '年级', '学科', '课次', '课时数(小时)', '收入(元)']];
    byClass.forEach(b => rows.push([b.name, b.grade, b.subject, b.count, b.hours.toFixed(2), b.revenue.toFixed(2)]));
    const total = byClass.reduce((acc, b) => ({ count: acc.count + b.count, hours: acc.hours + b.hours, revenue: acc.revenue + b.revenue }), { count: 0, hours: 0, revenue: 0 });
    rows.push(['合计', '', '', total.count, total.hours.toFixed(2), total.revenue.toFixed(2)]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="summary_${start}_${end}.csv"`);
    return res.send(toCSV(rows));
  }

  const bySubjectMap = {};
  const byGradeMap = {};
  for (const b of byClass) {
    if (!bySubjectMap[b.subject]) bySubjectMap[b.subject] = { subject: b.subject, count: 0, hours: 0, revenue: 0 };
    bySubjectMap[b.subject].count += b.count;
    bySubjectMap[b.subject].hours += b.hours;
    bySubjectMap[b.subject].revenue += b.revenue;
    if (!byGradeMap[b.grade]) byGradeMap[b.grade] = { grade: b.grade, count: 0, hours: 0, revenue: 0 };
    byGradeMap[b.grade].count += b.count;
    byGradeMap[b.grade].hours += b.hours;
    byGradeMap[b.grade].revenue += b.revenue;
  }

  res.json({
    count: scheds.length,
    hours: scheds.reduce((s, r) => s + r.durationBilling, 0) / 60,
    revenue: byClass.reduce((s, b) => s + b.revenue, 0),
    byClass,
    bySubject: Object.values(bySubjectMap).sort((a, b) => b.count - a.count),
    byGrade: Object.values(byGradeMap).sort((a, b) => b.count - a.count),
  });
});

router.get('/export', (req, res) => {
  const resolved = resolveRange(req.query);
  const { start, end, classId, format } = resolved;
  if (!start || !end) return res.status(400).json({ error: 'start/end or range required' });

  const teacherClasses = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
  let cIds = teacherClasses.map(c => c.id);
  if (classId) {
    const queryClassIds = classId.split(',').map(Number).filter(Boolean);
    if (queryClassIds.length) cIds = cIds.filter(id => queryClassIds.includes(id));
  }

  const classMap = {};
  teacherClasses.forEach(c => classMap[c.id] = c);
  const scheds = cIds.length === 0 ? [] : drizzleDb.select().from(schedules)
    .where(and(gte(schedules.date, start), lte(schedules.date, end), inArray(schedules.classId, cIds)))
    .all()
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    .map(s => ({ ...s, class: classMap[s.classId] }));

  if (format === 'csv') {
    // Load pricing for accurate historical values
    const allPricing = cIds.length > 0
      ? drizzleDb.select().from(classPricing).where(inArray(classPricing.classId, cIds)).all()
      : [];
    const pricingByClass = {};
    for (const p of allPricing) {
      (pricingByClass[p.classId] ??= []).push(p);
    }
    for (const arr of Object.values(pricingByClass)) {
      arr.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    }
    function matchPricing(cid, date) {
      const records = pricingByClass[cid];
      if (!records || records.length === 0) return null;
      let match = null;
      for (const p of records) {
        if (p.effectiveFrom <= date) match = p;
        else break;
      }
      return match;
    }

    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const rows = [['日期', '星期', '班级', '年级', '学科', '开始时间', '结束时间', '计费时长(分钟)', '上课地点', '竞赛课', '单价', '学生人数', '优惠金额']];
    scheds.forEach(s => {
      const d = new Date(s.date + 'T00:00:00');
      const p = matchPricing(s.classId, s.date);
      rows.push([
        s.date, weekdayNames[d.getDay()],
        s.class?.name || '', s.class?.grade || '', s.class?.subject || '',
        s.startTime, s.endTime, s.durationBilling, s.locationName || '',
        s.class?.isCompetition ? '是' : '否',
        p?.unitPrice ?? s.class?.unitPrice ?? '',
        p?.studentCount ?? s.class?.studentCount ?? '',
        p?.discountAmount ?? s.class?.discountAmount ?? '',
      ]);
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="schedules_${start}_${end}.csv"`);
    return res.send(toCSV(rows));
  }

  res.json(scheds);
});

// ── Availability & Conflicts ──

function getFreeSlotsForDate(dateStr, teacherId, dayStart = '08:00', dayEnd = '23:00') {
  const teacherClasses = drizzleDb.select({ id: classes.id }).from(classes)
    .where(and(eq(classes.teacherId, teacherId), eq(classes.deleted, false))).all();
  const classIds = teacherClasses.map(c => c.id);
  if (classIds.length === 0) return [{ start: dayStart, end: dayEnd }];

  const daySchedules = drizzleDb.select().from(schedules)
    .where(and(eq(schedules.date, dateStr), inArray(schedules.classId, classIds))).all();

  if (daySchedules.length === 0) return [{ start: dayStart, end: dayEnd }];

  const sorted = daySchedules.sort((a, b) => a.startTime.localeCompare(b.startTime));
  const toTime = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const startMin = toMin(dayStart);
  const endMin = toMin(dayEnd);
  const freeSlots = [];
  let cursor = startMin;

  for (const s of sorted) {
    const sStart = toMin(s.startTime);
    const sEndRaw = toMin(s.endTime);
    const sEnd = sEndRaw > sStart ? sEndRaw : sEndRaw + 24 * 60;
    if (sStart > cursor) freeSlots.push({ start: toTime(cursor), end: toTime(sStart) });
    cursor = Math.max(cursor, sEnd);
  }
  if (cursor < endMin) freeSlots.push({ start: toTime(cursor), end: toTime(endMin) });
  return freeSlots;
}

router.get('/free-slots', (req, res) => {
  const { date, start, end, dayStart, dayEnd, after, before, minDuration } = req.query;
  const dStart = after || dayStart || '08:00';
  const dEnd = before || dayEnd || '23:00';
  if (dStart >= dEnd) {
    return res.status(400).json({ error: 'after/dayStart 须早于 before/dayEnd（不支持跨午夜查询）' });
  }
  const minDur = minDuration ? Math.max(0, +minDuration) : 0;

  function filterSlots(slots) {
    if (!minDur) return slots;
    return slots.filter(s => {
      const [sh, sm] = s.start.split(':').map(Number);
      const [eh, em] = s.end.split(':').map(Number);
      return (eh * 60 + em) - (sh * 60 + sm) >= minDur;
    });
  }

  if (date) {
    return res.json({ date, slots: filterSlots(getFreeSlotsForDate(date, req.teacherId, dStart, dEnd)) });
  }
  if (start && end) {
    // Bulk query: fetch all schedules in range once instead of day-by-day
    const teacherClassIds = drizzleDb.select({ id: classes.id }).from(classes)
      .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all().map(c => c.id);
    if (teacherClassIds.length === 0) {
      // All days are fully free
      const results = [];
      const current = new Date(start + 'T00:00:00');
      const endDate = new Date(end + 'T00:00:00');
      while (current <= endDate) {
        results.push({ date: toLocalDateStr(current), slots: [{ start: dStart, end: dEnd }] });
        current.setDate(current.getDate() + 1);
      }
      return res.json(results);
    }
    const rangeSchedules = drizzleDb.select().from(schedules)
      .where(and(gte(schedules.date, start), lte(schedules.date, end), inArray(schedules.classId, teacherClassIds)))
      .all()
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const byDate = {};
    for (const s of rangeSchedules) {
      (byDate[s.date] ??= []).push(s);
    }
    const toTimeStr = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const dStartMin = toMin(dStart);
    const dEndMin = toMin(dEnd);
    function computeFreeSlots(dayScheds) {
      if (!dayScheds.length) return [{ start: dStart, end: dEnd }];
      const freeSlots = [];
      let cursor = dStartMin;
      for (const s of dayScheds) {
        const sStart = toMin(s.startTime);
        const sEndRaw = toMin(s.endTime);
        const sEnd = sEndRaw > sStart ? sEndRaw : sEndRaw + 24 * 60;
        if (sStart > cursor) freeSlots.push({ start: toTimeStr(cursor), end: toTimeStr(sStart) });
        cursor = Math.max(cursor, sEnd);
      }
      if (cursor < dEndMin) freeSlots.push({ start: toTimeStr(cursor), end: toTimeStr(dEndMin) });
      return freeSlots;
    }
    const results = [];
    const current = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    while (current <= endDate) {
      const dateStr = toLocalDateStr(current);
      const slots = filterSlots(computeFreeSlots(byDate[dateStr] || []));
      if (slots.length > 0) results.push({ date: dateStr, slots });
      current.setDate(current.getDate() + 1);
    }
    return res.json(results);
  }
  res.status(400).json({ error: 'Provide date or start+end query parameters' });
});

router.get('/conflicts', (req, res) => {
  const today = toLocalDateStr(new Date());
  const defaultEnd = toLocalDateStr(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000));
  const start = req.query.start || today;
  const end = req.query.end || defaultEnd;
  const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 20, 100));

  const teacherClasses = drizzleDb.select({ id: classes.id }).from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
  let classIds = teacherClasses.map(c => c.id);
  const { classId } = req.query;
  if (classId) {
    const queryClassIds = classId.split(',').map(Number).filter(Boolean);
    if (queryClassIds.length) classIds = classIds.filter(id => queryClassIds.includes(id));
  }
  if (classIds.length === 0) return res.json({ total: 0, groups: [] });

  const classMap = {};
  teacherClasses.forEach(c => classMap[c.id] = c);

  const allSchedules = drizzleDb.select().from(schedules)
    .where(and(gte(schedules.date, start), lte(schedules.date, end), inArray(schedules.classId, classIds)))
    .all()
    .map(s => ({ ...s, class: classMap[s.classId] || null }));

  const byDate = {};
  for (const s of allSchedules) {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  }

  const conflictGroups = [];
  for (const date of Object.keys(byDate).sort()) {
    const groups = detectConflictGroups(byDate[date]).filter(g => g.length > 1);
    for (const group of groups) {
      conflictGroups.push({ date, schedules: group });
      if (conflictGroups.length >= limit) break;
    }
    if (conflictGroups.length >= limit) break;
  }
  res.json({ total: conflictGroups.length, groups: conflictGroups });
});

router.get('/:id', (req, res) => {
  const s = getScheduleWithClass(+req.params.id, req.teacherId);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

export default router;
