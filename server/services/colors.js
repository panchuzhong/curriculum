const SUBJECT_HUES = {
  '数学': { h: 210, s: 79 },
  '物理': { h: 122, s: 50 },
  '英语': { h: 45, s: 93 },
  '化学': { h: 280, s: 62 },
  '语文': { h: 0, s: 68 },
  '生物': { h: 187, s: 100 },
  '历史': { h: 20, s: 35 },
  '地理': { h: 200, s: 20 },
  '政治': { h: 25, s: 100 },
};

function subjectHue(name) {
  const preset = SUBJECT_HUES[name];
  if (preset) return preset;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return { h: ((hash & 0x7fffffff) % 360), s: 55 + (hash % 30) };
}
  '数学': { h: 210, s: 79 },
  '物理': { h: 122, s: 50 },
  '英语': { h: 45, s: 93 },
  '化学': { h: 280, s: 62 },
  '语文': { h: 0, s: 68 },
  '生物': { h: 187, s: 100 },
  '历史': { h: 20, s: 35 },
  '地理': { h: 200, s: 20 },
  '政治': { h: 25, s: 100 },
};

const GRADE_LIGHTNESS = {
  '初一': 70, '初二': 64, '初三': 58,
  '高一': 52, '高二': 46, '高三': 42, '大学': 38,
};

function mappedLightness(baseL, dark) {
  const t = (baseL - 38) / 32;
  return dark ? 35 + t * 23 : 33 + t * 45;
}

function satMod(baseL, dark) {
  const t = (baseL - 38) / 32;
  return dark ? 0.45 + t * 0.15 : 0.85 + t * 0.15;
}

export function getColor(cls, dark) {
  const hue = subjectHue(cls.subject);
  const baseL = GRADE_LIGHTNESS[cls.grade] ?? 50;
  const l = mappedLightness(baseL, dark);
  const s = Math.round(hue.s * satMod(baseL, dark));
  return `hsl(${hue.h}, ${s}%, ${Math.round(l)}%)`;
}

export function getTextColor(cls, dark) {
  if (dark) return 'rgba(255,255,255,0.92)';
  const baseL = GRADE_LIGHTNESS[cls.grade] ?? 50;
  return mappedLightness(baseL, false) < 55 ? '#ffffff' : '#1a1a1a';
}

const GRADE_REPRESENTATIVE = {
  '初中': '初二', '高中': '高二', '大学': '大学',
  '初中竞赛': '初二', '高中竞赛': '高二',
};

export function getCategoryColor(category, dark) {
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
