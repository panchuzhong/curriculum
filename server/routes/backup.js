import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { drizzleDb, db, dbDir } from '../db/index.js';
import { classes, pricingTiers, students, classStudents, schedules, holidays, semesters, auditLog, classPricing } from '../db/schema.js';
import { isValidDate, isValidBirthDate } from '../validations/dates.js';
import { eq, inArray } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { writeFileSync, readFileSync, readdirSync, statSync, unlinkSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { clearSemesterCache } from '../services/schedule-helpers.js';
import { clearReportCache } from '../services/report-cache.js';

const BACKUP_VERSION = 1;
const MAX_PRE_RESTORE_SNAPSHOTS = 5;
const RESTORE_CHUNK_SIZE = 50;

const router = Router();
router.use(authMiddleware);
if (process.env.NODE_ENV !== 'test') {
  router.use(rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }));
}

router.get('/', (req, res) => {
  const tid = req.teacherId;
  const teacherClasses = drizzleDb.select().from(classes).where(eq(classes.teacherId, tid)).all();
  const classIds = teacherClasses.map(c => c.id);

  const data = {
    version: BACKUP_VERSION,
    timestamp: new Date().toISOString(),
    classes: teacherClasses,
    pricingTiers: drizzleDb.select().from(pricingTiers).where(eq(pricingTiers.teacherId, tid)).all(),
    students: drizzleDb.select().from(students).where(eq(students.teacherId, tid)).all(),
    classStudents: classIds.length > 0
      ? drizzleDb.select().from(classStudents).where(inArray(classStudents.classId, classIds)).all()
      : [],
    schedules: classIds.length > 0
      ? drizzleDb.select().from(schedules).where(inArray(schedules.classId, classIds)).all()
      : [],
    holidays: drizzleDb.select().from(holidays).where(eq(holidays.teacherId, tid)).all(),
    semesters: drizzleDb.select().from(semesters).where(eq(semesters.teacherId, tid)).all(),
    classPricing: classIds.length > 0
      ? drizzleDb.select().from(classPricing).where(inArray(classPricing.classId, classIds)).all()
      : [],
    auditLog: drizzleDb.select().from(auditLog).where(eq(auditLog.teacherId, tid)).all(),
  };

  const json = JSON.stringify(data);
  const sizeMB = Buffer.byteLength(json, 'utf8') / (1024 * 1024);
  if (sizeMB > 50) {
    return res.status(413).json({ error: `备份数据过大（${sizeMB.toFixed(1)}MB），请清理历史数据后再试` });
  }

  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  res.setHeader('Content-Disposition', `attachment; filename="backup_${localDate}.json"`);
  res.type('json').send(json);
});

const SNAPSHOT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 快照写入时不卡大小，但读回来是同步的，会把单线程的服务器堵住。
// 取和这个端点自己的 body 上限一致的值：超过就明说原因，而不是默默卡着。
const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
// 残留 .tmp 的最小回收年龄，见 prunePreRestoreSnapshots 末尾。
const TMP_MIN_AGE_MS = 60 * 60 * 1000;
const snapshotPath = (tid, id) => join(dbDir, `.backup_pre_restore_${tid}_${id}.json`);
const snapshotTmpPath = (tid, id) => `${snapshotPath(tid, id)}.tmp`;

