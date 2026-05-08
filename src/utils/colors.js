import { createContext } from 'react';
import { SUBJECT_HUES, GRADE_LIGHTNESS } from './constants';

export const DarkContext = createContext(false);

let _dark = false;
export function setDarkMode(dark) { _dark = dark; }

// Map base lightness (38–70) to rendered range
function mappedLightness(baseL, dark) {
  const t = (baseL - 38) / 32; // 0 (大学) to 1 (初一)
  if (dark) return 35 + t * 23;  // 35–58
  return 33 + t * 45;             // 33–78
}

// Saturation modifier: younger grades more vivid, older more muted
function satMod(baseL, dark) {
  const t = (baseL - 38) / 32;
  if (dark) return 0.45 + t * 0.15; // 0.45–0.60
  return 0.85 + t * 0.15;           // 0.85–1.00
}

export function getClassColor(cls, dark = _dark) {
  const hue = SUBJECT_HUES[cls.subject] || { h: 0, s: 0 };
  const baseL = GRADE_LIGHTNESS[cls.grade] ?? 50;
  const l = mappedLightness(baseL, dark);
  const s = Math.round(hue.s * satMod(baseL, dark));
  return `hsl(${hue.h}, ${s}%, ${Math.round(l)}%)`;
}

export function getTextColor(cls, dark = _dark) {
  if (dark) return 'rgba(255,255,255,0.92)';
  const baseL = GRADE_LIGHTNESS[cls.grade] ?? 50;
  const l = mappedLightness(baseL, false);
  return l < 55 ? '#ffffff' : '#1a1a1a';
}

export function getSubjectColor(subject) {
  const hue = SUBJECT_HUES[subject] || { h: 0, s: 0 };
  return `hsl(${hue.h}, ${hue.s}%, 50%)`;
}

const GRADE_REPRESENTATIVE = {
  '初中': '初二', '高中': '高二', '大学': '大学',
  '初中竞赛': '初二', '高中竞赛': '高二',
};

export function getCategoryColor(category, dark = _dark) {
  const match = category.match(/^(初中竞赛|高中竞赛|初中|高中|大学)/);
  const gradeLevel = match ? match[1] : null;
  const subject = gradeLevel ? category.slice(gradeLevel.length) : category;
  if (!subject) return null;

  const hue = SUBJECT_HUES[subject] || { h: 0, s: 0 };
  const repGrade = gradeLevel ? (GRADE_REPRESENTATIVE[gradeLevel] ?? '高二') : '高二';
  const baseL = GRADE_LIGHTNESS[repGrade] ?? 50;
  const l = mappedLightness(baseL, dark);
  const s = Math.round(hue.s * satMod(baseL, dark));
  return `hsl(${hue.h}, ${s}%, ${Math.round(l)}%)`;
}
