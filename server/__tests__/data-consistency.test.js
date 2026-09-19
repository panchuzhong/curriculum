// Guards against drift between the duplicated holiday/color data maintained
// on the server (export images, batch scheduling) and the frontend (UI).
import { describe, it, expect } from 'vitest';
import { HOLIDAYS, WORKDAYS, HOLIDAY_NAMES } from '../services/holidays-data.js';
import { BUILT_IN_HOLIDAYS, BUILT_IN_WORKDAYS, HOLIDAY_NAMES as FE_HOLIDAY_NAMES } from '../../src/utils/holidays.js';
import { BUILT_IN_HOLIDAYS as SETTINGS_HOLIDAYS } from '../../src/settings/HolidayManager.jsx';
import { GRADES, SUBJECT_HUES, GRADE_LIGHTNESS } from '../../src/utils/constants';
import { getColor, getTextColor, getCategoryColor, SUBJECT_HUES as srvSUBJECT_HUES, GRADE_LIGHTNESS as srvGRADE_LIGHTNESS } from '../services/colors.js';
import { getClassColor, getTextColor as feGetTextColor, getCategoryColor as feGetCategoryColor } from '../../src/utils/colors';
import { isValidDate, isCalendarDate, isValidBirthDate, isValidTime, isValidScheduleEndTime, DATE_MIN as SERVER_DATE_MIN, DATE_MAX as SERVER_DATE_MAX } from '../validations/dates.js';
import { isUsableDate, isCalendarDate as feIsCalendarDate } from '../../src/utils/date.js';
import { DATE_MIN, DATE_MAX } from '../../src/utils/constants.js';
import { MAX_BATCH_DATES as SERVER_MAX_BATCH_DATES } from '../validations/schedules.js';
import { MAX_BATCH_DATES as CLIENT_MAX_BATCH_DATES } from '../../src/schedule/BatchScheduleDialog.jsx';
import { assignColumns as srvAssignColumns, duration as srvDuration, toMin as srvToMin, blockGeometry as srvBlockGeometry } from '../services/schedule-helpers.js';
import { assignColumns as cliAssignColumns, duration as cliDuration, toMin as cliToMin, blockGeometry as cliBlockGeometry } from '../../src/utils/schedule.js';
import { monthDayWindow as srvMonthWindow, monthBarPct as srvMonthBar, MONTH_DAY_START as srvMDS, MONTH_DAY_END as srvMDE } from '../services/schedule-helpers.js';
import { monthDayWindow as cliMonthWindow, monthBarPct as cliMonthBar, MONTH_DAY_START as cliMDS, MONTH_DAY_END as cliMDE } from '../../src/utils/schedule.js';
import { toHoursAbs as srvToHoursAbs } from '../services/image-gen-yearly.js';
import {
  getCategory as srvGetCategory, getGradeLevel as srvGetGradeLevel,
  groupByGrade as srvGroupByGrade, resolveColor as srvResolveColor,
  FALLBACK_COLOR as srvFALLBACK, COLLAPSE_LIMIT as srvCOLLAPSE,
} from '../services/image-gen-yearly.js';
import {
  getCategory as cliGetCategory, getGradeLevel as cliGetGradeLevel,
  groupByGrade as cliGroupByGrade, resolveColor as cliResolveColor,
  FALLBACK_COLOR as cliFALLBACK, COLLAPSE_THRESHOLD_DESKTOP as cliCOLLAPSE,
} from '../../src/schedule/YearlySchedule.jsx';
import { toHoursAbs as cliToHoursAbs, toHours as cliToHours } from '../../src/utils/date.js';
import { detectConflictGroups as srvConflictGroups } from '../services/schedule-helpers.js';
import { findConflictGroups as cliConflictGroups } from '../../src/utils/schedule.js';
import { getMonthDates as srvMonthDates } from '../services/image-gen-monthly.js';
import { getMonthDates as cliMonthDates } from '../../src/schedule/MonthlySchedule.jsx';
import { VALID_GRADES } from '../validations/classes.js';
import { subjectHue as cliSubjectHue } from '../../src/utils/colors.js';

describe('holiday builtin data: server vs frontend', () => {
  it('holiday dates match exactly', () => {
    expect(BUILT_IN_HOLIDAYS).toEqual(HOLIDAYS);
  });

  it('workday dates match exactly', () => {
    expect(BUILT_IN_WORKDAYS).toEqual(WORKDAYS);
  });

  it('holiday names match exactly', () => {
    expect(FE_HOLIDAY_NAMES).toEqual(HOLIDAY_NAMES);
  });
});