router.post('/restore', express.json({ limit: '50mb' }), (req, res) => {
  const tid = req.teacherId;
  let data = req.body;

  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Invalid backup data' });
  }

  // 还原服务端自己写的快照 = 一次撤销，内容直接从磁盘读，不看请求体。
  // 触发字段叫 undoSnapshot，不能复用快照文件自己带的 preRestoreSnapshot：那份文件正是
  // 出事后最可能被直接 POST 回来的东西，两者同名的话它会被当成一次撤销请求，
  // 而磁盘上那份早被清理掉了，结果就是一句 404，手里握着数据却还原不了。
  // 只核文件名的话，拿一个还活着的 UUID 配一份伪造的备份就能把日期校验整个绕过去；
  // 读文件就没这个口子，而且调用方不必自己留着那份 JSON。
  // 快照被清理掉时明确报 404，而不是静默地按普通备份处理（那会正好剔掉
  // 要恢复的那些行）。
  let restoringOwnSnapshot = false;
  if (data.undoSnapshot !== undefined) {
    const id = data.undoSnapshot;
    if (typeof id !== 'string' || !SNAPSHOT_ID_RE.test(id)) {
      return res.status(400).json({ error: 'undoSnapshot 须为快照 UUID' });
    }
    const file = snapshotPath(tid, id);
    if (!existsSync(file)) {
      return res.status(404).json({ error: '快照不存在或已被清理，无法撤销' });
    }
    let raw;
    try {
      // stat 和读都得包在里面：文件在 existsSync 之后被外部删掉的话，
      // 裸着的 statSync 会抛出一个带堆栈的 500（和 prunePreRestoreSnapshots 里同一回事）。
      if (statSync(file).size > MAX_SNAPSHOT_BYTES) {
        return res.status(413).json({ error: '快照文件超过 50 MB，无法通过接口还原' });
      }
      raw = readFileSync(file, 'utf-8');
    } catch (e) {
      console.error('Snapshot read failed:', e);
      // existsSync 和读之间文件没了（两个撤销请求撞一起，或者旁边一次成功还原
      // 把它当配额清了）仍然是「快照不在了」，不是服务器坏了。报 500 的话调用方
      // 分不出这两种，而 agent-help 和 README 都写着被清理掉是 404。
      if (e.code === 'ENOENT') {
        return res.status(404).json({ error: '快照不存在或已被清理，无法撤销' });
      }
      return res.status(500).json({ error: '快照文件无法读取' });
    }
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error('Snapshot read failed:', e);
      return res.status(500).json({ error: '快照文件无法读取' });
    }
    // 截断的写入仍可能解出合法 JSON（比如 null），那下一行的 data.version 就是一个
    // 带堆栈的 500。入口处的同一道检查得对替换后的 data 再走一遍。
    if (!data || typeof data !== 'object') {
      return res.status(500).json({ error: '快照文件无法读取' });
    }
    restoringOwnSnapshot = true;
  }

  if (data.version !== BACKUP_VERSION) {
    return res.status(400).json({ error: `不支持的备份版本（当前: v${BACKUP_VERSION}, 文件: v${data.version ?? '未知'}）` });
  }

  const requiredTables = ['classes', 'students', 'schedules'];
  for (const table of requiredTables) {
    if (!Array.isArray(data[table])) {
      return res.status(400).json({ error: `备份数据缺少 ${table} 或格式不正确` });
    }
  }

  // 数组里混进 null / 标量时，下面的 pick() 会在 r.classId 上直接炸成一个带堆栈的 500。
  // 这是文件坏了，明说比抛栈好。
  for (const table of ['classes', 'students', 'classStudents', 'schedules', 'holidays', 'semesters', 'pricingTiers', 'classPricing', 'auditLog']) {
    const rows = Array.isArray(data[table]) ? data[table] : [];
    if (rows.some(r => r === null || typeof r !== 'object' || Array.isArray(r))) {
      return res.status(400).json({ error: `${table} 中存在非对象元素` });
    }
  }

  // Version 1 relationships use exported class/student IDs as local keys. They
  // must be present and unique so they can be safely remapped to fresh global
  // SQLite IDs during restore.
  for (const table of ['classes', 'students']) {
    const ids = data[table].map(row => row?.id);
    if (ids.some(id => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: `${table} 中的 id 须为唯一正整数` });
    }
  }

  // 撤销路径不写快照，所以也就没有新的回滚点可返回（见下面的响应）。
  let snapshotId = null;
  // 写快照不卡大小（卡了就是让数据多的人连还原都做不了），而撤销要把它整个读回内存，
  // 那一侧有 50 MB 上限。两边不一致的话，数据超过 50 MB 的教师会拿到一个注定被 413
  // 拒掉的 preRestoreSnapshot——而它本该保护的数据已经被覆盖了。发一个兑不了的
  // 句柄，比直说「这次没有可用的撤销点」更坏。文件照写不误，运维手动还原得了。
  let snapshotUndoable = false;

  // 撤销不再存快照：它替掉的那个状态本就是用户刚还原的那份备份，东西在他手里；
  // 而每次撤销都写一份的话，网关超时后重试几次就能把该教师剩下的回滚点全挤没——
  // 而每一次重试写回的都是同一份内容，数据上是空操作。源快照留在磁盘上，重试幂等。
  if (!restoringOwnSnapshot) {
    snapshotId = randomUUID();
    // Save pre-restore snapshot — abort if snapshot fails (data loss risk)
    try {
      const teacherClasses = drizzleDb.select().from(classes).where(eq(classes.teacherId, tid)).all();
      const cids = teacherClasses.map(c => c.id);
      const snapshot = {
        version: BACKUP_VERSION,
        timestamp: new Date().toISOString(),
        // 拿这个 id POST 回 /restore 就是一次撤销（内容服务端自己读，见上面）。
        teacherId: tid,
        preRestoreSnapshot: snapshotId,
        classes: teacherClasses,
        pricingTiers: drizzleDb.select().from(pricingTiers).where(eq(pricingTiers.teacherId, tid)).all(),
        students: drizzleDb.select().from(students).where(eq(students.teacherId, tid)).all(),
        classStudents: cids.length > 0
          ? drizzleDb.select().from(classStudents).where(inArray(classStudents.classId, cids)).all()
          : [],
        schedules: cids.length > 0
          ? drizzleDb.select().from(schedules).where(inArray(schedules.classId, cids)).all()
          : [],
        holidays: drizzleDb.select().from(holidays).where(eq(holidays.teacherId, tid)).all(),
        semesters: drizzleDb.select().from(semesters).where(eq(semesters.teacherId, tid)).all(),
        classPricing: cids.length > 0
          ? drizzleDb.select().from(classPricing).where(inArray(classPricing.classId, cids)).all()
          : [],
        auditLog: drizzleDb.select().from(auditLog).where(eq(auditLog.teacherId, tid)).all(),
      };
      // 先写 .tmp 再改名：进程在写到一半时被杀（OOM、容器重启）的话，直接写会留下一个
      // 名字合法、mtime 最新的残文件，它会占掉 5 份配额里的一个并挤掉真正的回滚点，
      // 而拿它撤销只会得到一句「快照文件无法读取」。.tmp 不匹配计数用的 .json 后缀，不占配额。
      writeFileSync(snapshotTmpPath(tid, snapshotId), JSON.stringify(snapshot));
      renameSync(snapshotTmpPath(tid, snapshotId), snapshotPath(tid, snapshotId));
      // stat 失败不该把一次还没开始的还原报成 500；核不准就当不可撤销，
      // 宁可少应承诺一个撤销点。
      try {
        snapshotUndoable = statSync(snapshotPath(tid, snapshotId)).size <= MAX_SNAPSHOT_BYTES;
      } catch (e2) { snapshotUndoable = false; }
    } catch (e) {
      console.error('Backup snapshot failed:', e);
      // 写到一半失败（ENOSPC、配额）会留下一个名字合法、内容残缺的文件。它的 mtime
      // 是新的，下一次清理时会排在前面，把一个真正的回滚点挤掉——而它自己根本读不出来。
      try { unlinkSync(snapshotTmpPath(tid, snapshotId)); } catch (e2) { /* best effort */ }
      return res.status(500).json({ error: '还原前备份快照失败' });
    }
  }

  // Force all teacher-scoped records to belong to the authenticated teacher
  const forceOwner = arr => (arr || []).map(r => ({ ...r, teacherId: tid }));

  // Fix legacy createdAt that stored literal "CURRENT_TIMESTAMP"
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const fixTimestamps = arr => (arr || []).map(r => ({
    ...r,
    createdAt: (!r.createdAt || r.createdAt === 'CURRENT_TIMESTAMP') ? now : r.createdAt,
  }));

  const arr = (v) => Array.isArray(v) ? v : [];

  // Strip unexpected fields from each record to prevent injection
  const pick = (record, allowed) => {
    const out = {};
    for (const key of allowed) {
      if (record[key] !== undefined) out[key] = record[key];
    }
    return out;
  };

  const classFields = ['id', 'teacherId', 'name', 'grade', 'subject', 'studentCount', 'unitPrice', 'discountAmount', 'discountReason', 'isCompetition', 'defaultLocationName', 'defaultLocationLat', 'defaultLocationLng', 'deleted', 'createdAt'];
  const studentFields = ['id', 'teacherId', 'name', 'birthDate', 'phone', 'parentName', 'parentPhone', 'note', 'createdAt'];
  const scheduleFields = ['id', 'classId', 'date', 'startTime', 'endTime', 'durationBilling', 'locationName', 'locationLat', 'locationLng', 'createdAt'];
  const semesterFields = ['id', 'teacherId', 'name', 'type', 'startDate', 'endDate', 'createdAt'];
  const holidayFields = ['id', 'teacherId', 'date', 'type', 'name'];
  const pricingTierFields = ['id', 'teacherId', 'minStudents', 'maxStudents', 'pricePerStudentPerHour', 'createdAt'];
  const classPricingFields = ['id', 'classId', 'studentCount', 'unitPrice', 'discountAmount', 'discountReason', 'effectiveFrom', 'createdAt'];
  const classStudentFields = ['classId', 'studentId'];
  const auditLogFields = ['id', 'teacherId', 'timestamp', 'action', 'tableName', 'recordId', 'beforeData', 'afterData'];

  const restoreData = {
    classes: fixTimestamps(forceOwner(arr(data.classes))).map(r => pick(r, classFields)),
    pricingTiers: fixTimestamps(forceOwner(arr(data.pricingTiers))).map(r => pick(r, pricingTierFields)),
    students: fixTimestamps(forceOwner(arr(data.students))).map(r => pick(r, studentFields)),
    classStudents: arr(data.classStudents).map(r => pick(r, classStudentFields)),
    schedules: fixTimestamps(arr(data.schedules)).map(r => pick(r, scheduleFields)),
    holidays: forceOwner(arr(data.holidays)).map(r => pick(r, holidayFields)),
    semesters: fixTimestamps(forceOwner(arr(data.semesters))).map(r => pick(r, semesterFields)),
    classPricing: arr(data.classPricing).map(r => pick(r, classPricingFields)),
    auditLog: forceOwner(arr(data.auditLog)).map(r => pick(r, auditLogFields)),
  };

  // 丢掉的行按表计数随响应返回，不默默吐掉。只管两类原因：引用的班级/学生不在
  // 这份备份里，或者日期越界/非法——这两种行就算写进去也是死数据。
  // 其它残缺列（如 schedules.startTime 缺失）仍会让事务回滚成 500：那是文件坏了，
  // 敲掉一批行悄悄写下去不如整单报错、原数据原封不动。
  const skipped = {};
  const dropRows = (table, keep) => {
    const before = restoreData[table].length;
    restoreData[table] = restoreData[table].filter(keep);
    const dropped = before - restoreData[table].length;
    if (dropped > 0) skipped[table] = (skipped[table] || 0) + dropped;
  };

  // Validate schedule, classStudents, classPricing references point to restored classes.
  // classId 没命中的行必须在这里就剔掉：插入时 classIdMap.get() 给出 undefined，
  // 而三张表的 class_id 都是 notNull 外键，一条孤儿行就能把整个事务回滚成 500。
  const classIds = new Set(restoreData.classes.map(c => c.id));
  const studentIds = new Set(restoreData.students.map(s => s.id));
  dropRows('schedules', s => classIds.has(s.classId));
  dropRows('classStudents', l => classIds.has(l.classId) && studentIds.has(l.studentId));
  dropRows('classPricing', p => classIds.has(p.classId));

  // 备份文件里的日期直接进库，不经过任何 body 校验（pick 只剔未知字段）。
  // 只丢 schedules 和 holidays：这两张表的每一个读取路径都按区间（或年份）查，
  // 0261-01-01 这种行写进去就既看不到也删不掉，是真正的死数据。
  //
  // 但还原自己写的那份快照时不剔：快照是撤销用的，要把库恢复到还原之前。
  // 原来库里就有的越界行也一并剔掉的话，这个「撤销」并没回到原状——恰恰是出了事
  // 才用到它的人最不能接受的。这个标记不是安全边界（调用方自己就能加），
  // 这个标记不是光写个 true 就算：得是服务端写下那份快照的 UUID，而且文件还在。
  //
  // 丢掉而不是整单拒绝：旧版本服务端收过这种值，已经存下的人导出的备份、以及
  // 还原前自动存的 .backup_pre_restore_*.json 快照里都带着这样的行。整单拒的话，
  // 恰恰是需要回滚的人还原不了自己的快照。条数随响应返回，不默默吐掉。
  //
  // semesters 和 classPricing 故意不在此列：GET /api/semesters 和 GET /api/classes/:id/pricing
  // 都不按日期过滤，越界的行在学期管理/定价历史里看得见、改得了、删得掉。
  // classPricing 更不是惰性数据：matchPricing 取 effectiveFrom <= date 的最后一条，
  // 丢掉 0261-01-01 那条会让它之后的排课掉到别的档位，报表收入在一次本应无损的
  // 导出-还原往返后就变了。宁可原样写回去，让用户在界面上自己改。
  // 出生日期可为空、也允许只写年份，而且不参与任何区间查询：只清掉这一个字段，
  // 不因此丢掉整个学生。所以它不能进 skipped：skipped 的每个 key 都是一张表，
  // 都能在 restored 里找到对应的总数，而这里没有任何行被丢。
  const cleared = {};

  // 清字段和丢行一样是静默改数据，而撤销要的是原状，所以两步一并包在快照豁免里。
  if (!restoringOwnSnapshot) {
    // 只丢「写了但写错」的：字段压根没有（列名被改、dump 被截断）是文件坏了，
    // 要的是整单报错、原数据原封不动（date 是 notNull，掉到插入会让事务回滚成 500）。
    // 还原是先清后写的，不分这两种的话，一份掉了 date 列的备份会把人的排课全删光，
    // 然后返回 200。
    // pick() 只拷贝存在的 key，所以 undefined 恰好就是「这一列压根不在文件里」；
    // 显式的 null 是写了但写错，和其它坏值一样丢行。
    dropRows('schedules', r => r.date === undefined || isValidDate(r.date));
    dropRows('holidays', r => r.date === undefined || isValidDate(r.date));

    let clearedBirthDates = 0;
    for (const row of restoreData.students) {
      if (row.birthDate != null && row.birthDate !== '' && !isValidBirthDate(row.birthDate)) {
        row.birthDate = null;
        clearedBirthDates++;
      }
    }
    if (clearedBirthDates > 0) cleared.studentBirthDates = clearedBirthDates;
  }

  const counts = {};

  try {
    db.transaction(() => {
      const existingClassIds = drizzleDb.select({ id: classes.id })
        .from(classes).where(eq(classes.teacherId, tid)).all().map(c => c.id);

      if (existingClassIds.length > 0) {
        drizzleDb.delete(schedules).where(inArray(schedules.classId, existingClassIds)).run();
        drizzleDb.delete(classStudents).where(inArray(classStudents.classId, existingClassIds)).run();
        // class_pricing has an immediate foreign key to classes, so it must be
        // removed before its parent classes.
        drizzleDb.delete(classPricing).where(inArray(classPricing.classId, existingClassIds)).run();
      }
      drizzleDb.delete(classes).where(eq(classes.teacherId, tid)).run();
      drizzleDb.delete(students).where(eq(students.teacherId, tid)).run();
      drizzleDb.delete(pricingTiers).where(eq(pricingTiers.teacherId, tid)).run();
      drizzleDb.delete(semesters).where(eq(semesters.teacherId, tid)).run();
      drizzleDb.delete(holidays).where(eq(holidays.teacherId, tid)).run();
      drizzleDb.delete(auditLog).where(eq(auditLog.teacherId, tid)).run();

      const withoutId = ({ id, ...row }) => row;
      const insertChunks = (table, rows, transform = row => row) => {
        for (let i = 0; i < rows.length; i += RESTORE_CHUNK_SIZE) {
          drizzleDb.insert(table).values(rows.slice(i, i + RESTORE_CHUNK_SIZE).map(transform)).run();
        }
      };
      const insertAndMapIds = (table, rows, transform = withoutId) => {
        const idMap = new Map();
        // SQLite does not guarantee RETURNING row order for a multi-row
        // INSERT. Insert relationship roots individually so lastInsertRowid
        // provides an unambiguous old-ID -> new-ID mapping. The surrounding
        // transaction keeps this efficient; dependent bulk rows remain
        // chunked below.
        for (const row of rows) {
          const result = drizzleDb.insert(table).values(transform(row)).run();
          idMap.set(row.id, Number(result.lastInsertRowid));
        }
        return idMap;
      };

      insertChunks(semesters, restoreData.semesters, withoutId);
      if (restoreData.semesters.length) clearSemesterCache();
      insertChunks(pricingTiers, restoreData.pricingTiers, withoutId);
      const studentIdMap = insertAndMapIds(students, restoreData.students);
      const classIdMap = insertAndMapIds(classes, restoreData.classes);
      insertChunks(classStudents, restoreData.classStudents, row => ({
        classId: classIdMap.get(row.classId),
        studentId: studentIdMap.get(row.studentId),
      }));
      insertChunks(schedules, restoreData.schedules, row => ({
        ...withoutId(row), classId: classIdMap.get(row.classId),
      }));
      insertChunks(classPricing, restoreData.classPricing, row => ({
        ...withoutId(row), classId: classIdMap.get(row.classId),
      }));
      insertChunks(holidays, restoreData.holidays, withoutId);
      // Audit recordId values describe historical records and intentionally
      // remain unchanged; only the audit row's own global ID is regenerated.
      insertChunks(auditLog, restoreData.auditLog, withoutId);

      // skipped 的每个 key 都是一张表，每张都得有对应的 restored 数字，
      // 否则调用方看到 skipped.holidays=3 也不知道是 3/4 还是 3/3000。
      counts.classes = restoreData.classes.length;
      counts.students = restoreData.students.length;
      counts.classStudents = restoreData.classStudents.length;
      counts.schedules = restoreData.schedules.length;
      counts.semesters = restoreData.semesters.length;
      counts.holidays = restoreData.holidays.length;
      counts.classPricing = restoreData.classPricing.length;
      counts.pricingTiers = restoreData.pricingTiers.length;
      counts.auditLog = restoreData.auditLog.length;
    })();
  } catch (err) {
    console.error('Backup restore failed:', err);
    // 事务回滚了，库跟写快照时一模一样：这份快照是多余的。留着的话，拿一份坏备份
    // 重试几次就能把真正的回滚点全挤没，而每一次都没改动过数据。
    // 撤销路径没写过快照，没东西可清。
    if (snapshotId) { try { unlinkSync(snapshotPath(tid, snapshotId)); } catch (e) { /* best effort */ } }
    return res.status(500).json({ error: '还原失败，事务已回滚，原数据保留' });
  }

  // 只在真的改动了数据之后才清理，否则失败的还原也会驱逐回滚点。
  // 事务已经提交了，清理再怎么出错也不能把这次成功的还原报成 500——那会让调用方
  // 以为失败而重发一遍，而且拿不到本次的快照 id（它只在这个响应里出现一次）。
  try {
    prunePreRestoreSnapshots(tid);
  } catch (e) {
    console.error('Snapshot prune failed:', e);
  }

  clearSemesterCache();
  clearReportCache(tid);
  res.json({
    ok: true,
    // 撤销这次还原就是把它当 undoSnapshot POST 回来。不返回的话，调用方
    // 除了去服务器上翻目录根本无从得知这个 id。
    // 撤销自身不写快照，所以那一次不带这个字段——带一个磁盘上根本不存在的 id
    // 回去，调用方拿它再撤销只会得到 404。
    ...(snapshotId && snapshotUndoable ? { preRestoreSnapshot: snapshotId } : {}),
    ...(snapshotId && !snapshotUndoable
      ? { preRestoreSnapshotUnavailable: `还原前快照已写入磁盘，但超过 ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MB，无法通过接口撤销` }
      : {}),
    restored: counts,
    ...(Object.keys(skipped).length > 0 ? { skipped } : {}),
    ...(Object.keys(cleared).length > 0 ? { cleared } : {}),
  });
});

