import { Router } from 'express';
import { drizzleDb, db } from '../db/index.js';
import { schedules, classes, semesters, holidays, classStudents, classPricing } from '../db/schema.js';
import { eq, and, gte, lte, inArray, ne } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { isHoliday, getHolidaysForYear } from '../services/holidays.js';
import handle from '../validations/handle.js';
import { validateCreateSchedule, validateBatchCreate, validateBatchUpdate, validateBatchDelete, validateUpdateSchedule } from '../validations/schedules.js';
import { isValidDate, isValidScheduleEndTime, isValidScheduleSpan, isValidTime, normalizeScheduleEndTime, DATE_RANGE_SUFFIX } from '../validations/dates.js';
import { logAudit } from '../services/audit.js';
import { toLocalDateStr, toMin, resolveRange, toCSV, detectDatedConflictGroups, getScheduleWithClass, calcDurationBilling, getTeacherSemesters, buildPricingLookup, scheduleBounds, schedulesOverlap } from '../services/schedule-helpers.js';
import { clearReportCache, getReportCache, setReportCache } from '../services/report-cache.js';
import { students as studentsTable } from '../db/schema.js';

function filterBySemesters(candidates, { semesterOnly, drizzleDb, teacherId }) {
  let filtered = 0;
  // Semester scoping only kicks in when candidates STRADDLE a semester boundary
  // (some inside, some outside). If every candidate is outside — e.g. legacy
  // schedules recorded before the teacher defined any semester — they are left
  // untouched so historical data remains operable. This asymmetry is asserted
  // by the batch update/delete tests in routes-schedules.test.js.
  if (semesterOnly !== false) {
    const teacherSemesters = getTeacherSemesters(drizzleDb, teacherId);
    if (teacherSemesters.length > 0) {
      const inSemester = candidates.filter(s =>
        teacherSemesters.some(sem => s.date >= sem.startDate && s.date <= sem.endDate)
      );
      if (inSemester.length > 0 && inSemester.length < candidates.length) {
        filtered = candidates.length - inSemester.length;
        candidates = inSemester;
      }
    }
  }
  return { candidates, filtered };
}

const router = Router();
router.use(authMiddleware);

function normalizeMultiParam(value) {
  if (value == null) return '';
  return Array.isArray(value) ? value.join(',') : String(value);
}

function parseClassIdsParam(value) {
  return normalizeMultiParam(value).split(',').map(Number)
    .filter(id => Number.isInteger(id) && id > 0);
}

