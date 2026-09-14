import { addDays } from './date';

// 班级排课历史打开时的默认日期范围。
// 教师只建春季/秋季两类学期，学期之间的空档就是寒暑假，所以：今天在学期内看整个学期，
// 今天在空档里看整个寒暑假。范围的某一端没有学期兜底时，退到该班第一节/最后一节课。
// extent 为该班全部排课的起止日期（无排课时为 null）。
export function getDefaultScheduleRange(semesters, today, { first, last }) {
  const sorted = [...semesters].sort((a, b) => a.startDate.localeCompare(b.startDate));

  // 含起止日。相邻学期共用边界日时（如秋季 ~01-15 接寒假 01-15~），边界日归先开始的那个。
  const current = sorted.find(s => today >= s.startDate && today <= s.endDate);
  if (current) return { start: current.startDate, end: current.endDate };

  const prev = [...sorted].reverse().find(s => s.endDate < today);
  const next = sorted.find(s => s.startDate > today);
  const start = prev ? addDays(prev.endDate, 1) : (first || today);
  const end = next ? addDays(next.startDate, -1) : (last || today);

  // 两端的兜底互不知情，窗口可能倒挂：开学前只建了新学期时 start 退到新学期的第一节课，
  // 却晚于「下一学期开始日-1」这个 end。倒挂说明这个窗口跟该班的排课压根不相交，
  // 与其显示一个空表加一对前后颠倒的日期，不如退回显示该班全部排课。
  if (start > end) return { start: first || today, end: last || today };
  return { start, end };
}
