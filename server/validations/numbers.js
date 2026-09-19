// isFloat accepts exponent strings that overflow to Infinity, and singleton
// arrays. Keep numeric-string clients working without storing either shape.
export function isFiniteNumber(value) {
  return (typeof value === 'number' || typeof value === 'string')
    && Number.isFinite(Number(value));
}
