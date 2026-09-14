import { HOLIDAYS, WORKDAYS, HOLIDAY_NAMES } from './holidays-data.js';

// Own-property lookups: a non-digit year key can hit inherited members
// (e.g. "constructor"), whose .includes is not our array and throws.
function yearEntry(map, year) {
  return Object.hasOwn(map, year) ? map[year] : [];
}

export function isHoliday(dateStr) {
  const year = dateStr.slice(0, 4);
  const mmDd = dateStr.slice(5);
  return yearEntry(HOLIDAYS, year).includes(mmDd);
}

export function isWorkday(dateStr) {
  const year = dateStr.slice(0, 4);
  const mmDd = dateStr.slice(5);
  return yearEntry(WORKDAYS, year).includes(mmDd);
}

export function getHolidayName(dateStr) {
  const year = dateStr.slice(0, 4);
  const mmDd = dateStr.slice(5);
  // HOLIDAY_NAMES is keyed by month-day alone and mixes the lunar dates of
  // several years, so consulting it for a year the built-in data does not cover
  // would borrow another year's festival — 2027-02-04 reading as 春节 because
  // 2025's Spring Festival fell there. Only name dates this year actually has.
  if (!yearEntry(HOLIDAYS, year).includes(mmDd)) return '节假日';
  return Object.hasOwn(HOLIDAY_NAMES, mmDd) ? HOLIDAY_NAMES[mmDd] : '节假日';
}

export function getHolidaysForYear(year) {
  return yearEntry(HOLIDAYS, String(year));
}
