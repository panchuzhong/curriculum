import { describe, it, expect } from 'vitest';

// Simulates the field whitelisting pattern used in PUT handlers
function whitelist(body, allowed) {
  return Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k))
  );
}

describe('Field whitelisting (mass assignment protection)', () => {
  const classAllowed = ['name', 'grade', 'subject', 'studentCount', 'unitPrice',
    'discountAmount', 'discountReason', 'isCompetition', 'defaultLocationName',
    'defaultLocationLat', 'defaultLocationLng'];

  it('filters out teacherId from class update', () => {
    const result = whitelist({
      name: 'Math',
      teacherId: 999,
    }, classAllowed);
    expect(result).toEqual({ name: 'Math' });
    expect(result.teacherId).toBeUndefined();
  });

  it('filters out deleted flag', () => {
    const result = whitelist({
      name: 'Math',
      deleted: true,
    }, classAllowed);
    expect(result).toEqual({ name: 'Math' });
    expect(result.deleted).toBeUndefined();
  });

  it('allows all valid fields', () => {
    const body = {
      name: 'A', grade: '高一', subject: '数学', studentCount: 5,
      unitPrice: 200, discountAmount: 10, discountReason: 'test',
      isCompetition: false, defaultLocationName: 'Room 1',
    };
    const result = whitelist(body, classAllowed);
    expect(Object.keys(result).length).toBe(9);
  });

  it('returns empty when all fields are invalid', () => {
    const result = whitelist({
      teacherId: 1, deleted: false, id: 5, createdAt: '2025-01-01',
    }, classAllowed);
    expect(result).toEqual({});
  });

  const scheduleAllowed = ['classId', 'date', 'startTime', 'endTime',
    'durationBilling', 'locationName', 'locationLat', 'locationLng'];

  it('schedule whitelist filters malicious fields', () => {
    const result = whitelist({
      startTime: '09:00', endTime: '10:00',
      teacherId: 999, id: 1, __proto__: {},
    }, scheduleAllowed);
    expect(result).toEqual({ startTime: '09:00', endTime: '10:00' });
  });

  const semesterAllowed = ['name', 'type', 'startDate', 'endDate'];
  it('semester whitelist works', () => {
    const result = whitelist({
      name: 'Fall 2025', type: 'fall', startDate: '2025-09-01', endDate: '2026-01-15',
      teacherId: 42,
    }, semesterAllowed);
    expect(result.teacherId).toBeUndefined();
    expect(Object.keys(result).length).toBe(4);
  });
});