// Keep only the newest pre-restore snapshots; restore is rare, so keeping a
// handful of rollback points is enough and prevents unbounded disk growth.
//
// 按教师分开数：一个实例上可以有多个教师，不分的话别人连着还原几次就能把
// 你的回滚点挤没，而你对此一无所知。
//
// 改名之前写下的快照叫 .backup_pre_restore_<uuid>.json，没有教师段，所以这里不碰它们。
// 它们最多就旧版本留下的那几份（旧上限也是 5），不会再增长；删掉反而会把升级前
// 最后一个回滚点一并扒了。它们的内容仍可以当普通备份 POST 回来还原。
function prunePreRestoreSnapshots(tid) {
  // 一次列目录，两轮都用它；每个 unlink 各自容错，否则一个被外部删掉的文件一抛 ENOENT，
  // 剩下的清理全停了（调用处只会把它记个日志，配额就静静地不再生效）。
  const prefix = `.backup_pre_restore_${tid}_`;
  const all = readdirSync(dbDir);
  const entries = all.filter(f => f.startsWith(prefix));
  const drop = (name) => {
    try { unlinkSync(join(dbDir, name)); } catch (e) { /* best effort */ }
  };

  const files = entries
    .filter(f => f.endsWith('.json'))
    // stat 也在同一个竞态里：文件在列目录和 stat 之间消失的话，抛出去会把整个
    // 清理连同下面的 .tmp 清理一起停掉，而调用处只会记一条日志。
    .map(f => {
      try { return { name: f, mtime: statSync(join(dbDir, f)).mtimeMs }; }
      catch (e) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  for (const { name } of files.slice(MAX_PRE_RESTORE_SNAPSHOTS)) drop(name);

  // 被杀在 rename 之前的话会留下 .tmp：它不计数也不影响回滚，但也没必要淤积。
  // 这一扫不分教师：否则一个以后再也不还原的教师留下的 .tmp 永远没人收。
  //
  // 不分教师就意味着可能删到别人正在写的那一个。同一个进程里 write→rename 是同步的，
  // 中间插不进来；两个进程共用 dbDir 时（对着线上数据目录再起一个实例调试之类）就不一定了，
  // 而删中了的后果是对方的 renameSync 抛 ENOENT、一份好端端的备份被判 500。
  // 只收一小时以前的：正在写的那一个绝不会这么旧，而真正的残留迟一小时收干净没差别。
  const now = Date.now();
  for (const name of all) {
    if (!name.startsWith('.backup_pre_restore_') || !name.endsWith('.json.tmp')) continue;
    try {
      if (now - statSync(join(dbDir, name)).mtimeMs >= TMP_MIN_AGE_MS) drop(name);
    } catch (e) { /* 列目录到 stat 之间文件没了，正是想要的结果 */ }
  }
}

export default router;
