import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { DATE_MIN, DATE_MAX } from '../utils/constants';
import { dateRangeError, isUsableDate, addDays, parseDateStr, YEAR_MIN, YEAR_MAX } from '../utils/date';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmDialog';

const TYPES = [
  { value: 'spring', label: '春季' },
  { value: 'fall', label: '秋季' },
  { value: 'winter', label: '寒假' },
  { value: 'summer', label: '暑假' },
];

const SEMESTER_ORDER = ['spring', 'summer', 'fall', 'winter'];

const SEMESTER_TEMPLATES = {
  spring: (y) => ({ name: `${y}春季`, type: 'spring', startDate: `${y}-02-23`, endDate: `${y}-07-05` }),
  summer: (y) => ({ name: `${y}暑假`, type: 'summer', startDate: `${y}-07-07`, endDate: `${y}-08-31` }),
  fall:   (y) => ({ name: `${y}秋季`, type: 'fall', startDate: `${y}-09-01`, endDate: `${y + 1}-01-15` }),
  winter: (y) => ({ name: `${y}寒假`, type: 'winter', startDate: `${y + 1}-01-15`, endDate: `${y + 1}-02-20` }),
};

// 模板自己会跃到下一年（fall/winter 的 endDate 是 y+1），从 2999 秋季推下一个就会
// 预填出 3000-01-15——然后 handleCreate 拿自己填的值报一句「日期无效」，表单不改
// 就存不下。要么不自己生成越界日期，要么别拿它报错；这里选前者。
//
// 夹的是年份，不是算出来的日期。夹日期治不了两头：
// 一是 3000-01-15 和 3000-02-20 会一起夹到 2999-12-31，预填出一个零长度的寒假，
// dateRangeError 还觉得没问题，照样存得下去；
// 二是年份是数字拼进字符串的，旧库里被原生控件左移成 0261 的学期会算出 261，
// 拼出 '261-07-07'——三位年份按字符串比大小正好落在上下限之间，clampDate 根本
// 看不出它越界，原样放行。夹年份两个问题一起没：年份合法，拼出来的日期就合法。
//
// spring/summer 当年结束，fall/winter 结束于 y+1，所以后两者的年份上限要再低一年。
function templateYear(type, y) {
  const max = (type === 'fall' || type === 'winter') ? YEAR_MAX - 1 : YEAR_MAX;
  return Math.min(Math.max(y, YEAR_MIN), max);
}

function buildTemplate(type, y) {
  return SEMESTER_TEMPLATES[type](templateYear(type, y));
}

// 没有（可用的）学期行时的退路。每个模板必须在选中它的那个月份里还在进行中，
// 否则表单会预填出一个完全在过去的区间：春季 07-05 结束，所以 7 月归暑假；
// 暑假 08-31 结束，所以 9 月归秋季。
function guessFromToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 2 && m <= 6) return buildTemplate('spring', y);
  if (m === 7 || m === 8) return buildTemplate('summer', y);
  if (m >= 9) return buildTemplate('fall', y);
  return buildTemplate('winter', y - 1);
}