describe('holiday import list in Settings matches the builtin dataset', () => {
  it('every imported entry is a known builtin holiday/workday of its year', () => {
    for (const [year, items] of Object.entries(SETTINGS_HOLIDAYS)) {
      for (const { date, type } of items) {
        expect(date.startsWith(`${year}-`)).toBe(true);
        const mmdd = date.slice(5);
        if (type === 'holiday') expect(HOLIDAYS[year]).toContain(mmdd);
        else expect(WORKDAYS[year]).toContain(mmdd);
      }
    }
  });

  it('the import list covers every builtin holiday and workday', () => {
    const imported = new Set(
      Object.values(SETTINGS_HOLIDAYS).flat().map(i => `${i.type}:${i.date}`),
    );
    for (const [year, dates] of Object.entries(HOLIDAYS)) {
      for (const mmdd of dates) expect(imported.has(`holiday:${year}-${mmdd}`)).toBe(true);
    }
    for (const [year, dates] of Object.entries(WORKDAYS)) {
      for (const mmdd of dates) expect(imported.has(`workday:${year}-${mmdd}`)).toBe(true);
    }
  });
});

describe('color functions: server (image export) vs frontend (UI)', () => {
  const subjects = [...Object.keys(SUBJECT_HUES), '编程', '天文', 'unknown-subject'];

  it('getClassColor/getColor agree for every grade x subject x theme', () => {
    for (const grade of GRADES) {
      for (const subject of subjects) {
        for (const dark of [false, true]) {
          const cls = { subject, grade };
          expect(getClassColor(cls, dark)).toBe(getColor(cls, dark));
        }
      }
    }
  });

  // 年级是继承来的键时两边必须给同一个答案。已有用例只把 __proto__/constructor
  // 这类键当作「学科」试过（subjectHue 两边都加固了），年级这一侧从没比过——
  // 而客户端那份当时还在直接 GRADE_LIGHTNESS[grade]，取到函数后算出 NaN。
  it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    '年级为 %s 时两边颜色一致', (grade) => {
      for (const dark of [true, false]) {
        const cls = { grade, subject: '数学' };
        expect(getColor(cls, dark)).toBe(getClassColor(cls, dark));
        expect(getTextColor(cls, dark)).toBe(feGetTextColor(cls, dark));
      }
    });

  it('继承键的年级不会算出 NaN 颜色', () => {
    for (const dark of [true, false]) {
      const c = getClassColor({ grade: 'constructor', subject: '数学' }, dark);
      expect(c).not.toContain('NaN');
      // 和一个根本不存在的年级同等对待（都回落到 50）
      expect(c).toBe(getClassColor({ grade: '不存在的年级', subject: '数学' }, dark));
    }
  });

  it('getTextColor agrees for every grade x theme', () => {
    for (const grade of GRADES) {
      for (const dark of [false, true]) {
        expect(feGetTextColor({ grade }, dark)).toBe(getTextColor({ grade }, dark));
      }
    }
  });

  it('getCategoryColor agrees for grade-level categories', () => {
    const categories = [
      '初中数学', '高中物理', '大学编程',
      '初中竞赛数学', '高中竞赛物理',
    ];
    for (const category of categories) {
      for (const dark of [false, true]) {
        expect(feGetCategoryColor(category, dark)).toBe(getCategoryColor(category, dark));
      }
    }
  });

  // 原来这条拿的是同一份前端常量跟自己比（服务端那两张表当时是模块私有的），
  // 两边同时改错也照样绿——真正拦住漂移的是上面几条"输出相等"。现在服务端
  // 把表导出了，直接比常量本身：出错时指得出是哪个学科/年级，而不是只说颜色不一样。
  it('color constants match (subject hues / grade lightness)', () => {
    expect(srvSUBJECT_HUES).toEqual(SUBJECT_HUES);
    expect(srvGRADE_LIGHTNESS).toEqual(GRADE_LIGHTNESS);
  });

  it('两张表都不是空的', () => {
    expect(Object.keys(SUBJECT_HUES).length).toBeGreaterThan(0);
    expect(Object.keys(GRADE_LIGHTNESS).length).toBeGreaterThan(0);
  });
});

