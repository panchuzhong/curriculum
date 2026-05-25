import { describe, it, expect } from 'vitest';
import { getColor, getTextColor, getCategoryColor } from '../services/colors.js';

describe('getColor', () => {
  it('returns hsl string for known subject+grade', () => {
    expect(getColor({ subject: '数学', grade: '高一' }, false)).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });

  it('uses hue 210 for 数学', () => {
    const color = getColor({ subject: '数学', grade: '高一' }, false);
    expect(color).toMatch(/^hsl\(210,/);
  });

  it('produces different lightness for different grades', () => {
    const junior = getColor({ subject: '数学', grade: '初一' }, false);
    const senior = getColor({ subject: '数学', grade: '高三' }, false);
    expect(junior).not.toBe(senior);
  });

  it('handles unknown subject deterministically', () => {
    const a = getColor({ subject: '编程', grade: '高一' }, false);
    const b = getColor({ subject: '编程', grade: '高一' }, false);
    expect(a).toBe(b);
  });

  it('adjusts for dark mode', () => {
    const light = getColor({ subject: '物理', grade: '高二' }, false);
    const dark = getColor({ subject: '物理', grade: '高二' }, true);
    expect(light).not.toBe(dark);
  });
});

describe('getTextColor', () => {
  it('returns white-ish in dark mode', () => {
    expect(getTextColor({ subject: '数学', grade: '高一' }, true)).toBe('rgba(255,255,255,0.92)');
  });

  it('returns white for dark backgrounds (大学)', () => {
    expect(getTextColor({ subject: '数学', grade: '大学' }, false)).toBe('#ffffff');
  });

  it('returns dark for light backgrounds (初一)', () => {
    expect(getTextColor({ subject: '数学', grade: '初一' }, false)).toBe('#1a1a1a');
  });
});

describe('getCategoryColor', () => {
  it('parses "初中数学"', () => {
    expect(getCategoryColor('初中数学', false)).toMatch(/^hsl\(/);
  });

  it('parses "高中竞赛数学"', () => {
    expect(getCategoryColor('高中竞赛数学', false)).toMatch(/^hsl\(/);
  });

  it('returns null for empty subject after prefix', () => {
    expect(getCategoryColor('初中', false)).toBeNull();
  });

  it('handles plain subject', () => {
    expect(getCategoryColor('数学', false)).toMatch(/^hsl\(/);
  });
});