export function getDefaultsFromSemesters(semesters) {
  // 用不了的学期行不参与推算。还原时故意不丢 semesters，所以库里可能存着被原生
  // 控件左移成 0261 的行，甚至手改备份塞进来的非日期字符串（parseInt 会得到 NaN，
  // 拼出 'NaN-07-07'）。从这种行推下一个学期，夹也好不夹也好都是猜：夹出来的
  // 「1900暑假」看着正常，用户随手一存就多一条 1900 年的学期。
  // 这和 ScheduleHistory 的默认区间是同一条规矩（见 CLAUDE.md）：从未校验的学期行
  // 推出来的值不夹，因为夹出来的是个看着像回事的错值；宁可退回按今天猜。
  const usable = (semesters || []).filter(s => isUsableDate(s.startDate) && isUsableDate(s.endDate));
  if (usable.length === 0) return guessFromToday();

  // Find the latest semester by end date
  const sorted = [...usable].sort((a, b) => a.endDate.localeCompare(b.endDate));
  const latest = sorted[sorted.length - 1];
  // 模板年份从 startDate 推，不从 endDate 推。模板里 fall/winter 的 endDate 落在 y+1，
  // 所以「endDate 的年份减一」只在没人动过结束日时才成立。老师把秋季提前到同年
  // 12-31 结束（完全正常的排法，也是 2999 年唯一排得出来的），endYear-1 就算成 2025，
  // 「下一个学期」于是预填成 2025 寒假 = 2026-01-15~2026-02-20——比它要接的那个秋季
  // 早了八个多月。日期合法、也不重叠，dateRangeError 放行，一点保存就进库了。
  // startDate 是学期自己的年份：spring/summer/fall 都等于模板年 y，只有 winter 的
  // 模板 startDate 是 y+1-01-15，要退一年。改结束日不影响它。
  //
  // 寒假是跨年的那一个：模板把它排在 y+1-01-15 开始，所以模板行要减一年。但老师
  // 完全可以把寒假排成 12-20 就开始——这种行从来没有过那个 +1，再减一年就是纯亏，
  // 「下一个学期」会落到十个月前（2026-12-20 开始的寒假推出 2026 春季），而且区间合法、
  // 跟谁都不重叠，服务端的半开区间重叠检查也拦不住，一点保存就存进去了。
  // 按开始月份判：上半年开始的寒假属于上一学年，年底开始的就是当年那一学年。
  const startYear = parseInt(latest.startDate.slice(0, 4));
  const startMonth = parseInt(latest.startDate.slice(5, 7));
  const latestYear = (latest.type === 'winter' && startMonth <= 6) ? startYear - 1 : startYear;
  const idx = SEMESTER_ORDER.indexOf(latest.type);
  // type 不在这四种里（还原时 semesters 整行原样写回，不过 validateCreateSemester，
  // 手改的备份就能塞进来 'autumn' 这种）：indexOf 给 -1，nextIdx 算出 0，
  // 而 0 <= -1 不成立所以年份也不进位——预填出一个同年的春季，比它要接的那个
  // 学期早八个月，而且服务端的半开区间重叠检查还拦不住，一键就存进去了。
  // 认不出类型就是推不出「下一个」，和年份到顶一样退回按今天猜。
  // 这条退路不做下面那个防重叠的顺延：猜出来的学期确实可能和这行撞上（'autumn' 那行
  // 正好排在今年时就会），但那要手改备份塞进一个非法 type 才够得着，而且撞上的后果是
  // 保存时一句看得见的 409，不是一个存得下去的错值。为它加一条分支不值当。
  if (idx === -1) return guessFromToday();
  const nextIdx = (idx + 1) % 4;
  const nextType = SEMESTER_ORDER[nextIdx];
  const nextYear = nextIdx <= idx ? latestYear + 1 : latestYear; // wrap around = next year
  // 年份被夹住，就是范围到头了、真的推不出下一个学期（唯一的学期是 2999 暑假时，
  // fall 的年份会被夹到 2998，推出一个排在它前面的 2998 秋季）。退回按今天猜。
  //
  // 两头都夹，不只是上限：唯一的学期是 1900 秋季时，latestYear 算出 1899，
  // 下一个寒假的年份被夹回 1900，这里也会退回按今天猜。那一档本来预填成
  // 1900 寒假也完全合法，但要区分「夹上去」和「夹下来」就得把 templateYear
  // 拆成两个方向——为一个需要 1900-01-15 结束的学期才够得着的分支不值当。
  // 退路本身给的是一个合法、存得下的区间，所以这一头就这样。
  //
  // 判的必须是「年份是不是真被夹过」。不能拿推出来的 startDate 和 latest.endDate 一比不合
  // 就退回按今天猜：endDate 是用户改得了的，老师把秋季从 01-15 往后延几天，那一比就不成立，
  // 而猜出来正好是一个和他已有秋季几乎重合的秋季，存的时候一样撞 409，他本该得到的寒假
  // 反而没了。延期要的是把开始日顺延（见下），不是退回猜。
  if (templateYear(nextType, nextYear) !== nextYear) return guessFromToday();

  const tmpl = buildTemplate(nextType, nextYear);
  // 模板的开始日可能落在 latest.endDate 之前：模板把秋季排到 01-15 结束、寒假 01-15 开始，
  // 老师把那个秋季延到 01-20，下一个寒假照模板仍从 01-15 开始，和它重叠五天——一点保存
  // 就是 409「该教师已有日期重叠的学期」，而表单里两个日期看着都正常，用户只能自己猜改哪个。
  // 顺延到那个学期的结束日即可：重叠检查是半开的（startDate < s.endDate 才算重叠），正好
  // 接上不算重叠，模板自己也是这么首尾相接的。latest 是 endDate 最大的那行，所以开始日
  // 一旦不早于它，就不可能和任何一行重叠——这个预填必定存得下去。
  if (tmpl.startDate >= latest.endDate) return tmpl;
  // 顺延时整段平移，保住模板的时长。只挪开始日的话，秋季一路延到寒假模板结束日之后
  // （01-15 延到 02-24 以后）区间就会倒挂。名字里的年份可能因此显得靠前——秋季延到三月，
  // 接上的那段仍叫「2026寒假」——但名字是表单里可改的文本，区间对不对用户看不出来；
  // 宁可名字待改，也不能预填一个一存就 409 的区间。
  const span = Math.round((parseDateStr(tmpl.endDate) - parseDateStr(tmpl.startDate)) / 86400000);
  const endDate = addDays(latest.endDate, span);
  // 平移到了范围外：只有 latest.endDate 已经贴着 DATE_MAX 才会发生，那时按今天猜出来的
  // 学期离它上千年，不可能重叠——这一头退回猜是安全的。
  if (!isUsableDate(endDate)) return guessFromToday();
  return { ...tmpl, startDate: latest.endDate, endDate };
}

