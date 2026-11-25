// isFloat accepts exponent strings that overflow to Infinity, and singleton
// arrays. Keep numeric-string clients working without storing either shape.
export function isFiniteNumber(value) {
  return (typeof value === 'number' || typeof value === 'string')
    && Number.isFinite(Number(value));
}

export function parseExactInt(value, { min, max } = {}) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (min != null && parsed < min) || (max != null && parsed > max)) return null;
  return parsed;
}
