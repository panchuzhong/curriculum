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

// 导出给 Reports：按学科统计的柱子要按学科着色，但它的亮度随"竞赛"变化，
// 所以拿的是色相本身而不是 getSubjectColor 拼好的字符串。自己再写一遍查表的话
// 就会漏掉下面这个哈希兜底——预设之外的自定义学科会全部塌成同一个灰色。
export function subjectHue(name) {
  const preset = Object.hasOwn(SUBJECT_HUES, name) ? SUBJECT_HUES[name] : null;
  if (preset) return preset;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return { h: ((hash & 0x7fffffff) % 360), s: 55 + (hash % 30) };
}

// 自有属性查找：年级是继承来的键（"constructor"、"toString"）时，GRADE_LIGHTNESS[grade]
// 取到的是一个函数——不是 nullish，?? 兜不住，接着 (baseL - 38) / 32 就是 NaN，
// 渲染出 hsl(210, NaN%, NaN%)，浏览器把整条声明丢掉：色块变透明、文字近黑，
// 而同一个班在导出的 PNG 里是正常的蓝块白字（服务端那份一直有这段守卫）。
// 这种年级只有还原备份塞得进来（classFields 原样写回，不过 isIn(VALID_GRADES)）。
function gradeLightness(grade) {
  return Object.hasOwn(GRADE_LIGHTNESS, grade) ? GRADE_LIGHTNESS[grade] : 50;
}

export function getClassColor(cls, dark = _dark) {
  const hue = cls ? subjectHue(cls.subject) : { h: 0, s: 0 };
  const baseL = cls ? gradeLightness(cls.grade) : 50;
  const l = mappedLightness(baseL, dark);
  const s = Math.round(hue.s * satMod(baseL, dark));
  return `hsl(${hue.h}, ${s}%, ${Math.round(l)}%)`;
}

export function getTextColor(cls, dark = _dark) {
  if (dark) return 'rgba(255,255,255,0.92)';
  const baseL = cls ? gradeLightness(cls.grade) : 50;
  const l = mappedLightness(baseL, false);
  return l < 55 ? '#ffffff' : '#1a1a1a';
}

export function getSubjectColor(subject) {
  const hue = subjectHue(subject);
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

  const hue = subjectHue(subject);
  const repGrade = gradeLevel ? (GRADE_REPRESENTATIVE[gradeLevel] ?? '高二') : '高二';
  const baseL = GRADE_LIGHTNESS[repGrade] ?? 50;
  const l = mappedLightness(baseL, dark);
  const s = Math.round(hue.s * satMod(baseL, dark));
  return `hsl(${hue.h}, ${s}%, ${Math.round(l)}%)`;
}
