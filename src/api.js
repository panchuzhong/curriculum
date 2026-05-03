const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token) {
  localStorage.setItem('token', token);
}

export function clearToken() {
  localStorage.removeItem('token');
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
    window.location.href = '/login';
    return;
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) message = parsed.error;
    } catch {}
    throw new Error(message);
  }
  try { return JSON.parse(text); } catch { return text; }
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
  createClass: (data) => request('POST', '/classes', data),
  updateClass: (id, data) => request('PUT', `/classes/${id}`, data),
  deleteClass: (id) => request('DELETE', `/classes/${id}`),

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

  // Pricing Tiers
  getPricingTiers: () => request('GET', '/pricing-tiers'),
  createPricingTier: (data) => request('POST', '/pricing-tiers', data),
  updatePricingTier: (id, data) => request('PUT', `/pricing-tiers/${id}`, data),
  deletePricingTier: (id) => request('DELETE', `/pricing-tiers/${id}`),

  // Schedules
  getSchedules: (start, end) => request('GET', `/schedules?start=${start}&end=${end}`),
  createSchedule: (data) => request('POST', '/schedules', data),
  batchSchedules: (data) => request('POST', '/schedules/batch', data),
  batchDeleteSchedules: (data) => request('DELETE', '/schedules/batch', data),
  updateSchedule: (id, data) => request('PUT', `/schedules/${id}`, data),
  deleteSchedule: (id) => request('DELETE', `/schedules/${id}`),

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
};
