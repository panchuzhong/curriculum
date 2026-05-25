import { describe, it, expect } from 'vitest';
import { setViewDate, getViewDate } from '../viewDate';

describe('viewDate store', () => {
  it('returns null for keys that have not been set', () => {
    expect(getViewDate('unset_key_xyz')).toBeNull();
  });

  it('stores and retrieves values', () => {
    setViewDate('week', '2026-07-20');
    expect(getViewDate('week')).toBe('2026-07-20');

    setViewDate('month', '2026-6');
    expect(getViewDate('month')).toBe('2026-6');

    setViewDate('year', '2026');
    expect(getViewDate('year')).toBe('2026');
  });

  it('overwrites a previously stored value for the same key', () => {
    setViewDate('week', '2026-07-20');
    expect(getViewDate('week')).toBe('2026-07-20');
    setViewDate('week', '2026-08-03');
    expect(getViewDate('week')).toBe('2026-08-03');
  });

  it('keeps different keys independent', () => {
    setViewDate('key_a', 'value-a');
    setViewDate('key_b', 'value-b');
    expect(getViewDate('key_a')).toBe('value-a');
    expect(getViewDate('key_b')).toBe('value-b');
  });
});
