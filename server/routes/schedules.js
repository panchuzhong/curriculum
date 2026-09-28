import { Router } from 'express';
import { drizzleDb, db } from '../db/index.js';
import { schedules, classes, semesters, holidays, classStudents, classPricing } from '../db/schema.js';
import { eq, and, gte, lte, inArray, ne } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { buildHolidayCalendar } from '../services/holiday-calendar.js';
import handle from '../validations/handle.js';
import { validateCreateSchedule, validateBatchCreate, validateBatchUpdate, validateBatchDelete, validateUpdateSchedule } from '../validations/schedules.js';
import { isCalendarDate, isValidDate, isValidScheduleEndTime, isValidScheduleSpan, isValidTime, normalizeScheduleEndTime, DATE_RANGE_SUFFIX } from '../validations/dates.js';
import { logAudit } from '../services/audit.js';
import { toLocalDateStr, toMin, resolveRange, toCSV, detectDatedConflictGroups, getScheduleWithClass, calcDurationBilling, getTeacherSemesters, buildPricingLookup, scheduleBounds, schedulesOverlap } from '../services/schedule-helpers.js';
import { clearReportCache, getReportCache, setReportCache } from '../services/report-cache.js';
import { students as studentsTable } from '../db/schema.js';

// 「这一天在不在该教师的某个学期里」。filterBySemesters、批量创建的 dates 模式、
// 批量位移的挪出学期检查问的都是这一句，只能有一份：将来修一处（比如坏掉的学期行）
// 而漏了另两处，挪之前和挪之后的学期判断就会互相打架。
function semesterMembership(db, teacherId) {
  const teacherSemesters = getTeacherSemesters(db, teacherId);
  return {
    hasSemesters: teacherSemesters.length > 0,
    inSemester: (date) => teacherSemesters.some(sem => date >= sem.startDate && date <= sem.endDate),
  };
}

function filterBySemesters(candidates, { semesterOnly, drizzleDb, teacherId }) {
  let filtered = 0;
  // Semester scoping only kicks in when candidates STRADDLE a semester boundary
  // (some inside, some outside). If every candidate is outside — e.g. legacy
  // schedules recorded before the teacher defined any semester — they are left
  // untouched so historical data remains operable. This asymmetry is asserted
  // by the batch update/delete tests in routes-schedules.test.js.
  if (semesterOnly !== false) {
    const membership = semesterMembership(drizzleDb, teacherId);
    if (membership.hasSemesters) {
      const inSemester = candidates.filter(s => membership.inSemester(s.date));
      if (inSemester.length > 0 && inSemester.length < candidates.length) {
        filtered = candidates.length - inSemester.length;
        candidates = inSemester;
      }
    }
  }
  return { candidates, filtered };
}

const router = Router();
// PUT /batch 的三个出口（候选为空的提前返回、dryRun 预览、真跑）要挂同一组提示。
// hint 只有一个字段，所以几件事必须拼在一起：读 hint 的 UI/agent 不该因为学期
// 那句话就漏掉节假日。
function attachBatchUpdateWarnings(resp, { semesterFiltered = 0, holidayDates, holidayLessonCount, holidayDataMissing, warnings } = {}) {
  const hints = [];
  if (semesterFiltered > 0) {
    resp.semesterFiltered = semesterFiltered;
    hints.push(`${semesterFiltered}条记录因不在当前学期内被过滤，如需修改请设置 semesterOnly=false`);
  }
  if (holidayDates?.length > 0) {
    resp.holidayDates = holidayDates;
    // holidayDates 按日期去重，同一天两节课只算一个日期；这里说的是课数。
    hints.push(`位移后有 ${holidayLessonCount} 节课落在节假日（${holidayDates.join('、')}），未作拦截`);
  }
  if (holidayDataMissing?.length > 0) {
    resp.holidayDataMissing = holidayDataMissing;
    hints.push(missingHolidayDataHint(holidayDataMissing, '无法判断位移后是否落在节假日'));
  }
  if (warnings?.length > 0) {
    resp.warnings = warnings;
    hints.push(`有 ${warnings.length} 节课改完后与其他排课时间重叠（见 warnings），未作拦截`);
  }
  if (hints.length > 0) resp.hint = hints.join('；');
  return resp;
}

