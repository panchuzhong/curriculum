import { describe, it, expect } from 'vitest';
import { getClassColor, getTextColor, getSubjectColor, getCategoryColor, setDarkMode } from '../colors';

describe('getClassColor', () => {
  it.each(['__proto__', 'constructor', 'toString'])('renders a valid color for custom subject %s', subject => {
    expect(getClassColor({ subject, grade: '高一' }, false)).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    expect(getSubjectColor(subject)).toMatch(/^hsl\(\d+, \d+%, 50%\)$/);
  });

  it('returns hsl string for known subject+grade', () => {
    const color = getClassColor({ subject: '数学', grade: '高一' });
    expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });

  it('returns different colors for different subjects', () => {
    const math = getClassColor({ subject: '数学', grade: '高一' });
    const physics = getClassColor({ subject: '物理', grade: '高一' });
    expect(math).not.toBe(physics);
  });

  it('returns different lightness for different grades', () => {
    const junior = getClassColor({ subject: '数学', grade: '初一' });
    const senior = getClassColor({ subject: '数学', grade: '高三' });
    expect(junior).not.toBe(senior);
  });

  it('handles unknown subject with hash-based color', () => {
    const color = getClassColor({ subject: '编程', grade: '高一' });
    expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });

  it('returns deterministic colors for same input', () => {
    const a = getClassColor({ subject: '数学', grade: '高一' });
    const b = getClassColor({ subject: '数学', grade: '高一' });
    expect(a).toBe(b);
  });

  it('handles null class gracefully', () => {
    const color = getClassColor(null);
    expect(color).toMatch(/^hsl\(/);
  });

  it('produces darker colors in dark mode', () => {
    const light = getClassColor({ subject: '数学', grade: '高一' }, false);
    setDarkMode(true);
    const dark = getClassColor({ subject: '数学', grade: '高一' });
    setDarkMode(false);
    expect(light).not.toBe(dark);
  });
});

describe('getTextColor', () => {
  it('returns white-ish in dark mode', () => {
    expect(getTextColor({ subject: '数学', grade: '高一' }, true)).toBe('rgba(255,255,255,0.92)');
  });

  it('returns white for dark backgrounds (high grade)', () => {
    // 大学 has low lightness → dark bg → white text
    expect(getTextColor({ subject: '数学', grade: '大学' }, false)).toBe('#ffffff');
  });

  it('returns dark for light backgrounds (low grade)', () => {
    // 初一 has high lightness → light bg → dark text
    expect(getTextColor({ subject: '数学', grade: '初一' }, false)).toBe('#1a1a1a');
  });
});

describe('getSubjectColor', () => {
  it('returns hsl string', () => {
    expect(getSubjectColor('数学')).toMatch(/^hsl\(\d+, \d+%, 50%\)$/);
  });

  it('returns same hue as getClassColor for same subject', () => {
    const subject = getSubjectColor('物理');
    const cls = getClassColor({ subject: '物理', grade: '高二' }, false);
    // Both should use hue 122 for 物理
    expect(subject).toMatch(/^hsl\(122,/);
  });
});

describe('getCategoryColor', () => {
  it('parses "初中数学" format', () => {
    const color = getCategoryColor('初中数学', false);
    expect(color).toMatch(/^hsl\(/);
  });

  it('parses "高中物理" format', () => {
    const color = getCategoryColor('高中物理', false);
    expect(color).toMatch(/^hsl\(/);
  });

  it('parses "大学" format', () => {
    const color = getCategoryColor('大学英语', false);
    expect(color).toMatch(/^hsl\(/);
  });

  it('parses competition categories', () => {
    const color = getCategoryColor('初中竞赛数学', false);
    expect(color).toMatch(/^hsl\(/);
  });

  it('returns null for empty subject after grade prefix', () => {
    expect(getCategoryColor('初中', false)).toBeNull();
  });

  it('handles plain subject without grade prefix', () => {
    const color = getCategoryColor('数学', false);
    expect(color).toMatch(/^hsl\(/);
  });
});