// 前后端各写了一遍日历判断（正则 + new Date() 回溯）和同一对上下限。改一处漏
// 一处会出现「前端放行、服务端 400」，或者更糟的「前端拦住、服务端照收」——
// 后者会落下一行所有区间查询都返回不了的排课。
// 客户端在生成/粘贴日期时先按同一个上限截断，为的是不把几 MB 的数组发出去再被整单打回。
// 那个数是手抄的（BatchScheduleDialog 的注释写着「与服务端保持一致」），没人钉着就会漂：
// 抄小了合法输入被静默截掉，抄大了用户白等一趟往返。
describe('batch date cap: server vs frontend', () => {
  it('批量排课的日期条数上限两边相同', () => {
    expect(CLIENT_MAX_BATCH_DATES).toBe(SERVER_MAX_BATCH_DATES);
  });

  // 上限本身也得是个说得通的数：写成 0 或负数时上面那条照样绿，而批量排课从此一个日期都排不了。
  it('上限是个正数', () => {
    expect(SERVER_MAX_BATCH_DATES).toBeGreaterThan(0);
  });
});

describe('date validation: server vs frontend', () => {
  const CASES = [
    // 上下限之内
    '2026-09-17', '1900-01-01', '2999-12-31', '2024-02-29',
    '2026-02-29', '2026-02-31', '2026-13-01', '2026-00-10', '2026-09-00',
    '2026-9-17', '2026-09', '20261-08-26', '261-08-26',
    // 上下限之外：0261 是年份被原生控件左移的结果，日历上完全合法
    '0261-09-17', '3000-01-01', '1899-12-31', '0002-01-01',
  ];

  it('上下限取值相同', () => {
    expect([SERVER_DATE_MIN, SERVER_DATE_MAX]).toEqual([DATE_MIN, DATE_MAX]);
  });

  it('两侧对每个日期的判断完全一致', () => {
    for (const value of CASES) {
      expect([value, isUsableDate(value)]).toEqual([value, isValidDate(value)]);
    }
  });

  // 不带上下限的那一层也得对齐：前端拿它区分「格式对但越界」和「压根不是日期」，
  // 前者可以夹回范围，后者夹一下就变成了看似正常的 1900-01-01。
  it('isCalendarDate 两侧一致', () => {
    for (const value of [...CASES, '0NaN-NaN-NaN', '2026']) {
      expect([value, feIsCalendarDate(value)]).toEqual([value, isCalendarDate(value)]);
    }
    expect(feIsCalendarDate('0261-09-17')).toBe(true);   // 格式对，只是越界
    expect(feIsCalendarDate('0NaN-NaN-NaN')).toBe(false);
  });

  it('年份被左移成越界值时两侧都拒', () => {
    expect(isValidDate('0261-09-17')).toBe(false);
    expect(isUsableDate('0261-09-17')).toBe(false);
  });

  // 正则会把参数强转成字符串：['2026-05-01'] 能过正则，下一行 .split 就是 TypeError。
  // express-validator 的 .custom() 会把 throw 吃成 400，普通 handler（如还原）则是 500。
  // （数字年份单独看 isValidBirthDate 的用例：那里有意保留了旧接口的兼容）
  it.each([[['2026-05-01']], [20260501], [null], [undefined], [{}]])('非字符串 %s 两侧都返回 false', (value) => {
    expect(isValidDate(value)).toBe(false);
    expect(isUsableDate(value)).toBe(false);
    expect(isValidBirthDate(value)).toBe(false);
  });

  // 时间校验就在隔壁，是一模一样的 regex → .split 形状
  it.each([[['08:00']], [800], [null], [{}]])('时间校验对非字符串 %s 也返回 false 而不抛异常', (value) => {
    expect(isValidTime(value)).toBe(false);
    expect(isValidScheduleEndTime(value)).toBe(false);
  });

  // 出生日期是唯一不卡上下限的日期字段：只用于展示，不参与区间查询；
  // 旧校验放行过任意 4 位年份，卡上下限会让已存的学生记录再也存不下来。
  it('isValidBirthDate 只卡日历，不卡上下限', () => {
    expect(isValidBirthDate('2010')).toBe(true);
    expect(isValidBirthDate('1850')).toBe(true);
    expect(isValidBirthDate('1850-03-02')).toBe(true);
    expect(isValidBirthDate('0261-09-17')).toBe(true);
    // 0-99 年：new Date() 会把它们映射到 19xx，不撤销的话这条学生记录就再也存不下来
    expect(isValidBirthDate('0050-03-01')).toBe(true);
    expect(isValidBirthDate('0001-12-31')).toBe(true);
    expect(isValidBirthDate('0050-02-30')).toBe(false);
    // 年 0 在公历里是闰年，而它映射到的 1900 不是——年月日一次性设完才不会先滑一次
    expect(isValidBirthDate('0000-02-29')).toBe(true);
    expect(isValidBirthDate('0100-02-29')).toBe(false);
    // 日历上不存在 / 格式不对的值照旧拒
    expect(isValidBirthDate('2026-02-31')).toBe(false);
    expect(isValidBirthDate('2026-13-01')).toBe(false);
    expect(isValidBirthDate('20261')).toBe(false);
    // 旧接口靠正则的隐式转换接受过数字年份
    expect(isValidBirthDate(1990)).toBe(true);
    expect(isValidBirthDate(20260501)).toBe(false);
    expect(isValidBirthDate(1990.5)).toBe(false);
  });
});

