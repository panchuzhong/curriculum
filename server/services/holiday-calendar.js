import {
  isHoliday as isBuiltinHoliday,
  isWorkday as isBuiltinWorkday,
  getHolidayName as builtinHolidayName,
  getHolidaysForYear,
} from './holidays.js';

// 某位教师的节假日日历：库里的节假日/调休记录 + 内置的法定假数据。
// 批量排课靠它决定跳不跳，周/月课表导出图靠它决定标不标——这条规则此前在
// routes/schedules.js 和 services/image-helpers.js 各写了一遍，只能有这一份。
// 前端 src/utils/holidays.js 在浏览器里另有一份（跨不过客户端/服务端的边界），
// 两边由 src/utils/__tests__/holidays.test.js 逐条对拍。
//
//   · 库里的记录说了算：某一年只要有一条记录（节假日或调休都算），内置数据对这
//     一年整体作废——老师删掉某个法定假，就是那天要上课。
//   · 标签各自独立：同一天既有节假日又有调休记录时（节假日接口按日期去重，但还原
//     备份不去重，这种数据进得来），两个标签都给，和前端一致。
//   · 「跳不跳」= 是节假日且不是调休日。调休优先：宁可多排一节让老师自己删，
//     也不要静默少排。
//
// 内置数据经由 import 取用而不是写在这里，所以测试 mock 掉 ./holidays.js 时，
// 这里的规则照旧是真代码、只有底下的数据是假的。只收行、不碰数据库：导出图的
// 生成器单独导入时不能顺带把库打开（见 image-import-isolation.test.js）。
export function buildHolidayCalendar(rows) {
  const holidayNames = new Map();
  const workdays = new Set();
  for (const h of rows) {
    // 同一天两条节假日记录（还原不去重）取第一条的名字，和前端的 find 一致。
    if (h.type === 'holiday') { if (!holidayNames.has(h.date)) holidayNames.set(h.date, h.name || ''); }
    else if (h.type === 'workday') workdays.add(h.date);
  }
  const yearsWithRows = new Set(rows.map(h => h.date.slice(0, 4)));
  const yearsWithHolidayRows = new Set([...holidayNames.keys()].map(d => d.slice(0, 4)));
  const builtinApplies = (date) => !yearsWithRows.has(date.slice(0, 4));

  const isHoliday = (date) => holidayNames.has(date) || (builtinApplies(date) && isBuiltinHoliday(date));
  const isWorkday = (date) => workdays.has(date) || (builtinApplies(date) && isBuiltinWorkday(date));

  return {
    isHoliday,
    isWorkday,
    // 库里没起名字时退回内置的名字（内置的那份已按年份把关，没有就是「节假日」）。
    holidayName: (date) => holidayNames.get(date) || builtinHolidayName(date),
    isOffDay: (date) => isHoliday(date) && !isWorkday(date),
    // 实际生效的节假日是空的年份：isHoliday 对它们一律说「不是」，但那不是判断出来的，
    // 是没有依据，调用方得把这个缺口报出来。看的是「生效的节假日有没有」而不是「有没有
    // 记录」：一年里只录了一条调休，内置数据就整年作废，库里又没有节假日——这一年实际
    // 一天假都没有，批量排课会照样排进春节。
    uncoveredYears: (dates) => [...new Set(dates.map(d => d.slice(0, 4)))]
      .filter(y => (yearsWithRows.has(y) ? !yearsWithHolidayRows.has(y) : getHolidaysForYear(y).length === 0))
      .sort(),
  };
}
