// A malformed override used to become NaN, and every comparison against NaN is
// false — the TTL stopped expiring entries and the size cap stopped evicting
// them, both silently. Fall back to the default instead.
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const CACHE_TTL_MS = envNumber('REPORT_CACHE_TTL_MS', 60_000);
const MAX_CACHE_SIZE = envNumber('REPORT_CACHE_MAX_SIZE', 100);
const cache = new Map();

function makeKey({ teacherId, start, end, classId }) {
  return JSON.stringify({ teacherId, start, end, classId: classId || '' });
}

export function getReportCache(params) {
  const key = makeKey(params);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setReportCache(params, value) {
  const key = makeKey(params);
  // Re-inserting an existing key keeps its original position in a Map, which
  // put the most frequently refreshed report at the front of the eviction
  // order. Delete first so a refresh moves it to the back.
  cache.delete(key);
  cache.set(key, { time: Date.now(), value });
  // Evict oldest entry when over the limit
  if (cache.size > MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
}

export function clearReportCache(teacherId) {
  if (teacherId == null) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (JSON.parse(key).teacherId === teacherId) cache.delete(key);
  }
}
