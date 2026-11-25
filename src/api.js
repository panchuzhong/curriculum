export const API_BASE = '/api';

// Trailing-slash-safe absolute path to the login page, honoring subpath deployments (BASE_URL may lack a trailing slash).
export function loginUrl() {
  return import.meta.env.BASE_URL.replace(/\/?$/, '/') + 'login';
}

export function getToken() {
  return localStorage.getItem('token');
}

// 令牌的「账号身份」：PrivateRoute 用它决定要不要重挂整棵私有页面树。
// 只比较 teacherId，不比较令牌字符串——改密码会换发新令牌（pwdVersion 递增），
// 那还是同一个人，重挂会把设置页和「密码修改成功」的提示一起冲掉；
// 跨标签页换成另一个账号时 teacherId 不同，才需要丢掉旧账号的全部界面状态。
// 解析不了（本地手写的坏 token、旧格式的 token）就退回用整串当身份，
// 宁可多挂一次，也不能让串号的状态留着。
export function getTokenIdentity(token) {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (payload) {
    try {
      const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      if (claims.teacherId != null) return `teacher:${claims.teacherId}`;
    } catch { /* fall through to the raw token */ }
  }
  return `raw:${token}`;
}

export function setToken(token) {
  clearScheduleCache();
  localStorage.setItem('token', token);
  window.dispatchEvent?.(new Event('token-changed'));
}

const SCHEDULE_CACHE_TTL_MS = 60_000;
const MAX_CACHE_SIZE = 50;
const scheduleCache = new Map();

function evictExpiredEntries() {
  const now = Date.now();
  for (const [k, v] of scheduleCache) {
    if (now - v.time > SCHEDULE_CACHE_TTL_MS) scheduleCache.delete(k);
  }
  while (scheduleCache.size > MAX_CACHE_SIZE) {
    const oldestKey = scheduleCache.keys().next().value;
    if (oldestKey !== undefined) scheduleCache.delete(oldestKey);
  }
}

function clearScheduleCache() {
  scheduleCache.clear();
}

// Another tab changing accounts also discards this tab's cached rows.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'token' || e.key === null) clearScheduleCache();
  });
}

function scheduleCacheKey(start, end, classId) {
  // localStorage changes before the storage event reaches this tab.
  return `${getToken() || ''}|${start}|${end}|${classId || ''}`;
}

async function withScheduleInvalidation(promise) {
  const result = await promise;
  clearScheduleCache();
  return result;
}

export function clearToken() {
  localStorage.removeItem('token');
  clearScheduleCache();
  window.dispatchEvent?.(new Event('token-changed'));
}

async function request(method, path, body, { noAuth = false } = {}) {
  const token = noAuth ? null : getToken();
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!noAuth && res.status === 401) {
    // A password change or another tab may already have installed a new token.
    if (getToken() === token) {
      clearToken();
      window.location.href = loginUrl();
    }
    throw new Error('登录已过期,请重新登录');
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    let crossSemester = false;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) message = parsed.error;
      crossSemester = !!parsed.crossSemester;
    } catch {}
    const err = new Error(message);
    if (crossSemester) err.crossSemester = true;
    throw err;
  }
  try { return JSON.parse(text); } catch { return text; }
}

async function requestBlob(path) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    if (getToken() === token) {
      clearToken();
      window.location.href = loginUrl();
    }
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
  changePassword: async (data) => {
    const token = getToken();
    const result = await request('PUT', '/auth/password', data);
    if (result?.token && token && getToken() === token) setToken(result.token);
    return result;
  },
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
        // The entry may have expired, been evicted, or been replaced after a write.
        if (scheduleCache.get(key)?.promise === promise) scheduleCache.set(key, { data, time: Date.now() });
        return data;
      })
      .catch(err => {
        if (scheduleCache.get(key)?.promise === promise) scheduleCache.delete(key);
        throw err;
      });
    scheduleCache.set(key, { promise, time: now });
    evictExpiredEntries();
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
  geocode: (address) => request('GET', `/geocode?address=${encodeURIComponent(address)}`),
  geocodeStatus: () => request('GET', '/geocode/status'),

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
