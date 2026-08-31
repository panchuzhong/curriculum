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

// End times may use 24:00-47:59 to spell an explicit next-day clock time.
// Regardless of spelling, a schedule must occupy more than 0 and less than
// 24 hours; otherwise normalizing the hour would silently turn a 25-hour span
// into a 1-hour span.
export function isValidScheduleSpan(startTime, endTime) {
  if (!isValidTime(startTime) || !isValidScheduleEndTime(endTime)) return false;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (eh < 24 && diff <= 0) diff += 24 * 60;
  return diff > 0 && diff < 24 * 60;
}