// 周/月课表的排版函数在两边各有一份逐字相同的实现：网页用 src/utils/schedule.js，
// 导出 PNG 用 server/services/schedule-helpers.js。只有客户端那份有用例，
// 服务端那份的 `ce <= start` 改成 `ce < start` 全套件都不会红——后果是背靠背的两节课
// 不再共用一列，导出图里这一组的每个块都窄了三分之一，跟网页上看到的对不上。
describe('schedule layout: server (image export) vs frontend (UI)', () => {
  const s = (startTime, endTime, id) => ({ id, startTime, endTime });

  const CASES = [
    // 背靠背：前一节 10:00 结束，后一节 10:00 开始，应当共用一列
    [s('09:00', '10:00', 1), s('10:00', '11:00', 2)],
    // 真重叠 + 背靠背混在一起：这一组正好要 2 列
    [s('09:00', '10:00', 1), s('09:30', '11:00', 2), s('10:00', '10:30', 3)],
    // 三节全重叠：3 列
    [s('09:00', '12:00', 1), s('09:30', '12:00', 2), s('10:00', '12:00', 3)],
    // 乱序输入
    [s('14:00', '15:00', 1), s('09:00', '10:00', 2), s('09:30', '10:30', 3)],
    // 跨午夜的结束时间（服务端允许 24:00-47:59）
    [s('23:00', '25:00', 1), s('01:00', '02:00', 2)],
  ];

  it.each(CASES.map((g, i) => [i, g]))('第 %i 组的分列结果两边一致', (_i, group) => {
    const srv = srvAssignColumns(group).map(x => [x.id, x._col]);
    const cli = cliAssignColumns(group).map(x => [x.id, x._col]);
    expect(srv).toEqual(cli);
  });

  it('背靠背的两节课共用一列（两边都是）', () => {
    for (const fn of [srvAssignColumns, cliAssignColumns]) {
      expect(fn(CASES[0]).map(x => x._col)).toEqual([0, 0]);
    }
  });

  it('toMin / duration 两边一致', () => {
    for (const t of ['00:00', '09:30', '23:59', '24:00', '47:59']) {
      expect(srvToMin(t)).toBe(cliToMin(t));
    }
    for (const [a, b] of [['09:00', '10:30'], ['23:00', '25:00'], ['09:00', '09:00']]) {
      expect(srvDuration(a, b)).toBe(cliDuration(a, b));
    }
  });
});

// 年度统计的"分钟转小时"在两边各有一份同名实现：网页用 src/utils/date.js，
// 导出 PNG 用 image-gen-yearly.js。服务端那份曾经没取绝对值，于是同一条负的
// durationBilling 在页面上是 +h、在图里是 −h（条形宽度为负，统计块还可能整个消失）。
// 负值只有还原备份能塞进来（scheduleFields 原样透传 durationBilling），但两边
// 对同一个数字给出不同答案本身就是要消灭的那种"静默不一致"。
describe('yearly hours: server (image export) vs frontend (UI)', () => {
  it.each([null, undefined, 0, 30, 60, 90, 1440, -60, -90, '120'])('%p 两边结果一致', (v) => {
    expect(srvToHoursAbs(v)).toBe(cliToHoursAbs(v));
  });

  it('名字里的 Abs 是当真的：负数取绝对值', () => {
    expect(srvToHoursAbs(-90)).toBe(1.5);
    expect(cliToHoursAbs(-90)).toBe(1.5);
    // 对照：不带 Abs 的那个保留符号
    expect(cliToHours(-90)).toBe(-1.5);
  });
});

