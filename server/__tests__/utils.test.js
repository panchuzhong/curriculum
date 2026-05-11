import { describe, it, expect } from 'vitest';

// Inline the date utils for unit testing (same logic as src/utils/date.js)
function toHoursAbs(durationBilling) {
  if (durationBilling == null) return 0;
  return Math.abs(durationBilling) / 60;
}

function toHours(durationBilling) {
  return durationBilling / 60;
}

// Inline CSV escaping (same as useScheduleExport.js)
function escapeCSV(value) {
  const str = String(value);
  const safe = /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

describe('toHoursAbs', () => {
  it('returns 0 for null', () => {
    expect(toHoursAbs(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(toHoursAbs(undefined)).toBe(0);
  });

  it('converts positive minutes to hours', () => {
    expect(toHoursAbs(120)).toBe(2);
  });

  it('converts negative minutes to positive hours', () => {
    expect(toHoursAbs(-90)).toBe(1.5);
  });

  it('returns 0 for 0', () => {
    expect(toHoursAbs(0)).toBe(0);
  });
});

describe('toHours', () => {
  it('converts minutes to hours', () => {
    expect(toHours(120)).toBe(2);
    expect(toHours(60)).toBe(1);
  });

  it('preserves sign', () => {
    expect(toHours(-60)).toBe(-1);
  });
});

describe('CSV escaping', () => {
  it('quotes every cell', () => {
    expect(escapeCSV('hello')).toBe('"hello"');
  });

  it('escapes double quotes', () => {
    expect(escapeCSV('he"llo')).toBe('"he""llo"');
  });

  it('prefixes formula injection characters with quote', () => {
    expect(escapeCSV('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(escapeCSV('+SUM(A1)')).toBe(`"'+SUM(A1)"`);
    expect(escapeCSV('-SUM(A1)')).toBe(`"'-SUM(A1)"`);
    expect(escapeCSV('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
  });

  it('prefixes tab and carriage return with quote', () => {
    expect(escapeCSV('\tdata')).toBe(`"'\tdata"`);
    expect(escapeCSV('\rdata')).toBe(`"'\rdata"`);
  });

  it('handles commas inside value', () => {
    expect(escapeCSV('a,b')).toBe('"a,b"');
  });

  it('handles empty string', () => {
    expect(escapeCSV('')).toBe('""');
  });

  it('handles numbers', () => {
    expect(escapeCSV(123)).toBe('"123"');
  });
});
