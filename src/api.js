export const API_BASE = '/api';

export function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token) {
  localStorage.setItem('token', token);
}

const SCHEDULE_CACHE_TTL_MS = 60_000;
const scheduleCache = new Map();

function clearScheduleCache() {
  scheduleCache.clear();
}

function scheduleCacheKey(start, end, classId) {
  return `${start}|${end}|${classId || ''}`;
}

async function withScheduleInvalidation(promise) {
  const result = await promise;
  clearScheduleCache();
  return result;
}

export function clearToken() {
  localStorage.removeItem('token');
  clearScheduleCache();
}

async function request(method, path, body, { noAuth = false } = {}) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(!noAuth && getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!noAuth && res.status === 401) {
    clearToken();
    window.location.href = `${import.meta.env.BASE_URL}login`;
    throw new Error('登录已过期,请重新登录');
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) message = parsed.error;
      const err = new Error(message);
      if (parsed.crossSemester) err.crossSemester = true;
      throw err;
    } catch (e) {
      if (e.crossSemester) throw e;
      throw new Error(message);
    }
  }
  try { return JSON.parse(text); } catch { return text; }
}

async function requestBlob(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = `${import.meta.env.BASE_URL}login`;
    throw new Error('登录已过期,请重新登录');
  }
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try { const p = JSON.parse(text); message = p.error || message; } catch {}
    throw new Error(message || '请求失败');
  }
  return res.blob();
}

export const api = {
  // Auth
  login: (data) => request('POST', '/auth/login', data, { noAuth: true }),
  register: (data) => request('POST', '/auth/register', data, { noAuth: true }),
  getProfile: () => request('GET', '/auth/profile'),
  regenerateApiKey: () => request('PUT', '/auth/api-key'),
  changePassword: (data) => request('PUT', '/auth/password', data),
  updateSubjects: (subjects) => request('PUT', '/auth/subjects', { subjects }),

  // Classes
  getClasses: () => request('GET', '/classes'),
  createClass: (data) => withScheduleInvalidation(request('POST', '/classes', data)),
  updateClass: (id, data) => withScheduleInvalidation(request('PUT', `/classes/${id}`, data)),
  deleteClass: (id) => withScheduleInvalidation(request('DELETE', `/classes/${id}`)),

  // Students
  getAllStudents: () => request('GET', '/students'),
  getStudentsByClass: (classId) => request('GET', `/students/by-class/${classId}`),
  createStudent: (data) => request('POST', '/students', data),
  updateStudent: (id, data) => request('PUT', `/students/${id}`, data),
  deleteStudent: (id) => request('DELETE', `/students/${id}`),

  // Class-student sub-resources (nested under /api/classes/:classId/students)
  getStudents: (classId) => request('GET', `/classes/${classId}/students`),
  addStudent: (classId, data) => request('POST', `/classes/${classId}/students`, data),
  removeStudentFromClass: (classId, studentId) => request('DELETE', `/classes/${classId}/students/${studentId}`),

  // Class pricing history
  getClassPricing: (classId) => request('GET', `/classes/${classId}/pricing`),
  createClassPricing: (classId, data) => withScheduleInvalidation(request('POST', `/classes/${classId}/pricing`, data)),
  updateClassPricing: (classId, id, data) => withScheduleInvalidation(request('PUT', `/classes/${classId}/pricing/${id}`, data)),
  deleteClassPricing: (classId, id) => withScheduleInvalidation(request('DELETE', `/classes/${classId}/pricing/${id}`)),

  // Pricing Tiers
  getPricingTiers: () => request('GET', '/pricing-tiers'),
  createPricingTier: (data) => request('POST', '/pricing-tiers', data),
  updatePricingTier: (id, data) => request('PUT', `/pricing-tiers/${id}`, data),
  deletePricingTier: (id) => request('DELETE', `/pricing-tiers/${id}`),

  // Schedules
  getSchedules: (start, end, classId) => {
    let url = `/schedules?start=${start}&end=${end}`;
    if (classId) url += `&classId=${classId}`;
    const key = scheduleCacheKey(start, end, classId);
    const cached = scheduleCache.get(key);
    const now = Date.now();
    if (cached && now - cached.time <= SCHEDULE_CACHE_TTL_MS) {
      return cached.promise || Promise.resolve(cached.data);
    }

    const promise = request('GET', url)
      .then(data => {
        scheduleCache.set(key, { data, time: Date.now() });
        return data;
      })
      .catch(err => {
        scheduleCache.delete(key);
        throw err;
      });
    scheduleCache.set(key, { promise, time: now });
    return promise;
  },
  getScheduleSummary: (start, end, classId) => {
    let url = `/schedules/summary?start=${start}&end=${end}`;
    if (classId) url += `&classId=${classId}`;
    return request('GET', url);
  },
  exportScheduleCSV: (start, end, classId) => {
    let url = `/schedules/export?format=csv&start=${start}&end=${end}`;
    if (classId) url += `&classId=${classId}`;
    return requestBlob(url);
  },

  // Image export (blob)
  exportScheduleImage: (start, end) => requestBlob(`/schedule-image?start=${start}&end=${end}`),
  exportMonthlyImage: (year, month, endYear, endMonth) => {
    let url = `/schedule-image/monthly?year=${year}&month=${month}`;
    if (endYear != null && endMonth != null && (endYear !== year || endMonth !== month)) {
      url += `&endYear=${endYear}&endMonth=${endMonth}`;
    }
    return requestBlob(url);
  },
  exportYearlyImage: (year, endYear) => {
    let url = `/schedule-image/yearly?year=${year}`;
    if (endYear != null && endYear !== year) url += `&endYear=${endYear}`;
    return requestBlob(url);
  },
  createSchedule: (data) => withScheduleInvalidation(request('POST', '/schedules', data)),
  batchSchedules: (data) => withScheduleInvalidation(request('POST', '/schedules/batch', data)),
  batchDeleteSchedules: (data) => withScheduleInvalidation(request('DELETE', '/schedules/batch', data)),
  updateSchedule: (id, data) => withScheduleInvalidation(request('PUT', `/schedules/${id}`, data)),
  deleteSchedule: (id) => withScheduleInvalidation(request('DELETE', `/schedules/${id}`)),

  // Semesters
  getSemesters: () => request('GET', '/semesters'),
  createSemester: (data) => request('POST', '/semesters', data),
  updateSemester: (id, data) => request('PUT', `/semesters/${id}`, data),
  deleteSemester: (id) => request('DELETE', `/semesters/${id}`),

  // Holidays
  getHolidays: () => request('GET', '/holidays'),
  getHolidaysByYear: (year) => request('GET', `/holidays/${year}`),
  createHoliday: (data) => request('POST', '/holidays', data),
  updateHoliday: (id, data) => request('PUT', `/holidays/${id}`, data),
  deleteHoliday: (id) => request('DELETE', `/holidays/${id}`),
  batchImportHolidays: (items) => request('POST', '/holidays/batch', { items }),

  // Audit log maintenance
  cleanupAuditLog: (keep) => request('DELETE', `/audit-log/cleanup${keep == null ? '' : `?keep=${keep}`}`),
};
