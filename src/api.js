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

async function request(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    return;
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const api = {
  // Auth
  login: (data) => request('POST', '/auth/login', data),
  register: (data) => request('POST', '/auth/register', data),
  getProfile: () => request('GET', '/auth/profile'),
  regenerateApiKey: () => request('PUT', '/auth/api-key'),

  // Classes
  getClasses: () => request('GET', '/classes'),
  createClass: (data) => request('POST', '/classes', data),
  updateClass: (id, data) => request('PUT', `/classes/${id}`, data),
  deleteClass: (id) => request('DELETE', `/classes/${id}`),

  // Students
  getStudents: (classId) => request('GET', `/classes/${classId}/students`),
  addStudent: (classId, data) => request('POST', `/classes/${classId}/students`, data),
  deleteStudent: (classId, sid) => request('DELETE', `/classes/${classId}/students/${sid}`),

  // Pricing Tiers
  getPricingTiers: () => request('GET', '/pricing-tiers'),
  createPricingTier: (data) => request('POST', '/pricing-tiers', data),
  updatePricingTier: (id, data) => request('PUT', `/pricing-tiers/${id}`, data),
  deletePricingTier: (id) => request('DELETE', `/pricing-tiers/${id}`),

  // Schedules
  getSchedules: (start, end) => request('GET', `/schedules?start=${start}&end=${end}`),
  createSchedule: (data) => request('POST', '/schedules', data),
  batchSchedules: (data) => request('POST', '/schedules/batch', data),
  updateSchedule: (id, data) => request('PUT', `/schedules/${id}`, data),
  deleteSchedule: (id) => request('DELETE', `/schedules/${id}`),

  // Semesters
  getSemesters: () => request('GET', '/semesters'),
  createSemester: (data) => request('POST', '/semesters', data),
  updateSemester: (id, data) => request('PUT', `/semesters/${id}`, data),
};
