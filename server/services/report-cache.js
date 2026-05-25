const CACHE_TTL_MS = Number(process.env.REPORT_CACHE_TTL_MS || 60_000);
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
  cache.set(makeKey(params), { time: Date.now(), value });
}

export function clearReportCache(teacherId) {
  if (teacherId == null) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (JSON.parse(key).teacherId === teacherId) cache.delete(key);
  }
}
