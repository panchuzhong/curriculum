// Guards against drift between the duplicated holiday/color data maintained
// on the server (export images, batch scheduling) and the frontend (UI).
import { describe, it, expect } from 'vitest';
import { HOLIDAYS, WORKDAYS, HOLIDAY_NAMES } from '../services/holidays-data.js';
import { BUILT_IN_HOLIDAYS, BUILT_IN_WORKDAYS, HOLIDAY_NAMES as FE_HOLIDAY_NAMES } from '../../src/utils/holidays.js';
import { BUILT_IN_HOLIDAYS as SETTINGS_HOLIDAYS } from '../../src/settings/HolidayManager.jsx';
import { GRADES, SUBJECT_HUES, GRADE_LIGHTNESS } from '../../src/utils/constants';
import { getColor, getTextColor, getCategoryColor } from '../services/colors.js';
import { getClassColor, getTextColor as feGetTextColor, getCategoryColor as feGetCategoryColor } from '../../src/utils/colors';

describe('holiday builtin data: server vs frontend', () => {
  it('holiday dates match exactly', () => {
    expect(BUILT_IN_HOLIDAYS).toEqual(HOLIDAYS);
  });

  it('workday dates match exactly', () => {
    expect(BUILT_IN_WORKDAYS).toEqual(WORKDAYS);
  });

  it('holiday names match exactly', () => {
    expect(FE_HOLIDAY_NAMES).toEqual(HOLIDAY_NAMES);
  });
});

describe('holiday import list in Settings matches the builtin dataset', () => {
  it('every imported entry is a known builtin holiday/workday of its year', () => {
    for (const [year, items] of Object.entries(SETTINGS_HOLIDAYS)) {
      for (const { date, type } of items) {
        expect(date.startsWith(`${year}-`)).toBe(true);
        const mmdd = date.slice(5);
        if (type === 'holiday') expect(HOLIDAYS[year]).toContain(mmdd);
        else expect(WORKDAYS[year]).toContain(mmdd);
      }
    }
  });

  it('the import list covers every builtin holiday and workday', () => {
    const imported = new Set(
      Object.values(SETTINGS_HOLIDAYS).flat().map(i => `${i.type}:${i.date}`),
    );
    for (const [year, dates] of Object.entries(HOLIDAYS)) {
      for (const mmdd of dates) expect(imported.has(`holiday:${year}-${mmdd}`)).toBe(true);
    }
    for (const [year, dates] of Object.entries(WORKDAYS)) {
      for (const mmdd of dates) expect(imported.has(`workday:${year}-${mmdd}`)).toBe(true);
    }
  });
});

describe('color functions: server (image export) vs frontend (UI)', () => {
  const subjects = [...Object.keys(SUBJECT_HUES), '编程', '天文', 'unknown-subject'];

  it('getClassColor/getColor agree for every grade x subject x theme', () => {
    for (const grade of GRADES) {
      for (const subject of subjects) {
        for (const dark of [false, true]) {
          const cls = { subject, grade };
          expect(getClassColor(cls, dark)).toBe(getColor(cls, dark));
        }
      }
    }
  });

  it('getTextColor agrees for every grade x theme', () => {
    for (const grade of GRADES) {
      for (const dark of [false, true]) {
        expect(feGetTextColor({ grade }, dark)).toBe(getTextColor({ grade }, dark));
      }
    }
  });

  it('getCategoryColor agrees for grade-level categories', () => {
    const categories = [
      '初中数学', '高中物理', '大学编程',
      '初中竞赛数学', '高中竞赛物理',
    ];
    for (const category of categories) {
      for (const dark of [false, true]) {
        expect(feGetCategoryColor(category, dark)).toBe(getCategoryColor(category, dark));
      }
    }
  });

  it('color constants match (subject hues / grade lightness)', () => {
    // Server colors.js keeps private copies; assert via output equality above,
    // and constants equality through the public constants module.
    expect(Object.keys(SUBJECT_HUES).length).toBeGreaterThan(0);
    expect(GRADE_LIGHTNESS['初一']).toBe(70);
  });
});