// 同一套"把一天里互相重叠的课分组"的逻辑在两边各写了一遍，而且**名字不一样**
// （客户端 findConflictGroups / 服务端 detectConflictGroups），所以按名字搜根本
// 找不到这一对。两边各自有用例，但用例并不相同：客户端测过跨午夜，服务端没测过。
// 网页上画红框和导出 PNG 里画红框靠的是这两份实现，分叉了就是"屏幕上冲突、
// 图里不冲突"，而两张图都说自己是同一份课表。
describe('conflict grouping: server (image export) vs frontend (UI)', () => {
  const s = (startTime, endTime, id) => ({ id, startTime, endTime });
  const shape = (groups) => groups.map(g => g.map(x => x.id));

  const CASES = [
    ['空输入', []],
    ['单节课', [s('09:00', '10:00', 1)]],
    ['背靠背不算冲突', [s('09:00', '10:00', 1), s('10:00', '11:00', 2)]],
    ['真重叠', [s('09:00', '10:30', 1), s('10:00', '11:00', 2)]],
    ['三节连环重叠', [s('09:00', '10:00', 1), s('09:30', '11:00', 2), s('10:30', '12:00', 3)]],
    ['两组互不相干', [s('09:00', '10:00', 1), s('09:30', '10:30', 2), s('14:00', '15:00', 3), s('14:30', '15:30', 4)]],
    ['乱序输入', [s('14:00', '15:00', 1), s('09:00', '10:00', 2), s('09:30', '10:30', 3)]],
    // 客户端有跨午夜的用例，服务端没有——正是这种不对称最容易让两份实现悄悄分叉
    ['跨午夜', [s('23:00', '01:00', 1), s('23:30', '23:45', 2)]],
    ['跨午夜且不重叠', [s('23:00', '23:30', 1), s('23:30', '01:00', 2)]],
    ['零长度', [s('09:00', '09:00', 1), s('09:00', '10:00', 2)]],
  ];

  it.each(CASES)('%s 两边分组一致', (_label, input) => {
    expect(shape(srvConflictGroups(input))).toEqual(shape(cliConflictGroups(input)));
  });

  // 绝对断言：两边一起改错的话，上面那条纯对比是拦不住的。
  it('背靠背分成两组，真重叠合成一组（两边都是）', () => {
    for (const fn of [srvConflictGroups, cliConflictGroups]) {
      expect(shape(fn(CASES[2][1]))).toEqual([[1], [2]]);
      expect(shape(fn(CASES[3][1]))).toEqual([[1, 2]]);
    }
  });
});

// 月历网格在两边各有一份逐字相同的实现（网页日历 / 导出 PNG）。此前只有服务端
// 那份有用例——和 assignColumns 当初分叉的情形正好互为镜像。
describe('month grid: server (image export) vs frontend (UI)', () => {
  it.each([
    [2026, 0], [2026, 1], [2026, 2], [2026, 8], [2027, 7], [2028, 1], [2000, 1], [1900, 0], [2999, 11],
  ])('%i 年第 %i 月的格子两边一致', (y, m) => {
    expect(srvMonthDates(y, m)).toEqual(cliMonthDates(y, m));
  });

  // 绝对断言：两边一起改错的话纯对比拦不住。2026-02-01 是周日，必须排在第 7 列。
  it('周日开头的月份两边都把 1 号放在第 7 列', () => {
    for (const fn of [srvMonthDates, cliMonthDates]) {
      expect(fn(2026, 1).indexOf(1)).toBe(6);
    }
  });
});

// 年级列表两处各写一份：客户端下拉框用 GRADES，服务端用 VALID_GRADES 做 isIn 校验。
// 分叉的后果是单方向的静默失败——界面上选得到、保存时 400（或者反过来，
// 界面选不到但接口收）。VALID_GRADES 原本没导出，所以谁都没法比。
describe('grade list: server validation vs frontend picker', () => {
  it('两边的年级列表完全一致（含顺序）', () => {
    expect(VALID_GRADES).toEqual(GRADES);
  });

  it('不是空的', () => {
    expect(GRADES.length).toBeGreaterThan(0);
  });
});

// 新教师注册时拿到的默认学科来自服务端 DEFAULT_SUBJECTS，而课表配色查的是
// 客户端的 SUBJECT_HUES。某个默认学科在 SUBJECT_HUES 里没有预设色时不会报错，
// 只是那门课改用名字哈希出来的颜色——和其他科目的配色体系对不上，而且
// 服务端导出的 PNG 走的是同一张表，所以两边一样难看，但谁都不会提示。
describe('default subjects all have a preset colour', () => {
  // routes/auth.js 会连带加载 auth 中间件，而它在没有 JWT_SECRET 时会 process.exit，
  // 所以这里先补上再动态导入（本文件不走 route-helpers，拿不到那边设的环境变量）。
  async function defaultSubjects() {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-'.padEnd(40, 'x');
    return (await import('../routes/auth.js')).DEFAULT_SUBJECTS;
  }

  it('每个默认学科都能在 SUBJECT_HUES 里查到', async () => {
    const subs = await defaultSubjects();
    const missing = subs.filter(s => !Object.hasOwn(SUBJECT_HUES, s));
    expect(missing).toEqual([]);
  });

  it('默认学科列表不是空的', async () => {
    expect((await defaultSubjects()).length).toBeGreaterThan(0);
  });
});

