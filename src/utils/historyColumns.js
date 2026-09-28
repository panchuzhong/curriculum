// 班级「排课历史」表格里可以关掉的几项：日期带不带年份、星期/时长/地点三列显示不显示。
// 默认全开，也就是加这个功能之前的样子。「时间」一列和日期本身始终显示。
export const DEFAULT_HISTORY_COLUMNS = Object.freeze({ year: true, weekday: true, duration: true, location: true });

export const HISTORY_COLUMNS_KEY = 'scheduleHistory.columns';

// localStorage 里读出来的东西不可信：可能是旧版本写的、被手改过的，或者压根不是 JSON。
// 认得的键只收布尔值，其余一律回到默认——宁可多显示一列，也不要因为一个坏值把用户
// 要复制的那一列悄悄藏掉（"false" 这个字符串是真值，0 是假值，照搬都会错）。
export function parseHistoryColumns(raw) {
  const cols = { ...DEFAULT_HISTORY_COLUMNS };
  let saved;
  try { saved = JSON.parse(raw); } catch { return cols; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return cols;
  for (const key of Object.keys(cols)) {
    if (typeof saved[key] === 'boolean') cols[key] = saved[key];
  }
  return cols;
}