export default function SemesterManager() {
  const toast = useToast();
  const [confirmAction, confirmDialog] = useConfirm();
  const [semesters, setSemesters] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  // 「表单存在」不等于「用户动过」：列表还没回来就点「新建学期」的话，预填用的是
  // getDefaultsFromSemesters([])——按今天猜的模板，而不是「接在你最后一个学期之后」。
  // 只看 form 是不是 null 会把这份猜出来的值当成用户的输入护住，迟到的列表就再也纠正不了。
  const formTouched = useRef(false);
  const updateForm = useCallback((patch) => {
    formTouched.current = true;
    setForm(f => ({ ...f, ...patch }));
  }, []);

  useEffect(() => {
    api.getSemesters().then(s => {
      setSemesters(s);
      // 用户真动过才不覆盖：他在列表回来前就开始敲名称的话，这一次迟到的
      // 赋值会把他敲的字整个冲掉。没动过的（包括刚点开、还摆着猜出来的预填值）
      // 则必须纠正成按真实列表算的默认值。
      setForm(f => (formTouched.current ? f : getDefaultsFromSemesters(s)));
    }).catch(e => toast(e.message || '加载学期失败'));
  }, []);

  const reload = useCallback(() => {
    api.getSemesters().then(setSemesters).catch(e => toast(e.message || '加载学期失败'));
  }, []);

  async function handleCreate() {
    if (saving) return;
    // 先卡名称，日期的事交给 dateRangeError（它包括「没填完」）——之前写在前面的
    // !form.startDate 会把那句提示遮掉，清空一端再保存就是毫无反应。
    if (!form.name) { toast('请先填写学期名称'); return; }
    // min/max 只把越界值标成 :invalid，value 照样提交。学期范围被左移成 0261 之后，
    // 批量排课、批量删课、排课历史的默认区间都会跟着落到那一年。
    const rangeError = dateRangeError(form.startDate, form.endDate);
    if (rangeError) { toast(rangeError); return; }
    setSaving(true);
    try {
      await api.createSemester(form);
      setShowForm(false);
      // 这一发没 await，finally 里的 setSaving(false) 已经把每一行的「编辑」放开了：
      // 回调落地时用户可能已经点开了某一行的编辑表单。无条件 setForm 会把那张表单
      // 换成「下一个学期」的模板，而 editing 还指着原来那行——再点保存就把人家的
      // 学期悄悄改成了模板值。跟挂载时那一发同一条规矩：动过的表单不碰。
      api.getSemesters().then(s => {
        setSemesters(s);
        setForm(f => (formTouched.current ? f : getDefaultsFromSemesters(s)));
      }).catch(e => toast(e.message || '加载学期失败'));
    } catch (e) { toast(e.message || '创建失败'); }
    finally { setSaving(false); }
  }

  async function handleUpdate() {
    if (saving) return;
    if (!form.name) { toast('请先填写学期名称'); return; }
    const rangeError = dateRangeError(form.startDate, form.endDate);
    if (rangeError) { toast(rangeError); return; }
    setSaving(true);
    try {
      await api.updateSemester(editing.id, form);
      setEditing(null);
      reload();
    } catch (e) { toast(e.message || '更新失败'); }
    finally { setSaving(false); }
  }

  function startEdit(s) {
    setEditing(s);
    // 这张表单装的是某一行真实的值，不是一份可以被覆盖的预填——
    // 标成「动过」，否则迟到的学期列表会把它换成模板值。
    formTouched.current = true;
    setForm({ name: s.name, type: s.type, startDate: s.startDate, endDate: s.endDate });
  }

  async function handleDelete(id) {
    if (saving) return;
    if (!(await confirmAction('确定删除此学期？'))) return;
    setSaving(true);
    try {
      await api.deleteSemester(id);
      reload();
    } catch (e) { toast(e.message || '删除失败'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl">学期管理</h2>
        <button onClick={() => { setShowForm(true); setEditing(null); formTouched.current = false; setForm(getDefaultsFromSemesters(semesters)); }}
          className="px-4 py-2 bg-blue-600 text-white rounded">新建学期</button>
      </div>

      {(showForm || editing) && (
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg mb-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">名称</label>
              <input className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                value={form.name} onChange={e => updateForm({ name: e.target.value })}
                placeholder="如：2026春季" />
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">类型</label>
              <select className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                value={form.type} onChange={e => updateForm({ type: e.target.value })}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">开始日期</label>
              <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                value={form.startDate} onChange={e => updateForm({ startDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">结束日期</label>
              <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded"
                value={form.endDate} onChange={e => updateForm({ endDate: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={editing ? handleUpdate : handleCreate} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
            <button onClick={() => { setShowForm(false); setEditing(null); }} disabled={saving}
              className="px-4 py-2 bg-gray-300 dark:bg-gray-600 rounded disabled:opacity-50">取消</button>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        {semesters.map(s => (
          <div key={s.id} className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-800 rounded">
            <div>
              <span className="font-bold">{s.name}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                ({TYPES.find(t => t.value === s.type)?.label || s.type}) {s.startDate} ~ {s.endDate}
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => startEdit(s)} disabled={saving}
                className="px-3 py-1 bg-gray-300 dark:bg-gray-600 rounded text-sm disabled:opacity-50">编辑</button>
              <button onClick={() => handleDelete(s.id)} disabled={saving}
                className="px-3 py-1 bg-red-600 text-white rounded text-sm disabled:opacity-50">删除</button>
            </div>
          </div>
        ))}
        {semesters.length === 0 && (
          <p className="text-gray-500 dark:text-gray-400">暂无学期，请先创建学期再使用批量排课</p>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