// 自定义学科（预设 9 门之外）必须走哈希兜底拿到一个自己的色相，而不是塌成灰色。
// 报表的「按学科统计」曾经自己查了一遍 SUBJECT_HUES，查不到就用 {h:0,s:0}——
// 于是老师加的编程/美术/奥数在那张图上全是同一个灰，彼此分不开，也和课表方块、
// 设置页色块、导出 PNG 的颜色对不上（那三处都走 subjectHue）。
describe('custom subjects still get a distinct colour', () => {
  const CUSTOM = ['编程', '美术', '奥数', '书法'];

  it('预设学科用预设色相', () => {
    expect(cliSubjectHue('数学')).toEqual(SUBJECT_HUES['数学']);
  });

  it.each(CUSTOM)('%s 不是灰色（s 不为 0）', (subject) => {
    const hue = cliSubjectHue(subject);
    expect(hue.s).toBeGreaterThan(0);
    expect(Number.isFinite(hue.h)).toBe(true);
  });

  it('不同的自定义学科彼此颜色不同', () => {
    const hues = CUSTOM.map(s => `${cliSubjectHue(s).h}|${cliSubjectHue(s).s}`);
    expect(new Set(hues).size).toBe(CUSTOM.length);
  });

  // 和服务端导出 PNG 用的那份保持一致（服务端没有单独导出 subjectHue，
  // 但 getColor 内部走的就是它，所以比整块颜色即可）。
  it.each([...CUSTOM, '数学', '物理'])('%s 的班级配色两边一致', (subject) => {
    for (const dark of [true, false]) {
      const cls = { grade: '高一', subject };
      expect(getClassColor(cls, dark)).toBe(getColor(cls, dark));
    }
  });
});

// 网页上的课程块（ScheduleBlock.jsx）和导出 PNG 里的课程块（image-gen.js）
// 必须对同一节课给出同一个位置和高度。两边各抄一份公式的时候，PNG 那份漏了
// duration() 的 s === e 分支，08:00~08:00 在网页上是一行高、在图里却覆盖整天。
describe('schedule block geometry: server (image export) vs frontend (UI)', () => {
  const OPTS = { rowHeight: 40, topGapHeight: 40 * 5 / 60, firstLabelMin: 8 * 60 };

  const cases = [
    ['普通两小时', '09:00', '11:00'],
    ['半小时', '09:00', '09:30'],
    ['贴着首行', '08:00', '09:00'],
    // 起止相同：只有还原备份塞得进来，但两边必须一致——这正是当初分叉的那一个。
    ['起止相同', '08:00', '08:00'],
    // 跨零点：duration 补 24 小时，不是负数。
    ['跨零点', '23:00', '01:00'],
    ['比一行还短', '09:00', '09:05'],
  ];

  it.each(cases)('%s（%s~%s）两边算出同一个块', (_label, start, end) => {
    expect(srvBlockGeometry(start, end, OPTS)).toEqual(cliBlockGeometry(start, end, OPTS));
  });

  it('起止相同的课不是整天高，而是退到一行高', () => {
    const same = srvBlockGeometry('08:00', '08:00', OPTS);
    const allDay = srvBlockGeometry('08:00', '07:59', OPTS);
    expect(same.height).toBe(OPTS.rowHeight - 1);
    expect(allDay.height).toBeGreaterThan(OPTS.rowHeight * 20);
  });

  it('高度不低于一行，否则 0 时长的块看不见也点不到', () => {
    for (const [, start, end] of cases) {
      expect(srvBlockGeometry(start, end, OPTS).height).toBeGreaterThanOrEqual(OPTS.rowHeight - 1);
    }
  });

  it('起始时间越晚，块的位置越靠下', () => {
    const early = srvBlockGeometry('09:00', '10:00', OPTS).top;
    const late = srvBlockGeometry('10:00', '11:00', OPTS).top;
    expect(late - early).toBeCloseTo(OPTS.rowHeight, 9);
  });
});

