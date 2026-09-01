import { api, getToken } from '../api.js';

// Built-in fallback data (used when DB has no data for a year)
export const BUILT_IN_HOLIDAYS = {
  '2025': ['01-01', '01-28', '01-29', '01-30', '01-31', '02-01', '02-02', '02-03', '02-04',
           '04-04', '04-05', '04-06', '05-01', '05-02', '05-03', '05-04', '05-05',
           '05-31', '06-01', '06-02', '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07', '10-08'],
  '2026': ['01-01', '01-02', '01-03',
           '02-15', '02-16', '02-17', '02-18', '02-19', '02-20', '02-21', '02-22', '02-23',
           '04-04', '04-05', '04-06', '05-01', '05-02', '05-03', '05-04', '05-05',
           '06-19', '06-20', '06-21', '09-25', '09-26', '09-27',
           '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07'],
};

export const BUILT_IN_WORKDAYS = {
  '2025': ['01-26', '02-08', '04-27', '09-28', '10-11'],
  '2026': ['01-04', '02-14', '02-28', '05-09', '09-20', '10-10'],
};

export const HOLIDAY_NAMES = {
  '01-01': '元旦', '01-02': '元旦', '01-03': '元旦',
  '01-28': '春节', '01-29': '春节', '01-30': '春节', '01-31': '春节',
  '02-01': '春节', '02-02': '春节', '02-03': '春节', '02-04': '春节',
  '02-15': '春节', '02-16': '春节', '02-17': '春节', '02-18': '春节', '02-19': '春节',
  '02-20': '春节', '02-21': '春节', '02-22': '春节', '02-23': '春节',
  '04-04': '清明', '04-05': '清明', '04-06': '清明',
  '05-01': '劳动节', '05-02': '劳动节', '05-03': '劳动节', '05-04': '劳动节', '05-05': '劳动节',
  '05-31': '端午', '06-01': '端午', '06-02': '端午',
  '06-19': '端午', '06-20': '端午', '06-21': '端午',
  '09-25': '中秋', '09-26': '中秋', '09-27': '中秋',
  '10-01': '国庆', '10-02': '国庆', '10-03': '国庆', '10-04': '国庆',
  '10-05': '国庆', '10-06': '国庆', '10-07': '国庆', '10-08': '国庆',
};

// Cache for DB holidays
let dbHolidays = null;
let dbLoaded = false;

const listeners = new Set();

export function subscribeHolidays(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners() {
  for (const fn of listeners) fn();
}

async function loadDbHolidays() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  const token = getToken();
  try {
    if (!token) return;
    const holidays = await api.getHolidays();
    // Ignore a response belonging to a user who has since logged out or been
    // replaced by another session.
    if (getToken() !== token) return;
    dbHolidays = holidays;
    dbLoaded = true;
    notifyListeners();
  } catch {}
}

if (typeof window !== 'undefined') {
  // Initialize on load in browser environments only. This module is also
  // imported by server-side data-consistency tests where localStorage does not
  // exist.
  loadDbHolidays();
  window.addEventListener('token-changed', () => {
    dbHolidays = null;
    dbLoaded = false;
    notifyListeners();
    loadDbHolidays();
  });
}

// Call this after importing/updating holidays to refresh the cache
export function refreshHolidays() {
  dbLoaded = false;
  loadDbHolidays();
}

export function isHoliday(dateStr) {
  const year = dateStr.slice(0, 4);
  const mmDd = dateStr.slice(5);

  // Check DB first
  if (dbLoaded && dbHolidays) {
    const dbMatch = dbHolidays.find(h => h.date === dateStr && h.type === 'holiday');
    if (dbMatch) return true;
    // If DB has data for this year, don't use built-in
    const hasDbData = dbHolidays.some(h => h.date.startsWith(year));
    if (hasDbData) return false;
  }

  // Fall back to built-in
  return (BUILT_IN_HOLIDAYS[year] || []).includes(mmDd);
}

export function isWorkday(dateStr) {
  const year = dateStr.slice(0, 4);
  const mmDd = dateStr.slice(5);

  if (dbLoaded && dbHolidays) {
    const dbMatch = dbHolidays.find(h => h.date === dateStr && h.type === 'workday');
    if (dbMatch) return true;
    const hasDbData = dbHolidays.some(h => h.date.startsWith(year));
    if (hasDbData) return false;
  }

  return (BUILT_IN_WORKDAYS[year] || []).includes(mmDd);
}

export function getHolidayName(dateStr) {
  if (dbLoaded && dbHolidays) {
    const dbMatch = dbHolidays.find(h => h.date === dateStr && h.type === 'holiday');
    if (dbMatch && dbMatch.name) return dbMatch.name;
  }
  const year = dateStr.slice(0, 4);
  const mmDd = dateStr.slice(5);
  // Mirrors the server: HOLIDAY_NAMES is month-day keyed and mixes years, so a
  // year without built-in data must not borrow another year's festival name.
  if (!(BUILT_IN_HOLIDAYS[year] || []).includes(mmDd)) return '节假日';
  return HOLIDAY_NAMES[mmDd] || '节假日';
}

export function getWorkdayReason(dateStr) {
  if (dbLoaded && dbHolidays) {
    const dbMatch = dbHolidays.find(h => h.date === dateStr && h.type === 'workday');
    if (dbMatch && dbMatch.name) return dbMatch.name;
  }
  return '调休';
}
