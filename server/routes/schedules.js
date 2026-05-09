import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { schedules, classes, semesters, holidays } from '../db/schema.js';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { isHoliday } from '../services/holidays.js';
import handle from '../validations/handle.js';
import { validateCreateSchedule, validateBatchCreate, validateBatchUpdate, validateBatchDelete, validateUpdateSchedule } from '../validations/schedules.js';
import { logAudit } from '../services/audit.js';
import { toLocalDateStr, toMin, resolveRange, toCSV, detectConflictGroups, getScheduleWithClass, calcDurationBilling } from '../services/schedule-helpers.js';

const router = Router();
router.use(authMiddleware);

function getConflictsForSchedule(scheduleId, teacherId) {
  const s = drizzleDb.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
  if (!s) return [];
  const teacherClassIds = drizzleDb.select({ id: classes.id }).from(classes)
    .where(and(eq(classes.teacherId, teacherId), eq(classes.deleted, false))).all().map(c => c.id);
  const daySchedules = drizzleDb.select().from(schedules)
    .where(eq(schedules.date, s.date)).all()
    .filter(x => x.id !== scheduleId && teacherClassIds.includes(x.classId));
  const conflicts = [];
  const sStart = toMin(s.startTime);
  const sEnd = toMin(s.endTime) >= sStart ? toMin(s.endTime) : toMin(s.endTime) + 24 * 60;
  for (const other of daySchedules) {
    const oStart = toMin(other.startTime);
    const oEnd = toMin(other.endTime) >= oStart ? toMin(other.endTime) : toMin(other.endTime) + 24 * 60;
    if (sStart < oEnd && oStart < sEnd) {
      const cls = drizzleDb.select().from(classes).where(eq(classes.id, other.classId)).get();
      conflicts.push({ id: other.id, classId: other.classId, className: cls?.name, startTime: other.startTime, endTime: other.endTime });
    }
  }
  return conflicts;
}

// ── CRUD ──

router.get('/', (req, res) => {
  const { classId } = req.query;
  const { start, end } = resolveRange(req.query);
  if (!start || !end) return res.status(400).json({ error: 'start/end or range required' });

  const teacherClasses = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
  let classIds = teacherClasses.map(c => c.id);
  if (classIds.length === 0) return res.json([]);
  if (classId) classIds = classIds.filter(id => id === +classId);

  const result = drizzleDb.select().from(schedules)
    .where(and(gte(schedules.date, start), lte(schedules.date, end)))
    .all()
    .filter(s => classIds.includes(s.classId))
    .sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.startTime.localeCompare(b.startTime));

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
  const created = getScheduleWithClass(Number(result.lastInsertRowid));
  logAudit({ teacherId: req.teacherId, action: 'CREATE', tableName: 'schedules', recordId: created.id, after: created });
  const warnings = getConflictsForSchedule(created.id, req.teacherId);
  res.json({ ...created, warnings: warnings.length > 0 ? warnings : undefined });
});

// ── Batch operations (must be before /:id routes) ──

