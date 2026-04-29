import { SUBJECT_HUES, GRADE_LIGHTNESS } from './constants';

export function getClassColor(cls) {
  const hue = SUBJECT_HUES[cls.subject] || { h: 0, s: 0 };
  const lightness = GRADE_LIGHTNESS[cls.grade] ?? 50;
  return `hsl(${hue.h}, ${hue.s}%, ${lightness}%)`;
}

export function getSubjectColor(subject) {
  const hue = SUBJECT_HUES[subject] || { h: 0, s: 0 };
  return `hsl(${hue.h}, ${hue.s}%, 50%)`;
}