// 与其他排课的时间重叠。单条写入（POST /、PUT /:id）和批量修改共用这一份，报出来
// 的形状因此天然一致。
// finals 是「改完之后的样子」（id/classId/date/startTime/endTime），所以写之前就能算，
// 批量修改的 dryRun 也就能预告重叠。这些 id 在库里的旧位置要从比较对象里剔掉、
// 换成改完的位置，否则一节课会和自己挪走之前的影子「重叠」。
// 只取这些课所在日期及前后各一天的排课（schedulesOverlap 要看跨午夜的课），按日期
// 分组，每节只和同一天及相邻两天比——不是把整段跨度里的每一行两两相比。
// 按具体日期取、而不是按「最早到最晚」一个区间取，还有一层用处：历史数据里解析
// 不了的日期（'2026-2-1'）推出来的前后一天是 NaN，放进区间当上界会让整批一行都
// 取不到；放进日期列表里，只是多了几个匹配不到的键，其余行照常比较。
function findConflicts(finals, teacherId) {
  if (finals.length === 0) return [];
  const teacherClasses = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, teacherId), eq(classes.deleted, false))).all();
  if (teacherClasses.length === 0) return [];
  const classMap = new Map(teacherClasses.map(c => [c.id, c]));
  const neighbours = (date) => [shiftDate(date, -1), date, shiftDate(date, 1)];

  const byDate = new Map();
  const add = (row) => {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  };
  const finalIds = new Set(finals.map(r => r.id));
  drizzleDb.select().from(schedules).where(and(
    inArray(schedules.date, [...new Set(finals.flatMap(r => neighbours(r.date)))]),
    inArray(schedules.classId, [...classMap.keys()]),
  )).all().filter(o => !finalIds.has(o.id)).forEach(add);
  finals.filter(r => classMap.has(r.classId)).forEach(add);

  const out = [];
  for (const r of [...finals].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))) {
    const conflicts = neighbours(r.date).flatMap(d => byDate.get(d) ?? [])
      .filter(o => o.id !== r.id && schedulesOverlap(r, o))
      .map(o => ({ id: o.id, classId: o.classId, className: classMap.get(o.classId)?.name, startTime: o.startTime, endTime: o.endTime }));
    if (conflicts.length > 0) out.push({ id: r.id, date: r.date, conflicts });
  }
  return out;
}

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

// 该教师的节假日日历（规则只有一份，见 services/holiday-calendar.js）。批量创建靠它
// 跳过节假日，批量位移靠它把挪到节假日上的日期报回调用方。
function loadHolidayCalendar(teacherId) {
  const rows = drizzleDb.select({ date: holidays.date, type: holidays.type, name: holidays.name })
    .from(holidays).where(eq(holidays.teacherId, teacherId)).all();
  return buildHolidayCalendar(rows);
}

// 同一个缺口，批量创建和批量位移给同一句事实和同一个补救办法，只有后果不同。
function missingHolidayDataHint(years, consequence) {
  return `${years.join('、')} 年没有内置或自定义的法定节假日数据，${consequence}，请先通过 POST /api/holidays/batch 导入`;
}

function shiftDate(date, days) {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toLocalDateStr(d);
}