router.post('/batch', validateBatchCreate, handle, (req, res) => {
  const { classId, semesterId, weekday, dates: manualDates, startTime, endTime, durationBilling } = req.body;
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const billing = calcDurationBilling(startTime, endTime, durationBilling);
  let targetDates = [];

  if (manualDates && manualDates.length > 0) {
    targetDates = manualDates;
  } else if (semesterId && weekday != null) {
    const semester = drizzleDb.select().from(semesters)
      .where(and(eq(semesters.id, semesterId), eq(semesters.teacherId, req.teacherId))).get();
    if (!semester) return res.status(404).json({ error: 'Semester not found' });

    const today = new Date().toISOString().slice(0, 10);
    const semesterStart = today > semester.startDate ? today : semester.startDate;
    const current = new Date(semesterStart + 'T00:00:00');
    const end = new Date(semester.endDate + 'T00:00:00');

    // Fetch user-added holidays for this teacher
    const userHolidayDates = new Set(
      drizzleDb.select({ date: holidays.date }).from(holidays)
        .where(and(eq(holidays.teacherId, req.teacherId), eq(holidays.type, 'holiday'))).all()
        .map(h => h.date)
    );

    while (current <= end) {
      const dateStr = toLocalDateStr(current);
      if (current.getDay() === weekday && !isHoliday(dateStr) && !userHolidayDates.has(dateStr)) {
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

  const values = targetDates.map(date => ({
    classId, date, startTime, endTime, durationBilling: billing,
    locationName: cls.defaultLocationName,
    locationLat: cls.defaultLocationLat,
    locationLng: cls.defaultLocationLng,
  }));
  const result = drizzleDb.insert(schedules).values(values).run();
  res.json({ count: targetDates.length, ids: targetDates.map((_, i) => Number(result.lastInsertRowid) - targetDates.length + 1 + i) });
});

router.put('/batch', validateBatchUpdate, handle, (req, res) => {
  const { classId, fromDate, weekday, semesterOnly = true, updates } = req.body;
  if (!classId || !updates || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'classId and updates required' });
  }

  // Require at least one scoping filter to prevent accidental mass updates
  if (!fromDate && weekday == null) {
    return res.status(400).json({ error: 'fromDate or weekday required to scope the update' });
  }

  const allowed = new Set(['startTime', 'endTime', 'durationBilling', 'locationName', 'locationLat', 'locationLng']);
  const safeUpdates = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.has(k)));
  if (Object.keys(safeUpdates).length === 0) {
    return res.status(400).json({ error: 'No valid fields in updates' });
  }

  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  let candidates = drizzleDb.select().from(schedules)
    .where(eq(schedules.classId, classId)).all();

  if (fromDate) candidates = candidates.filter(s => s.date >= fromDate);
  if (weekday != null) {
    candidates = candidates.filter(s => new Date(s.date + 'T00:00:00').getDay() === +weekday);
  }

  const beforeSemesterCount = candidates.length;
  if (semesterOnly) {
    const teacherSemesters = drizzleDb.select().from(semesters)
      .where(eq(semesters.teacherId, req.teacherId)).all();
    if (teacherSemesters.length > 0) {
      candidates = candidates.filter(s =>
        teacherSemesters.some(sem => s.date >= sem.startDate && s.date <= sem.endDate)
      );
    }
  }
  const semesterFiltered = beforeSemesterCount - candidates.length;

  if (candidates.length === 0) {
    const resp = { count: 0, ids: [] };
    if (semesterFiltered > 0) {
      resp.semesterFiltered = semesterFiltered;
      resp.hint = `${semesterFiltered}条记录因不在当前学期内被过滤，如需修改请设置 semesterOnly=false`;
    }
    return res.json(resp);
  }

  const updatedIds = [];
  for (const s of candidates) {
    const payload = { ...safeUpdates };
    if (safeUpdates.startTime !== undefined || safeUpdates.endTime !== undefined) {
      const newStart = safeUpdates.startTime || s.startTime;
      const newEnd = safeUpdates.endTime || s.endTime;
      payload.durationBilling = safeUpdates.durationBilling != null
        ? safeUpdates.durationBilling
        : calcDurationBilling(newStart, newEnd, null);
    }
    drizzleDb.update(schedules).set(payload).where(eq(schedules.id, s.id)).run();
    updatedIds.push(s.id);
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
  const { ids, start, end, classId } = req.body;

  if (ids && Array.isArray(ids) && ids.length > 0) {
    const teacherClasses = drizzleDb.select({ id: classes.id }).from(classes)
      .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
    const ownedClassIds = new Set(teacherClasses.map(c => c.id));
    const toDelete = drizzleDb.select({ id: schedules.id, classId: schedules.classId })
      .from(schedules).where(inArray(schedules.id, ids.map(Number))).all()
      .filter(s => ownedClassIds.has(s.classId)).map(s => s.id);
    if (toDelete.length > 0) drizzleDb.delete(schedules).where(inArray(schedules.id, toDelete)).run();
    logAudit({ teacherId: req.teacherId, action: 'BATCH_DELETE', tableName: 'schedules', after: { count: toDelete.length, ids: toDelete } });
    return res.json({ count: toDelete.length });
  }

  if (start && end) {
    const teacherClasses = drizzleDb.select({ id: classes.id }).from(classes)
      .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
    let classIds = teacherClasses.map(c => c.id);
    if (classId) classIds = classIds.filter(id => id === +classId);
    if (classIds.length === 0) return res.json({ count: 0 });
    const toDelete = drizzleDb.select({ id: schedules.id, classId: schedules.classId })
      .from(schedules).where(and(gte(schedules.date, start), lte(schedules.date, end))).all()
      .filter(s => classIds.includes(s.classId)).map(s => s.id);
    if (toDelete.length > 0) drizzleDb.delete(schedules).where(inArray(schedules.id, toDelete)).run();
    logAudit({ teacherId: req.teacherId, action: 'BATCH_DELETE', tableName: 'schedules', after: { count: toDelete.length, ids: toDelete, start, end } });
    return res.json({ count: toDelete.length });
  }

  res.status(400).json({ error: 'Provide ids[] or start+end' });
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
  const updated = getScheduleWithClass(+id);
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'schedules', recordId: +id, before: existing, after: updated });
  const warnings = getConflictsForSchedule(+id, req.teacherId);
  res.json({ ...updated, warnings: warnings.length > 0 ? warnings : undefined });
});