function dateSpanDays(start, end) {
  return Math.round((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000);
}

function validateRange(start, end, { maxDays } = {}) {
  if (!isValidDate(start) || !isValidDate(end)) return `start/end 须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}`;
  if (start > end) return 'start must be <= end';
  if (maxDays != null && dateSpanDays(start, end) > maxDays) return `日期范围不能超过 ${maxDays + 1} 天`;
  return null;
}

// 「这一天不上课吗」：用户自己的调休优先于自己的节假日；某一年只要有用户数据，
// 内置数据对该年整体让位（与前端 src/utils/holidays.js 同一套规则）。
// 批量创建靠它跳过节假日，批量位移靠它把挪到节假日上的日期报回调用方——两处必须
// 是同一份判断，否则「会被跳过的日子」和「会被提醒的日子」对不上。
function buildOffDayCheck(teacherId) {
  const rows = drizzleDb.select({ date: holidays.date, type: holidays.type })
    .from(holidays).where(eq(holidays.teacherId, teacherId)).all();
  const offDates = new Set(rows.filter(h => h.type === 'holiday').map(h => h.date));
  const workDates = new Set(rows.filter(h => h.type === 'workday').map(h => h.date));
  const dbYears = new Set(rows.map(h => h.date.slice(0, 4)));
  const isOffDay = (dateStr) => !workDates.has(dateStr)
    && (offDates.has(dateStr) || (!dbYears.has(dateStr.slice(0, 4)) && isHoliday(dateStr)));
  return { isOffDay, dbYears };
}

function shiftDate(date, days) {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toLocalDateStr(d);
}

function getConflictsForSchedule(scheduleId, teacherId) {
  const s = drizzleDb.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
  if (!s) return [];
  const teacherClasses = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, teacherId), eq(classes.deleted, false))).all();
  const classMap = {};
  teacherClasses.forEach(c => classMap[c.id] = c);
  const teacherClassIds = Object.keys(classMap).map(Number);
  const nearbySchedules = drizzleDb.select().from(schedules)
    .where(and(
      gte(schedules.date, shiftDate(s.date, -1)),
      lte(schedules.date, shiftDate(s.date, 1)),
      inArray(schedules.classId, teacherClassIds),
    )).all()
    .filter(x => x.id !== scheduleId);
  const conflicts = [];
  for (const other of nearbySchedules) {
    if (schedulesOverlap(s, other)) {
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
  const rangeError = validateRange(start, end);
  if (rangeError) return res.status(400).json({ error: rangeError });
  const daysDiff = dateSpanDays(start, end);
  if (daysDiff > 365 && !classId && !studentId) {
    return res.status(400).json({ error: '日期范围超过365天时请指定 classId 或 studentId 筛选条件' });
  }
  const pageLimit = limit ? Math.max(1, Math.min(parseInt(limit) || 100, 1000)) : null;
  const pageOffset = offset ? Math.max(0, parseInt(offset) || 0) : 0;

  const teacherClasses = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
  let classIds = teacherClasses.map(c => c.id);
  if (classIds.length === 0) return res.json([]);
  if (classId) {
    const queryClassIds = parseClassIdsParam(classId);
    classIds = classIds.filter(id => queryClassIds.includes(id));
  }
  if (studentId) {
    const student = drizzleDb.select().from(studentsTable)
      .where(and(eq(studentsTable.id, +studentId), eq(studentsTable.teacherId, req.teacherId))).get();
    if (!student) return res.json([]);
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
  // endTime may be 24:00–47:59 to express a next-day clock time. A 0h or ≥24h
  // span normalizes back to startTime (and would render as a zero-height block), so reject it.
  if (!isValidScheduleSpan(startTime, endTime)) return res.status(400).json({ error: '排课时长须大于 0 且小于 24 小时' });
  const storedEndTime = normalizeScheduleEndTime(endTime);
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const billing = calcDurationBilling(startTime, storedEndTime, durationBilling);
  // Check for duplicate schedule (same class, date, startTime)
  const dup = drizzleDb.select().from(schedules)
    .where(and(eq(schedules.classId, classId), eq(schedules.date, date), eq(schedules.startTime, startTime))).get();
  if (dup) return res.status(409).json({ error: '该班级在此日期的同一时间已有排课' });
  let result;
  try {
    result = drizzleDb.insert(schedules).values({
      classId, date, startTime, endTime: storedEndTime, durationBilling: billing,
      // The class default is one place, so it is inherited whole or not at all:
      // a caller naming a different place must not receive the default's
      // coordinates, and an explicit null means "no location".
      ...(locationName === undefined
        ? { locationName: cls.defaultLocationName, locationLat: cls.defaultLocationLat, locationLng: cls.defaultLocationLng }
        : { locationName, locationLat: locationLat ?? null, locationLng: locationLng ?? null }),
    }).run();
  } catch (e) {
    if (e.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: '该班级在此日期的同一时间已有排课' });
    }
    throw e;
  }
  const created = getScheduleWithClass(drizzleDb, Number(result.lastInsertRowid), req.teacherId);
  clearReportCache(req.teacherId);
  logAudit({ teacherId: req.teacherId, action: 'CREATE', tableName: 'schedules', recordId: created.id, after: created });
  const warnings = getConflictsForSchedule(created.id, req.teacherId);
  res.json({ ...created, warnings: warnings.length > 0 ? warnings : undefined });
});

// ── Batch operations (must be before /:id routes) ──