function getConflictsForSchedule(scheduleId, teacherId) {
  const s = drizzleDb.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
  if (!s) return [];
  return findConflicts([s], teacherId)[0]?.conflicts ?? [];
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
    const membership = semesterMembership(drizzleDb, req.teacherId);
    if (membership.hasSemesters && !req.body.crossSemester) {
      const inSemester = targetDates.filter(d => membership.inSemester(d));
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

    const { isOffDay, uncoveredYears: findUncoveredYears } = loadHolidayCalendar(req.teacherId);

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
    uncoveredYears = findUncoveredYears(targetDates);
  } else {
    return res.status(400).json({ error: 'Provide semesterId+weekday or dates[]' });
  }

  if (targetDates.length === 0) {
    return res.status(400).json({ error: 'No valid dates to schedule' });
  }

  const holidayWarning = uncoveredYears.length === 0 ? {} : {
    holidayDataMissing: uncoveredYears,
    hint: missingHolidayDataHint(uncoveredYears, '这些年份的排课未跳过节假日'),
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
  // 改日期必须有日期下界。只给 weekday 时候选集是该班历史上所有这个星期几的课
  // （下面的 effectiveFromDate 只在传了 toDate 时才默认为今天），照发一次就会把
  // 已经上完、已经计费的课一起改期——改地点、改时间顶多是改错，改日期是改写交付
  // 记录。这条写进文档也拦不住拿 API Key 的客户端，所以在这里拦。
  if (dayShift !== undefined && !fromDate && !toDate) {
    return res.status(400).json({
      error: '改日期（dayShift）必须给出日期下界：请加上 fromDate（或 toDate，此时下界默认为今天）。只给 weekday 会把该班历史上所有这个星期几的课一起改期，包括已经上完的',
    });
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

  // 源日期先过一遍，而且要排在下面的学期检查之前：isValidDate 只在写入时把关，
  // 历史/导入的行可能存着 '2026-2-1'。它按字符串比 '2026-12-31' 还大，会被当成在
  // 秋季学期内；拿去 shiftDate 又得到 Invalid Date，格式化出来是 0NaN-NaN-NaN。
  // 两者一凑，报错就成了「挪出学期…请设置 semesterOnly=false」——叫人关掉保护，
  // 而真正的问题是那一行本身。
  if (dayShift !== undefined) {
    const unparsable = [...candidates].sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .find(c => !isCalendarDate(c.date));
    if (unparsable) {
      return res.status(400).json({
        error: `第 ${unparsable.id} 条排课的日期存的是 ${unparsable.date}，解析不了（须为 YYYY-MM-DD），未做任何修改`,
      });
    }
  }

  // 上面那道过滤看的是位移「之前」的日期，跑出学期是挪完才发生的。这里**不**做
  // 部分过滤：把越界的那几节留在原地，它们会变成拦住其他几节的障碍物（同班同日期
  // 同开始时间撞唯一索引），而用户看到的是一句讲「重复排课」的 409，完全看不出是
  // 学期保护造成的——同一个请求加上 semesterOnly=false 反而能成。整单拒绝并说清
  // 数量，要继续就显式关掉保护。
  // 只保护「本来在学期内」的课：整批都在学期外的历史数据从来不受这条约束
  // （filterBySemesters 的同一条豁免，README 也这么写），拿学期去拦它们，等于用
  // 一句「不在当前学期内」解释一批压根没在学期内的课。
  if (dayShift !== undefined && semesterOnly !== false && candidates.length > 0) {
    const { hasSemesters, inSemester } = semesterMembership(drizzleDb, req.teacherId);
    if (hasSemesters) {
      const leaving = candidates.filter(c => inSemester(c.date) && !inSemester(shiftDate(c.date, dayShift)))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (leaving.length > 0) {
        return res.status(400).json({
          error: `位移会把 ${leaving.length} 节课挪出学期（如 ${leaving[0].date} → ${shiftDate(leaving[0].date, dayShift)}），未做任何修改；确实要挪请设置 semesterOnly=false`,
        });
      }
    }
  }

  if (candidates.length === 0) {
    // 预览要在每个出口都自报身份，包括这个——否则调用方靠 dryRun 字段区分预览和
    // 真跑时，恰好在「一节都没匹配上」这一种情况下会读错。
    const empty = dryRun
      ? { dryRun: true, count: 0, ids: [], ...(dayShift !== undefined && { dates: [] }) }
      : { count: 0, ids: [] };
    return res.json(attachBatchUpdateWarnings(empty, { semesterFiltered }));
  }

  const updatedIds = candidates.map(s => s.id);
  let holidayDates, holidayLessonCount, holidayDataMissing, targets, warnings;
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
      targets = [...candidates].sort((a, b) => a.date.localeCompare(b.date))
        .map(c => ({ ...c, target: shiftDate(c.date, dayShift) }));

      // 越界的日期写进去就再也看不见也删不掉：每条读取路径都是按区间过滤的，
      // 而这两个上下限正是那些区间的边界（服务端 isValidDate 与前端同源）。
      const outOfRange = targets.find(t => !isValidDate(t.target));
      if (outOfRange) {
        return res.status(400).json({ error: `位移后的日期 ${outOfRange.target} 超出可用范围${DATE_RANGE_SUFFIX}，未做任何修改` });
      }

    }

    // (class, date, startTime) 是唯一键。改了日期或开始时间，就得在写之前把两种撞法
    // 都查出来，而不是交给唯一索引——索引只在真跑时才撞得到，dryRun 会看到 200，
    // 文档承诺的「预览看到的就是真跑的结果」就成了假话：
    //   · 移动集合内部互撞：同一天 09:00 和 11:00 两节，统一改到 14:00；
    //   · 撞上一节不参与这次修改的课（被 weekday 或学期过滤掉的）。
    // 报错只陈述是哪一节，不建议「放宽范围把它一并纳入」：agent 照做去掉 weekday，
    // 范围内每个星期几的课都会跟着挪——一次安全的拒绝会变成一场没人要的大改期。
    // 每节课改完之后的样子。唯一键预检、重叠预告都照它算，写入也照它写——
    // 三处各算一遍就会各自漂。
    const finals = (targets ?? [...candidates]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.startTime.localeCompare(b.startTime))
      .map(c => ({ ...c, target: c.date })))
      .map(t => ({
        id: t.id, classId: t.classId, date: t.target,
        startTime: safeUpdates.startTime ?? t.startTime,
        endTime: safeUpdates.endTime ?? t.endTime,
      }));

    if (dayShift !== undefined || safeUpdates.startTime !== undefined) {
      const byKey = new Map();
      for (const f of finals) {
        const key = `${f.date}|${f.startTime}`;
        const clash = byKey.get(key);
        if (clash) {
          return res.status(409).json({
            error: `修改后第 ${clash.id} 条和第 ${f.id} 条排课会在 ${f.date} ${f.startTime} 重复排课，未做任何修改`,
          });
        }
        byKey.set(key, f);
      }
      const movingIds = new Set(updatedIds);
      const blocker = drizzleDb.select({ id: schedules.id, date: schedules.date, startTime: schedules.startTime })
        .from(schedules)
        .where(and(eq(schedules.classId, classId), inArray(schedules.date, [...new Set(finals.map(f => f.date))])))
        .orderBy(schedules.date, schedules.startTime).all()
        .find(row => !movingIds.has(row.id) && byKey.has(`${row.date}|${row.startTime}`));
      if (blocker) {
        return res.status(409).json({
          error: `修改后 ${blocker.date} ${blocker.startTime} 与该班级第 ${blocker.id} 条排课重复（它不在本次修改范围内），未做任何修改`,
        });
      }
    }

    if (dayShift !== undefined) {
      // 落到节假日上不拦，但要说：批量创建会主动跳过节假日，位移一声不吭把课挪到
      // 国庆上，是同一类静默算错。
      const { isOffDay, uncoveredYears } = loadHolidayCalendar(req.teacherId);
      const targetDates = [...new Set(targets.map(t => t.target))];
      const landed = new Set(targetDates.filter(d => isOffDay(d)));
      if (landed.size > 0) {
        holidayDates = [...landed];
        holidayLessonCount = targets.filter(t => landed.has(t.target)).length;
      }
      // 空的 holidayDates 不等于「没课落在节假日」：内置数据只覆盖已公布的年份，
      // 某一年既无内置也无自定义数据时，上面那句判断压根没有依据。批量创建用
      // holidayDataMissing 报这个缺口，位移沉默的话，调用方会把「不知道」读成
      // 「没问题」。
      holidayDataMissing = uncoveredYears(targetDates);
    }

    // 改了日期或时间才可能造出新的重叠；只改地点不会。单条写入一直会报 warnings，
    // 批量改日期/时间一次就能造出一串重叠，没有理由反倒不说。按改完的样子算，
    // 所以预览里也有。
    if (dayShift !== undefined || safeUpdates.startTime !== undefined || safeUpdates.endTime !== undefined) {
      warnings = findConflicts(finals, req.teacherId);
    }

    // 预览：校验全部走完之后才返回，所以 dryRun 看到的 400/409 和真跑一次完全一致。
    // 它对所有字段生效，不只是 dayShift——只管 dayShift 的话，带着 dryRun 改时间
    // 会真写进去，比不支持预览更糟。
    if (dryRun) {
      // dryRun: true 必须回显：形状和真跑一致是好事，但一模一样就不行——忘了去掉
      // dryRun 的调用方会拿着 count:N 报告「已改期」，而库里一行没动。
      const preview = { dryRun: true, count: updatedIds.length, ids: updatedIds };
      // to 和真正写进去的值必须出自同一处，各算一遍就会漂。
      if (targets) preview.dates = targets.map(t => ({ id: t.id, from: t.date, to: t.target }));
      attachBatchUpdateWarnings(preview, { semesterFiltered, holidayDates, holidayLessonCount, holidayDataMissing, warnings });
      return res.json(preview);
    }

    try {
      if (dayShift === undefined) {
        drizzleDb.update(schedules).set(safeUpdates).where(inArray(schedules.id, updatedIds)).run();
      } else {
        // 逐行挪，顺序取决于方向。一条 `UPDATE ... SET date = date(date,'+N days')`
        // 在整周序列上会撞 idx_schedules_unique：第一行挪到第二行此刻占着的日期就报错，
        // 整条语句回滚（实测）。往后挪先动最晚的一节、往前挪先动最早的一节，途中不重叠。
        const ordered = dayShift >= 0 ? [...targets].reverse() : targets;
        db.transaction(() => {
          for (const t of ordered) {
            drizzleDb.update(schedules)
              .set({ ...safeUpdates, date: t.target })
              .where(eq(schedules.id, t.id)).run();
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
  res.json(attachBatchUpdateWarnings(
    { count: updatedIds.length, ids: updatedIds },
    { semesterFiltered, holidayDates, holidayLessonCount, holidayDataMissing, warnings },
  ));
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
