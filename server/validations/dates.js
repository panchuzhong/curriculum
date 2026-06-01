export function isValidDate(val) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const [y, m, d] = val.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function isValidTime(val) {
  if (!/^\d{2}:\d{2}$/.test(val)) return false;
  const [h, m] = val.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function isValidScheduleEndTime(val) {
  if (!/^\d{2}:\d{2}$/.test(val)) return false;
  const [h, m] = val.split(':').map(Number);
  return h >= 0 && h <= 47 && m >= 0 && m <= 59;
}

export function normalizeScheduleEndTime(val) {
  const [h, m] = val.split(':').map(Number);
  return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