router.post('/batch', validateBatchCreate, handle, (req, res) => {
  const { classId, semesterId, weekday, dates: manualDates, startTime, endTime, durationBilling, preview } = req.body;
  if (!isValidScheduleSpan(startTime, endTime)) return res.status(400).json({ error: '排课时长须大于 0 且小于 24 小时' });
  const storedEndTime = normalizeScheduleEndTime(endTime);
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const billing = calcDurationBilling(startTime, storedEndTime, durationBilling);
  let targetDates = [];
  // Years the semester spans that have no holiday data at all (see below).
  let uncoveredYears = [];

  if (manualDates && manualDates.length > 0) {
    targetDates = manualDates;
    // Check that dates mode doesn't cross semester boundaries
    const teacherSemesters = getTeacherSemesters(drizzleDb, req.teacherId);
    if (teacherSemesters.length > 0 && !req.body.crossSemester) {
      const inSemester = targetDates.filter(d =>
        teacherSemesters.some(sem => d >= sem.startDate && d <= sem.endDate)
      );
      if (inSemester.length > 0 && inSemester.length < targetDates.length) {
        return res.status(400).json({ error: '日期跨学期边界（部分在学期内、部分在学期外），请分批操作', crossSemester: true, inSemester: inSemester.length, outSemester: targetDates.length - inSemester.length });
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

    // 排课日期在这一分支是从学期行推算的，dates.* 那套校验管不到。旧服务端
    // 收下的越界学期在原地升级的库里仍然存在，按它批量排课会写出一批所有
    // 区间查询都看不到、按范围也删不掉的排课。
    //
    // 卡的是循环真正用到的区间（semesterStart 已经取过今天），不是原始的 startDate：
    // startDate=1899 而 endDate 在未来的学期，从今天起生成的每一天都在范围内，
    // 没理由逼用户去改一个实际区间完全正常的学期。
    if (!isValidDate(semesterStart) || !isValidDate(semester.endDate)) {
      return res.status(400).json({ error: `学期起止日期越界${DATE_RANGE_SUFFIX}，请先修正该学期` });
    }

    // Semester dates carry no span cap, and the walk below is synchronous:
    // a typo'd millennium-long semester would block the event loop for seconds.
    // Real semesters are well under two years.
    if (end - current > 550 * 24 * 3600 * 1000) {
      return res.status(400).json({ error: '学期跨度过长，请检查学期起止日期' });
    }

    const { isOffDay, dbYears: dbHolidayYears } = buildOffDayCheck(req.teacherId);

    while (current <= end) {
      const dateStr = toLocalDateStr(current);
      if (current.getDay() === weekday && !isOffDay(dateStr)) {
        targetDates.push(dateStr);
      }
      current.setDate(current.getDate() + 1);
    }

    // Semester mode advertises "skips holidays automatically". For a year with
    // neither built-in nor teacher-defined holiday data no skipping happened at
    // all, so the caller would silently get classes booked on 国庆. Report it
    // instead of staying quiet; built-in data only covers published years.
    uncoveredYears = [...new Set(targetDates.map(d => d.slice(0, 4)))]
      .filter(y => !dbHolidayYears.has(y) && getHolidaysForYear(y).length === 0)
      .sort();
  } else {
    return res.status(400).json({ error: 'Provide semesterId+weekday or dates[]' });
  }

  if (targetDates.length === 0) {
    return res.status(400).json({ error: 'No valid dates to schedule' });
  }

  const holidayWarning = uncoveredYears.length === 0 ? {} : {
    holidayDataMissing: uncoveredYears,
    hint: `${uncoveredYears.join('、')} 年没有内置或自定义的法定节假日数据，这些年份的排课未跳过节假日，请先通过 POST /api/holidays/batch 导入`,
  };

  if (preview) {
    return res.json({ count: targetDates.length, dates: targetDates, ...holidayWarning });
  }

  const allValues = targetDates.map(date => ({
    classId, date, startTime, endTime: storedEndTime, durationBilling: billing,
    locationName: cls.defaultLocationName,
    locationLat: cls.defaultLocationLat,
    locationLng: cls.defaultLocationLng,
  }));
  // Chunk inserts to stay within SQLite's default 999-parameter limit
  const CHUNK = 50;
  const idList = [];
  try {
    db.transaction(() => {
      for (let i = 0; i < allValues.length; i += CHUNK) {
        const inserted = drizzleDb.insert(schedules).values(allValues.slice(i, i + CHUNK))
          .returning({ id: schedules.id }).all();
        idList.push(...inserted.map(row => row.id));
      }
    })();
  } catch (e) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: '部分日期同一时间已有排课，请检查冲突' });
    }
    throw e;
  }
  logAudit({ teacherId: req.teacherId, action: 'BATCH_CREATE', tableName: 'schedules', after: { count: idList.length, ids: idList } });
  clearReportCache(req.teacherId);
  res.json({ count: idList.length, ids: idList, ...holidayWarning });
});