// 年度视图的分类/分组/配色在网页（YearlySchedule.jsx）和导出的年度 PNG
// （image-gen-yearly.js）里是抄了两份的同名函数。两份都没导出过，
// data-consistency 比不了，于是第 27 轮里 6 个改动（竞赛前缀、分组取最小、
// 折叠上限、颜色兜底）全都活着——两边可以对同一年给出不同的分类和颜色，
// 而且都自称是同一年。
describe('yearly categories & colors: server (image export) vs frontend (UI)', () => {
  const classes = [
    { subject: '数学', grade: '高三', isCompetition: false },
    { subject: '数学', grade: '高三', isCompetition: true },
    { subject: '物理', grade: '初二', isCompetition: true },
    { subject: '物理', grade: '初二', isCompetition: false },
    { subject: '英语', grade: '大学', isCompetition: false },
    { subject: '语文', grade: '', isCompetition: false },
    { subject: '', grade: '高一', isCompetition: false },
    null,
  ];

  it('getCategory 两边一致', () => {
    for (const c of classes) expect(srvGetCategory(c)).toBe(cliGetCategory(c));
  });

  it('竞赛班不和普通班合成一类', () => {
    expect(srvGetCategory({ subject: '数学', grade: '高三', isCompetition: true })).toBe('高中竞赛数学');
    expect(srvGetCategory({ subject: '数学', grade: '高三', isCompetition: false })).toBe('高中数学');
  });

  it('getGradeLevel 两边一致，且竞赛单独成级', () => {
    const cats = classes.map(c => srvGetCategory(c)).concat(['其它科目', '大学物理', '初中竞赛语文']);
    for (const cat of cats) expect(srvGetGradeLevel(cat)).toBe(cliGetGradeLevel(cat));
    expect(srvGetGradeLevel('高中竞赛数学')).toBe('高中竞赛');
    expect(srvGetGradeLevel('高中数学')).toBe('高中');
    expect(srvGetGradeLevel('三年级手工')).toBe('其他');
  });

  it('groupByGrade 两边一致', () => {
    const entries = [['高中数学', 10], ['高中物理', 25], ['高中竞赛数学', 4], ['初中英语', 7], ['手工', 1]];
    expect(srvGroupByGrade(entries)).toEqual(cliGroupByGrade(entries));
  });

  // 课时相同时也必须两边一致。> 改成 >= 的话，同级别里两个课时相等的类别
  // （初中数学 4h / 初中物理 4h，很常见）会选出不同的代表，年度视图和导出的
  // 年度图给出不同的条形颜色——而互比测试的用例里没有平局，照样全绿。
  it('课时打平时，代表类别取先出现的那个，两边一致', () => {
    const tie = [['初中数学', 4], ['初中物理', 4]];
    expect(srvGroupByGrade(tie)).toEqual(cliGroupByGrade(tie));
    expect(srvGroupByGrade(tie)[0][2]).toBe('初中数学');
    // 反过来给一遍，确认取的是"先出现"而不是别的什么。
    const reversed = [['初中物理', 4], ['初中数学', 4]];
    expect(srvGroupByGrade(reversed)[0][2]).toBe('初中物理');
    expect(srvGroupByGrade(reversed)).toEqual(cliGroupByGrade(reversed));
  });

  it('分组的代表类别取课时最多的那个，不是最少的', () => {
    const [level, hours, dominant] = srvGroupByGrade([['高中数学', 10], ['高中物理', 25]])[0];
    expect(level).toBe('高中');
    expect(hours).toBe(35);
    expect(dominant).toBe('高中物理');
  });

  it('分组按课时从多到少排', () => {
    const got = srvGroupByGrade([['初中英语', 7], ['高中物理', 25], ['手工', 1]]);
    expect(got.map(g => g[1])).toEqual([25, 7, 1]);
  });

  it('resolveColor 两边一致，并按 label → 代表类别 → 兜底的顺序退', () => {
    for (const dark of [false, true]) {
      for (const [label, dom] of [['高中数学', '高中数学'], ['高中', '高中物理'], ['其他', '手工'], ['其他', '其他']]) {
        expect(srvResolveColor(label, dom, dark)).toBe(cliResolveColor(label, dom, dark));
      }
      // 折叠后的标签就是光秃秃的年级（'高中'），getCategoryColor 对它返回 null——
      // 这正是兜底存在的原因：颜色得从该组课时最多的类别上借。
      expect(srvResolveColor('高中', '高中物理', dark)).toBe(srvResolveColor('高中物理', '高中物理', dark));
      // 两级都借不到才是灰色。
      expect(srvResolveColor('高中', '初中竞赛', dark)).toBe(srvFALLBACK);
    }
  });

  it('兜底颜色和折叠上限两边一致', () => {
    expect(srvFALLBACK).toBe(cliFALLBACK);
    expect(srvCOLLAPSE).toBe(cliCOLLAPSE);
  });
});

