import { HOLIDAYS, WORKDAYS, HOLIDAY_NAMES } from './holidays-data.js';

export function isHoliday(dateStr) {
  const year = dateStr.slice(0, 4);
  const mmDd = dateStr.slice(5);
  const yearHolidays = HOLIDAYS[year] || [];
  return yearHolidays.includes(mmDd);
}

export function isWorkday(dateStr) {
  const year = dateStr.slice(0, 4);
  const mmDd = dateStr.slice(5);
  return (WORKDAYS[year] || []).includes(mmDd);
}

export function getHolidayName(dateStr) {
  const year = dateStr.slice(0, 4);
  const mmDd = dateStr.slice(5);
  // HOLIDAY_NAMES is keyed by month-day alone and mixes the lunar dates of
  // several years, so consulting it for a year the built-in data does not cover
  // would borrow another year's festival — 2027-02-04 reading as 春节 because
  // 2025's Spring Festival fell there. Only name dates this year actually has.
  if (!(HOLIDAYS[year] || []).includes(mmDd)) return '节假日';
  return HOLIDAY_NAMES[mmDd] || '节假日';
}

export function getHolidaysForYear(year) {
  return HOLIDAYS[String(year)] || [];
}