router.put('/batch', validateBatchUpdate, handle, (req, res) => {
  const { classId, fromDate, toDate, weekday, semesterOnly = true, dryRun = false, updates } = req.body;
  if (!classId || !updates || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'classId and updates required' });
  }

  // Require at least one scoping filter to prevent accidental mass updates
  if (!fromDate && !toDate && weekday == null) {
    return res.status(400).json({ error: 'fromDate, toDate, or weekday required to scope the update' });
  }
  if (fromDate && toDate && fromDate > toDate) {
    return res.status(400).json({ error: 'fromDate 须不晚于 toDate' });
  }

  const allowed = new Set(['startTime', 'endTime', 'durationBilling', 'locationName', 'locationLat', 'locationLng']);
  const safeUpdates = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.has(k)));
  // dayShift 不是列，是「每行各自挪多少天」。它进不了 safeUpdates：那里装的是套到
  // 所有匹配行的常量，把日期当常量写进去就是把整学期的周四压到同一天（紧接着撞
  // idx_schedules_unique）。要表达「周四统一改到周五」，需要的是相对位移。
  const dayShift = Number.isInteger(updates.dayShift) ? updates.dayShift : undefined;
  if (Object.keys(safeUpdates).length === 0 && dayShift === undefined) {
    return res.status(400).json({ error: 'No valid fields in updates' });
  }
  if (safeUpdates.locationLat != null) safeUpdates.locationLat = Number(safeUpdates.locationLat);
  if (safeUpdates.locationLng != null) safeUpdates.locationLng = Number(safeUpdates.locationLng);
  // Same rule as the single-item update: clearing the name clears its coordinates.
  if ('locationName' in safeUpdates && safeUpdates.locationName == null) {
    if (!('locationLat' in safeUpdates)) safeUpdates.locationLat = null;
    if (!('locationLng' in safeUpdates)) safeUpdates.locationLng = null;
  }

  if (safeUpdates.startTime !== undefined && !isValidTime(safeUpdates.startTime)) {
    return res.status(400).json({ error: '开始时间须为有效的 HH:MM (00:00-23:59)' });
  }
  const requestedEndTime = safeUpdates.endTime;
  if (requestedEndTime !== undefined) {
    if (!isValidScheduleEndTime(requestedEndTime)) {
      return res.status(400).json({ error: '结束时间须为有效的 HH:MM (00:00-47:59)' });
    }
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

  const sr = filterBySemesters(candidates, { semesterOnly, drizzleDb, teacherId: req.teacherId });
  candidates = sr.candidates;
  let semesterFiltered = sr.filtered;

  // 上面那道过滤看的是位移「之前」的日期。挪完可能才跑出学期——同一条规则再跑一次，
  // 这次喂给它位移后的日期，越界的那几节就留在原地（与 semesterOnly 的既有语义一致：
  // 只有部分越界时才过滤，整批都在学期外时照旧放行）。
  if (dayShift !== undefined && candidates.length > 0) {
    const shifted = candidates.map(c => ({ ...c, date: shiftDate(c.date, dayShift) }));
    const srShifted = filterBySemesters(shifted, { semesterOnly, drizzleDb, teacherId: req.teacherId });
    if (srShifted.filtered > 0) {
      const keep = new Set(srShifted.candidates.map(c => c.id));
      candidates = candidates.filter(c => keep.has(c.id));
      semesterFiltered += srShifted.filtered;
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
  let holidayDates;
  if (updatedIds.length > 0) {
    if (safeUpdates.startTime !== undefined || safeUpdates.endTime !== undefined) {
      if (candidates.some(c => !isValidScheduleSpan(
        safeUpdates.startTime ?? c.startTime,
        requestedEndTime ?? c.endTime,
      ))) {
        return res.status(400).json({ error: '排课时长须大于 0 且小于 24 小时' });
      }
      if (requestedEndTime !== undefined) safeUpdates.endTime = normalizeScheduleEndTime(requestedEndTime);
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
    if (dayShift !== undefined) {
      const targets = [...candidates].sort((a, b) => a.date.localeCompare(b.date))
        .map(c => ({ ...c, target: shiftDate(c.date, dayShift) }));

      // 越界的日期写进去就再也看不见也删不掉：每条读取路径都是按区间过滤的，
      // 而这两个上下限正是那些区间的边界（服务端 isValidDate 与前端同源）。
      const outOfRange = targets.find(t => !isValidDate(t.target));
      if (outOfRange) {
        return res.status(400).json({ error: `位移后的日期 ${outOfRange.target} 超出可用范围${DATE_RANGE_SUFFIX}，未做任何修改` });
      }

      // 目标格子可能被一节「不参与这次移动」的课占着（被 weekday 或学期过滤掉的）。
      // 交给唯一索引去撞也能拿到 409，但报不出是哪一天，调用方只能一节节试。
      const movingIds = new Set(updatedIds);
      const occupied = new Set(
        drizzleDb.select().from(schedules).where(eq(schedules.classId, classId)).all()
          .filter(row => !movingIds.has(row.id))
          .map(row => `${row.date}|${row.startTime}`)
      );
      for (const t of targets) {
        const startTime = safeUpdates.startTime ?? t.startTime;
        if (occupied.has(`${t.target}|${startTime}`)) {
          return res.status(409).json({ error: `位移后 ${t.target} ${startTime} 与该班级已有的课重复，未做任何修改` });
        }
      }

      // 落到节假日上不拦，但要说：批量创建会主动跳过节假日，位移一声不吭把课挪到
      // 国庆上，是同一类静默算错。
      const { isOffDay } = buildOffDayCheck(req.teacherId);
      const landed = [...new Set(targets.map(t => t.target))].filter(d => isOffDay(d));
      if (landed.length > 0) holidayDates = landed;
    }

    // 预览：校验全部走完之后才返回，所以 dryRun 看到的 400/409 和真跑一次完全一致。
    // 它对所有字段生效，不只是 dayShift——只管 dayShift 的话，带着 dryRun 改时间
    // 会真写进去，比不支持预览更糟。
    if (dryRun) {
      const preview = { count: updatedIds.length, ids: updatedIds };
      if (dayShift !== undefined) {
        preview.dates = [...candidates]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map(c => ({ id: c.id, from: c.date, to: shiftDate(c.date, dayShift) }));
      }
      if (semesterFiltered > 0) {
        preview.semesterFiltered = semesterFiltered;
        preview.hint = `${semesterFiltered}条记录因不在当前学期内被过滤，如需修改请设置 semesterOnly=false`;
      }
      if (holidayDates) preview.holidayDates = holidayDates;
      return res.json(preview);
    }

    try {
      if (dayShift === undefined) {
        drizzleDb.update(schedules).set(safeUpdates).where(inArray(schedules.id, updatedIds)).run();
      } else {
        // 逐行挪，顺序取决于方向。一条 `UPDATE ... SET date = date(date,'+N days')`
        // 在整周序列上会撞 idx_schedules_unique：第一行挪到第二行此刻占着的日期就报错，
        // 整条语句回滚（实测）。往后挪先动最晚的一节、往前挪先动最早的一节，途中不重叠。
        const ordered = [...candidates].sort((a, b) =>
          dayShift >= 0 ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
        db.transaction(() => {
          for (const c of ordered) {
            drizzleDb.update(schedules)
              .set({ ...safeUpdates, date: shiftDate(c.date, dayShift) })
              .where(eq(schedules.id, c.id)).run();
          }
        })();
      }
    } catch (e) {
      // Batch-updating several rows to the same start time on the same date
      // violates idx_schedules_unique — surface it as a conflict, not a 500.
      if (e.message?.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: '批量修改会导致该班级同日期同一时间重复排课，请调整时间或缩小范围' });
      }
      throw e;
    }
  }

  // dayShift 不在 safeUpdates 里（它不是列，是每行各自的位移），不单独记下来的话
  // 这条审计只剩「改了 N 行、updates 为空」，事后既读不懂也还原不回去。
  const auditAfter = { count: updatedIds.length, ids: updatedIds, classId, updates: safeUpdates };
  if (dayShift !== undefined) {
    const srcDates = candidates.map(c => c.date).sort();
    auditAfter.dayShift = dayShift;
    auditAfter.dateRange = { from: srcDates[0], to: srcDates[srcDates.length - 1] };
  }
  logAudit({
    teacherId: req.teacherId, action: 'BATCH_UPDATE', tableName: 'schedules',
    after: auditAfter,
  });
  clearReportCache(req.teacherId);
  const resp = { count: updatedIds.length, ids: updatedIds };
  if (semesterFiltered > 0) {
    resp.semesterFiltered = semesterFiltered;
    resp.hint = `${semesterFiltered}条记录因不在当前学期内被过滤，如需修改请设置 semesterOnly=false`;
  }
  if (holidayDates) resp.holidayDates = holidayDates;
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

    const sr = filterBySemesters(candidates, { semesterOnly: semesterOnly !== false, drizzleDb, teacherId: req.teacherId });
    candidates = sr.candidates;
    let semesterFiltered = sr.filtered;

    const toDelete = candidates.map(s => s.id);
    if (!dryRun) {
      db.transaction(() => {
        if (toDelete.length > 0) drizzleDb.delete(schedules).where(inArray(schedules.id, toDelete)).run();
      })();
      if (toDelete.length > 0) clearReportCache(req.teacherId);
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

    const sr = filterBySemesters(candidates, { semesterOnly: semesterOnly !== false, drizzleDb, teacherId: req.teacherId });
    candidates = sr.candidates;
    let semesterFiltered = sr.filtered;

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
      db.transaction(() => {
        drizzleDb.delete(schedules).where(inArray(schedules.id, toDelete)).run();
      })();
      clearReportCache(req.teacherId);
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
      const queryClassIds = parseClassIdsParam(classId);
      if (queryClassIds.length) classIds = classIds.filter(id => queryClassIds.includes(id));
    }
    if (classIds.length === 0) {
      return res.json({ count: 0, ids: [] });
    }
    let candidates = drizzleDb.select({ id: schedules.id, classId: schedules.classId, date: schedules.date })
      .from(schedules).where(and(gte(schedules.date, start), lte(schedules.date, end), inArray(schedules.classId, classIds))).all();

    const sr = filterBySemesters(candidates, { semesterOnly: semesterOnly !== false, drizzleDb, teacherId: req.teacherId });
    candidates = sr.candidates;
    let semesterFiltered = sr.filtered;

    const toDelete = candidates.map(s => s.id);
    if (!dryRun) {
      db.transaction(() => {
        if (toDelete.length > 0) drizzleDb.delete(schedules).where(inArray(schedules.id, toDelete)).run();
      })();
      if (toDelete.length > 0) clearReportCache(req.teacherId);
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
  if (updates.locationLat != null) updates.locationLat = Number(updates.locationLat);
  if (updates.locationLng != null) updates.locationLng = Number(updates.locationLng);
  // Coordinates without a name point at a place the caller just removed, so
  // clear them alongside it unless the caller supplied new ones explicitly.
  if ('locationName' in updates && updates.locationName == null) {
    if (!('locationLat' in updates)) updates.locationLat = null;
    if (!('locationLng' in updates)) updates.locationLng = null;
  }

  // Validate new classId belongs to this teacher and is not deleted
  if (updates.classId !== undefined) {
    const newCls = drizzleDb.select().from(classes)
      .where(and(eq(classes.id, updates.classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
    if (!newCls) return res.status(403).json({ error: 'Forbidden' });
  }
  if (updates.startTime !== undefined || updates.endTime !== undefined) {
    const rawEndTime = updates.endTime ?? existing.endTime;
    if (!isValidScheduleSpan(updates.startTime ?? existing.startTime, rawEndTime)) {
      return res.status(400).json({ error: '排课时长须大于 0 且小于 24 小时' });
    }
    if (updates.endTime !== undefined) updates.endTime = normalizeScheduleEndTime(rawEndTime);
    updates.durationBilling = calcDurationBilling(
      updates.startTime || existing.startTime,
      updates.endTime || existing.endTime,
      updates.durationBilling,
    );
  }
  const effectiveClassId = updates.classId ?? existing.classId;
  const effectiveDate = updates.date ?? existing.date;
  const effectiveStartTime = updates.startTime ?? existing.startTime;
  const effectiveEndTime = updates.endTime ?? existing.endTime;
  if (effectiveStartTime === effectiveEndTime) return res.status(400).json({ error: '排课时长须大于 0 且小于 24 小时' });
  try {
    // Duplicate check + update must be atomic; a concurrent insert (e.g. from a
    // second server process) could otherwise slip in between and surface as a 500.
    db.transaction(() => {
      const dup = drizzleDb.select().from(schedules)
        .where(and(eq(schedules.classId, effectiveClassId), eq(schedules.date, effectiveDate), eq(schedules.startTime, effectiveStartTime), ne(schedules.id, +id))).get();
      if (dup) {
        const err = new Error('duplicate schedule');
        err.status = 409;
        throw err;
      }
      drizzleDb.update(schedules).set(updates).where(eq(schedules.id, +id)).run();
    })();
  } catch (e) {
    if (e.status === 409 || e.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: '该班级在此日期的同一时间已有排课' });
    }
    throw e;
  }
  const updated = getScheduleWithClass(drizzleDb, +id, req.teacherId);
  clearReportCache(req.teacherId);
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'schedules', recordId: +id, before: existing, after: updated });
  const warnings = getConflictsForSchedule(+id, req.teacherId);
  res.json({ ...updated, warnings: warnings.length > 0 ? warnings : undefined });
});

router.delete('/:id', (req, res) => {
  const id = +req.params.id;
  if (!id || id < 1) return res.status(400).json({ error: '无效的ID' });
  const existing = drizzleDb.select().from(schedules).where(eq(schedules.id, id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, existing.classId), eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).get();
  if (!cls) return res.status(403).json({ error: 'Forbidden' });
  drizzleDb.delete(schedules).where(eq(schedules.id, id)).run();
  clearReportCache(req.teacherId);
  logAudit({ teacherId: req.teacherId, action: 'DELETE', tableName: 'schedules', recordId: id, before: existing });
  res.json({ ok: true });
});

// ── Summary & Export ──

router.get('/summary', (req, res) => {
  const { start, end, format } = resolveRange(req.query);
  if (!start || !end) return res.status(400).json({ error: 'start/end or range required' });
  const rangeError = validateRange(start, end);
  if (rangeError) return res.status(400).json({ error: rangeError });

  const teacherClasses = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
  const classMap = {};
  teacherClasses.forEach(c => classMap[c.id] = c);
  let classIds = teacherClasses.map(c => c.id);
  if (req.query.classId) {
    const queryClassIds = parseClassIdsParam(req.query.classId);
    classIds = classIds.filter(id => queryClassIds.includes(id));
  }
  if (classIds.length === 0) {
    const empty = { count: 0, hours: 0, revenue: 0, byClass: [], bySubject: [], byGrade: [], byMonth: [] };
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(toCSV([['班级', '年级', '学科', '课次', '课时数(小时)', '收入(元)']]));
    }
    return res.json(empty);
  }

  if (format !== 'csv') {
    const cacheClassId = normalizeMultiParam(req.query.classId);
    const cached = getReportCache({ teacherId: req.teacherId, start, end, classId: cacheClassId });
    if (cached) {
      res.setHeader('X-Report-Cache', 'hit');
      return res.json(cached);
    }
  }

  const scheds = drizzleDb.select().from(schedules)
    .where(and(gte(schedules.date, start), lte(schedules.date, end), inArray(schedules.classId, classIds)))
    .all();

  // Load class_pricing for revenue calculation
  const allPricing = drizzleDb.select().from(classPricing)
    .where(inArray(classPricing.classId, classIds)).all();
  const matchPricing = buildPricingLookup(allPricing);

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
    // A discount larger than the session gross is a data-entry artifact, not
    // money owed by the teacher — never let a session contribute negative revenue.
    byClassMap[s.classId].revenue += Math.max(0, unit * cnt - disc) * (s.durationBilling / 60);
  }

  const byClass = Object.entries(byClassMap).map(([cid, agg]) => {
    const cls = classMap[+cid];
    const hours = agg.minutes / 60;
    return { classId: +cid, name: cls.name, subject: cls.subject, grade: cls.grade, isCompetition: !!cls.isCompetition, count: agg.count, hours, revenue: agg.revenue };
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

  const bySubjectMap = Object.create(null);
  const byGradeMap = Object.create(null);
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

  const byMonthMap = {};
  for (const s of scheds) {
    const m = s.date.slice(0, 7);
    if (!byMonthMap[m]) byMonthMap[m] = { month: m, count: 0, minutes: 0, revenue: 0 };
    byMonthMap[m].count++;
    byMonthMap[m].minutes += s.durationBilling;
    const p = matchPricing(s.classId, s.date);
    const cls = classMap[s.classId];
    const unit = p?.unitPrice ?? cls?.unitPrice ?? 0;
    const cnt = p?.studentCount ?? cls?.studentCount ?? 0;
    const disc = p?.discountAmount ?? cls?.discountAmount ?? 0;
    byMonthMap[m].revenue += Math.max(0, unit * cnt - disc) * (s.durationBilling / 60);
  }

  const response = {
    count: scheds.length,
    hours: scheds.reduce((s, r) => s + r.durationBilling, 0) / 60,
    revenue: byClass.reduce((s, b) => s + b.revenue, 0),
    byClass,
    bySubject: Object.values(bySubjectMap).sort((a, b) => b.count - a.count),
    byGrade: Object.values(byGradeMap).sort((a, b) => b.count - a.count),
    byMonth: Object.values(byMonthMap).map(m => ({ month: m.month, count: m.count, hours: m.minutes / 60, revenue: m.revenue })).sort((a, b) => a.month.localeCompare(b.month)),
  };
  if (format !== 'csv') {
    setReportCache({ teacherId: req.teacherId, start, end, classId: normalizeMultiParam(req.query.classId) }, response);
    res.setHeader('X-Report-Cache', 'miss');
  }
  res.json(response);
});

router.get('/export', (req, res) => {
  const resolved = resolveRange(req.query);
  const { start, end, classId, format } = resolved;
  if (!start || !end) return res.status(400).json({ error: 'start/end or range required' });
  const rangeError = validateRange(start, end);
  if (rangeError) return res.status(400).json({ error: rangeError });

  const teacherClasses = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
  let cIds = teacherClasses.map(c => c.id);
  if (classId) {
    const queryClassIds = parseClassIdsParam(classId);
    cIds = cIds.filter(id => queryClassIds.includes(id));
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
    const matchPricing = buildPricingLookup(allPricing);

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

function getFreeSlotsForDate(dateStr, teacherId, dayStart = '08:00', dayEnd = '22:30') {
  const teacherClasses = drizzleDb.select({ id: classes.id }).from(classes)
    .where(and(eq(classes.teacherId, teacherId), eq(classes.deleted, false))).all();
  const classIds = teacherClasses.map(c => c.id);
  if (classIds.length === 0) return [{ start: dayStart, end: dayEnd }];

  const daySchedules = drizzleDb.select().from(schedules)
    .where(and(
      gte(schedules.date, shiftDate(dateStr, -1)),
      lte(schedules.date, dateStr),
      inArray(schedules.classId, classIds),
    )).all();

  if (daySchedules.length === 0) return [{ start: dayStart, end: dayEnd }];

  return computeFreeSlots(daySchedules, dayStart, dayEnd, dateStr);
}

function computeFreeSlots(daySchedules, dayStart, dayEnd, dateStr) {
  const toTime = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const startMin = toMin(dayStart);
  const endMin = toMin(dayEnd);
  const targetDayStart = scheduleBounds({ date: dateStr, startTime: '00:00', endTime: '00:01' })[0];
  const busyRanges = daySchedules.map(schedule => {
    const [start, end] = scheduleBounds(schedule);
    return { start: start - targetDayStart, end: end - targetDayStart };
  }).sort((a, b) => a.start - b.start);
  const freeSlots = [];
  let cursor = startMin;

  for (const range of busyRanges) {
    const busyStart = Math.max(startMin, range.start);
    const busyEnd = Math.min(endMin, range.end);
    if (busyEnd <= startMin || busyStart >= endMin) continue;
    if (busyStart > cursor) freeSlots.push({ start: toTime(cursor), end: toTime(busyStart) });
    cursor = Math.max(cursor, busyEnd);
  }
  if (cursor < endMin) freeSlots.push({ start: toTime(cursor), end: toTime(endMin) });
  return freeSlots;
}

router.get('/free-slots', (req, res) => {
  const { date, start, end, dayStart, dayEnd, after, before, minDuration } = req.query;
  for (const [key, value] of Object.entries({ date, start, end })) {
    if (value != null && !isValidDate(value)) {
      return res.status(400).json({ error: `${key} 须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}` });
    }
  }
  for (const [key, value] of Object.entries({ dayStart, dayEnd, after, before })) {
    if (value != null && !isValidTime(value)) {
      return res.status(400).json({ error: `${key} 须为有效的 HH:MM (00:00-23:59)` });
    }
  }
  const dStart = after || dayStart || '08:00';
  const dEnd = before || dayEnd || '22:30';
  if (dStart >= dEnd) {
    return res.status(400).json({ error: 'after/dayStart 须早于 before/dayEnd（不支持跨午夜查询）' });
  }
  // An empty value means "no minimum", the same as omitting the param. Clients
  // that always append &minDuration= must not get a 400 for leaving it blank.
  const rawMinDuration = minDuration == null || String(minDuration).trim() === '' ? null : minDuration;
  if (rawMinDuration != null && (!Number.isFinite(+rawMinDuration) || +rawMinDuration < 0)) {
    return res.status(400).json({ error: 'minDuration 须为非负数字' });
  }
  const minDur = rawMinDuration == null ? 0 : +rawMinDuration;

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
    const rangeError = validateRange(start, end, { maxDays: 365 });
    if (rangeError) return res.status(400).json({ error: rangeError });
    // Bulk query: fetch all schedules in range once instead of day-by-day
    const teacherClassIds = drizzleDb.select({ id: classes.id }).from(classes)
      .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all().map(c => c.id);
    if (teacherClassIds.length === 0) {
      // All days are fully free
      const results = [];
      const current = new Date(start + 'T00:00:00');
      const endDate = new Date(end + 'T00:00:00');
      while (current <= endDate) {
        const slots = filterSlots([{ start: dStart, end: dEnd }]);
        if (slots.length > 0) results.push({ date: toLocalDateStr(current), slots });
        current.setDate(current.getDate() + 1);
      }
      return res.json(results);
    }
    const rangeSchedules = drizzleDb.select().from(schedules)
      .where(and(gte(schedules.date, shiftDate(start, -1)), lte(schedules.date, end), inArray(schedules.classId, teacherClassIds)))
      .all()
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const byDate = {};
    for (const s of rangeSchedules) {
      (byDate[s.date] ??= []).push(s);
    }
    const results = [];
    const current = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    while (current <= endDate) {
      const dateStr = toLocalDateStr(current);
      const relevant = [...(byDate[shiftDate(dateStr, -1)] || []), ...(byDate[dateStr] || [])];
      const slots = filterSlots(computeFreeSlots(relevant, dStart, dEnd, dateStr));
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
  const rangeError = validateRange(start, end);
  if (rangeError) return res.status(400).json({ error: rangeError });
  const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 20, 100));

  // 整行都要：下面 classMap 会把它挂到每条排课的 class 上。只选 id 的话
  // 返回的是 {id: N} 这样的残件，调用方拿不到班级名——而本接口的唯一用途就是
  // 把冲突讲清楚，别的排课接口给的都是完整班级对象。
  const teacherClasses = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
  let classIds = teacherClasses.map(c => c.id);
  const { classId } = req.query;
  if (classId) {
    const queryClassIds = parseClassIdsParam(classId);
    classIds = classIds.filter(id => queryClassIds.includes(id));
  }
  if (classIds.length === 0) return res.json({ total: 0, groups: [] });

  const classMap = {};
  teacherClasses.forEach(c => classMap[c.id] = c);

  const allSchedules = drizzleDb.select().from(schedules)
    .where(and(gte(schedules.date, shiftDate(start, -1)), lte(schedules.date, shiftDate(end, 1)), inArray(schedules.classId, classIds)))
    .all()
    .map(s => ({ ...s, class: classMap[s.classId] || null }));

  const conflictGroups = [];
  const groups = detectDatedConflictGroups(allSchedules).filter(group =>
    group.length > 1 && group.some(s => s.date >= start && s.date <= end)
  );
  for (const group of groups) {
    conflictGroups.push({ date: group[0].date, schedules: group });
    if (conflictGroups.length >= limit) break;
  }
  res.json({ total: conflictGroups.length, groups: conflictGroups });
});

router.get('/:id', (req, res) => {
  const s = getScheduleWithClass(drizzleDb, +req.params.id, req.teacherId);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

export default router;