router.delete('/:id', (req, res) => {
  const existing = drizzleDb.select().from(schedules).where(eq(schedules.id, +req.params.id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, existing.classId), eq(classes.teacherId, req.teacherId))).get();
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
    .where(and(gte(schedules.date, start), lte(schedules.date, end)))
    .all().filter(s => classIds.includes(s.classId));

  const byClassMap = {};
  for (const s of scheds) {
    if (!byClassMap[s.classId]) byClassMap[s.classId] = { count: 0, minutes: 0 };
    byClassMap[s.classId].count++;
    byClassMap[s.classId].minutes += s.durationBilling;
  }

  const byClass = Object.entries(byClassMap).map(([cid, agg]) => {
    const cls = classMap[+cid];
    const hours = agg.minutes / 60;
    const revenue = (cls.unitPrice * cls.studentCount - (cls.discountAmount || 0)) * hours;
    return { classId: +cid, name: cls.name, subject: cls.subject, grade: cls.grade, count: agg.count, hours, revenue };
  }).sort((a, b) => b.revenue - a.revenue);

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
  if (classId) cIds = cIds.filter(id => id === +classId);

  const classMap = {};
  teacherClasses.forEach(c => classMap[c.id] = c);

  const scheds = cIds.length === 0 ? [] : drizzleDb.select().from(schedules)
    .where(and(gte(schedules.date, start), lte(schedules.date, end)))
    .all()
    .filter(s => cIds.includes(s.classId))
    .sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.startTime.localeCompare(b.startTime))
    .map(s => ({ ...s, class: classMap[s.classId] }));

  if (format === 'csv') {
    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const rows = [['日期', '星期', '班级', '年级', '学科', '开始时间', '结束时间', '计费时长(分钟)', '上课地点', '竞赛课', '单价', '学生人数', '优惠金额']];
    scheds.forEach(s => {
      const d = new Date(s.date + 'T00:00:00');
      rows.push([
        s.date, weekdayNames[d.getDay()],
        s.class?.name || '', s.class?.grade || '', s.class?.subject || '',
        s.startTime, s.endTime, s.durationBilling, s.locationName || '',
        s.class?.isCompetition ? '是' : '否',
        s.class?.unitPrice || '', s.class?.studentCount || '', s.class?.discountAmount || '',
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
    .where(eq(schedules.date, dateStr)).all()
    .filter(s => classIds.includes(s.classId));

  if (daySchedules.length === 0) return [{ start: dayStart, end: dayEnd }];

  const sorted = daySchedules.sort((a, b) => a.startTime.localeCompare(b.startTime));
  const toMinL = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const toTime = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const startMin = toMinL(dayStart);
  const endMin = toMinL(dayEnd);
  const freeSlots = [];
  let cursor = startMin;

  for (const s of sorted) {
    const sStart = toMinL(s.startTime);
    const sEndRaw = toMinL(s.endTime);
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
  const minDur = minDuration ? +minDuration : 0;

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
    const results = [];
    const current = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    while (current <= endDate) {
      const dateStr = toLocalDateStr(current);
      const slots = filterSlots(getFreeSlotsForDate(dateStr, req.teacherId, dStart, dEnd));
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
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const teacherClasses = drizzleDb.select({ id: classes.id }).from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
  const classIds = teacherClasses.map(c => c.id);
  if (classIds.length === 0) return res.json({ total: 0, groups: [] });

  const classMap = {};
  teacherClasses.forEach(c => classMap[c.id] = c);

  const allSchedules = drizzleDb.select().from(schedules)
    .where(and(gte(schedules.date, start), lte(schedules.date, end)))
    .all()
    .filter(s => classIds.includes(s.classId))
    .map(s => ({ ...s, class: classMap[s.classId] || null }));

  const byDate = {};
  for (const s of allSchedules) {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  }

  const conflictGroups = [];
  for (const date of Object.keys(byDate).sort()) {
    const groups = detectConflictGroups(byDate[date]);
    for (const group of groups) {
      conflictGroups.push({ date, schedules: group });
      if (conflictGroups.length >= limit) break;
    }
    if (conflictGroups.length >= limit) break;
  }
  res.json({ total: conflictGroups.length, groups: conflictGroups });
});

router.get('/:id', (req, res) => {
  const s = getScheduleWithClass(+req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, s.classId), eq(classes.teacherId, req.teacherId))).get();
  if (!cls) return res.status(403).json({ error: 'Forbidden' });
  res.json(s);
});

export default router;
