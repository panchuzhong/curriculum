// 经纬度各自记着「按哪个地点名填的」（form.defaultLocationLatFor / defaultLocationLngFor，
// 持久化在 classes 表）。地点改了而某个坐标还是旧地点的，就提示重新获取或手动修改。
// 逐字段判断：只改一个坐标时，另一个仍是旧地点的，提示不能消——否则错配的经纬度会静默入库。
// 来源为空字符串（先填坐标、后填地点）的那一项不知道按哪个地点填的，不提示；库里为 NULL 的
// 由 withCoordSources 在载入时补成当时的地点名。
// 返回去重后的过期来源名（可能两项各是一个旧地点），空数组表示无需提示。
export function staleCoordNames(form) {
  const name = (form.defaultLocationName || '').trim();
  const names = new Set();
  for (const [field, forField] of [
    ['defaultLocationLat', 'defaultLocationLatFor'],
    ['defaultLocationLng', 'defaultLocationLngFor'],
  ]) {
    const value = form[field];
    const forName = (form[forField] || '').trim();
    if (value != null && value !== '' && forName !== '' && forName !== name) names.add(forName);
  }
  return [...names];
}

const COORD_FIELDS = ['defaultLocationLat', 'defaultLocationLng'];
const hasValue = v => v != null && v !== '';

// 载入班级时补来源：库里为 NULL 的（加这两列之前存的行、还原的旧备份、没带来源的 API 写入）
// 按载入时的地点名算。当成「来源未知、不提示」的话，这些班改地点时既不清坐标、也不提示，
// 旧坐标会悄悄跟着新地点名存下去，再被之后新建的排课继承。空字符串不动：那是先填坐标、
// 后填地点，确实不知道按哪个地点填的。
export function withCoordSources(cls) {
  const out = { ...cls };
  for (const field of COORD_FIELDS) {
    if (out[`${field}For`] == null && hasValue(out[field])) out[`${field}For`] = cls.defaultLocationName || '';
  }
  return out;
}

// 提交前：地点名清空了，按原来那个地点填的坐标就没有归属了，跟着清掉（和 PUT /api/schedules
// 去掉地点名时一并清坐标同一个道理），否则之后新建的排课会继承一对没有地点名的坐标。
// 来源为空的（没有地点名时手填的坐标）照存。
export function dropOrphanedCoords(form) {
  if ((form.defaultLocationName || '').trim()) return form;
  const out = { ...form };
  for (const field of COORD_FIELDS) {
    if ((form[`${field}For`] || '').trim()) {
      out[field] = '';
      out[`${field}For`] = '';
    }
  }
  return out;
}