// 月历的时间窗和条形位置原来在网页和出图两边各抄一份，两份里又各抄了一遍时长公式，
// 于是 08:00~08:00 在两边都画成覆盖整天的一条，还把当天的时间窗撑到 32 点。
// 现在只剩一份实现，这里把它钉住——包括绝对值，否则两边一起改照样全绿。
describe('month bar geometry: server (image export) vs frontend (UI)', () => {
  const S = t => ({ startTime: t[0], endTime: t[1] });
  const days = [
    [['09:00', '10:00']],
    [['09:00', '10:00'], ['13:00', '15:00']],
    [['07:00', '08:00']],                 // 早于默认窗口
    [['22:00', '23:30']],                 // 晚于默认窗口
    [['23:00', '01:00']],                 // 跨零点
    [['08:00', '08:00']],                 // 0 时长
    [['08:00', '08:00'], ['09:00', '11:00']],
  ];

  it.each(days.map((d, i) => [i, d]))('第 %i 组：两边算出同一个时间窗', (_i, day) => {
    const scheds = day.map(S);
    expect(srvMonthWindow(scheds)).toEqual(cliMonthWindow(scheds));
  });

  it.each(days.map((d, i) => [i, d]))('第 %i 组：两边算出同一个条形', (_i, day) => {
    const scheds = day.map(S);
    const win = srvMonthWindow(scheds);
    for (const s of scheds) {
      expect(srvMonthBar(s.startTime, s.endTime, win)).toEqual(cliMonthBar(s.startTime, s.endTime, win));
    }
  });

  it('默认窗口是 08:00~22:30，两边一致', () => {
    expect(srvMDS).toBe(8 * 60);
    expect(srvMDE).toBe(22 * 60 + 30);
    expect(cliMDS).toBe(srvMDS);
    expect(cliMDE).toBe(srvMDE);
    expect(srvMonthWindow([S(['09:00', '10:00'])])).toEqual({ dayStart: 480, dayEnd: 1350, dayTotal: 870 });
  });

  it('0 时长的课不撑开时间窗', () => {
    expect(srvMonthWindow([S(['08:00', '08:00'])]).dayEnd).toBe(srvMDE);
    // 旧公式会把它算成上到次日 08:00（1920 分），窗口被拉到 32 点。
    expect(srvMonthWindow([S(['08:00', '08:00'])]).dayTotal).toBe(870);
  });

  it('早于/晚于默认窗口的课把窗口撑到自己', () => {
    expect(srvMonthWindow([S(['07:00', '08:00'])]).dayStart).toBe(7 * 60);
    expect(srvMonthWindow([S(['22:00', '23:30'])]).dayEnd).toBe(23 * 60 + 30);
    // 撑开只朝一个方向：早课不改 dayEnd，晚课不改 dayStart。
    expect(srvMonthWindow([S(['07:00', '08:00'])]).dayEnd).toBe(srvMDE);
    expect(srvMonthWindow([S(['22:00', '23:30'])]).dayStart).toBe(srvMDS);
  });

  it('条形的绝对百分比', () => {
    const win = { dayStart: 480, dayTotal: 870 };
    expect(srvMonthBar('09:00', '10:00', win)).toEqual({
      topPct: 60 / 870 * 100, heightPct: 60 / 870 * 100, isEarly: false, isLate: false,
    });
    // 贴着窗口起点的课 topPct 必须是 0，不是别的什么。
    expect(srvMonthBar('08:00', '09:00', win).topPct).toBe(0);
  });

  it('越出默认窗口的课带上早/晚标记', () => {
    const win = { dayStart: 420, dayTotal: 990 };
    expect(srvMonthBar('07:00', '08:00', win).isEarly).toBe(true);
    expect(srvMonthBar('09:00', '10:00', win).isEarly).toBe(false);
    expect(srvMonthBar('22:00', '23:30', { dayStart: 480, dayTotal: 930 }).isLate).toBe(true);
    expect(srvMonthBar('09:00', '10:00', win).isLate).toBe(false);
    // 0 时长的课不该被当成"上到第二天"而误标成晚课。
    expect(srvMonthBar('08:00', '08:00', { dayStart: 480, dayTotal: 870 }).isLate).toBe(false);
  });
});
