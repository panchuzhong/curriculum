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
  const mmDd = dateStr.slice(5);
  return HOLIDAY_NAMES[mmDd] || '节假日';
}

export function getHolidaysForYear(year) {
  return HOLIDAYS[String(year)] || [];
}
