// Built-in fallback data (used when DB has no data for a year)
const BUILT_IN_HOLIDAYS = {
  '2025': ['01-01', '01-28', '01-29', '01-30', '01-31', '02-01', '02-02', '02-03', '02-04',
           '04-04', '04-05', '04-06', '05-01', '05-02', '05-03', '05-04', '05-05',
           '05-31', '06-01', '06-02', '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07'],
  '2026': ['01-01', '01-02', '02-16', '02-17', '02-18', '02-19', '02-20', '02-21', '02-22',
           '04-05', '04-06', '04-07', '05-01', '05-02', '05-03', '05-04', '05-05',
           '06-19', '06-20', '06-21', '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07'],
  '2027': ['01-01', '01-02', '02-06', '02-07', '02-08', '02-09', '02-10', '02-11', '02-12',
           '04-05', '04-06', '05-01', '05-02', '05-03', '06-09', '06-10', '06-11',
           '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07'],
};

const BUILT_IN_WORKDAYS = {
  '2025': ['01-26', '02-08', '04-27', '09-28', '10-11'],
  '2026': ['01-24', '02-07', '04-26', '09-27', '10-10'],
  '2027': ['01-23', '04-25', '09-26', '10-09'],
};

const HOLIDAY_NAMES = {
  '01-01': '元旦', '01-02': '元旦',
  '01-28': '春节', '01-29': '春节', '01-30': '春节', '01-31': '春节',
  '02-01': '春节', '02-02': '春节', '02-03': '春节', '02-04': '春节',
  '02-16': '春节', '02-17': '春节', '02-18': '春节', '02-19': '春节',
  '02-20': '春节', '02-21': '春节', '02-22': '春节',
  '02-06': '春节', '02-07': '春节', '02-08': '春节', '02-09': '春节',
  '02-10': '春节', '02-11': '春节', '02-12': '春节',
  '04-04': '清明', '04-05': '清明', '04-06': '清明', '04-07': '清明',
  '05-01': '劳动节', '05-02': '劳动节', '05-03': '劳动节', '05-04': '劳动节', '05-05': '劳动节',
  '05-31': '端午', '06-01': '端午', '06-02': '端午',
  '06-19': '端午', '06-20': '端午', '06-21': '端午',
  '06-09': '端午', '06-10': '端午', '06-11': '端午',
  '10-01': '国庆', '10-02': '国庆', '10-03': '国庆', '10-04': '国庆',
  '10-05': '国庆', '10-06': '国庆', '10-07': '国庆',
};

// Cache for DB holidays
let dbHolidays = null;
let dbLoaded = false;

async function loadDbHolidays() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;
    const res = await fetch('/api/holidays', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      dbHolidays = await res.json();
      dbLoaded = true;
    }
  } catch {}
}

// Initialize on load
loadDbHolidays();

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
  const mmDd = dateStr.slice(5);
  return HOLIDAY_NAMES[mmDd] || '节假日';
}

export function getWorkdayReason(dateStr) {
  if (dbLoaded && dbHolidays) {
    const dbMatch = dbHolidays.find(h => h.date === dateStr && h.type === 'workday');
    if (dbMatch && dbMatch.name) return dbMatch.name;
  }
  return '调休';
}
