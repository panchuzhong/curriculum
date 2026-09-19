import { useState, useEffect, useRef } from 'react';
import { todayStr, fmt, isUsableDate, dateRangeError, clampDate, DATE_INVALID_HINT } from '../utils/date';
import { DATE_MIN, DATE_MAX } from '../utils/constants';
import { api } from '../api';
import { useToast } from '../components/ToastProvider';
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap';
import { useBackdropClose } from '../hooks/useBackdropClose';

// 与服务端 validateBatchCreate 的 `dates 最多 365 项` 保持一致。
export const MAX_BATCH_DATES = 365;

const WEEKDAY_OPTIONS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
];

// Preselect the semester the teacher is most likely to schedule into: the one
// in progress, else the one starting soonest. Returns null when every semester
// has ended, so the dialog keeps asking rather than defaulting to a dead range.
//
// Two semesters can be in progress at once: the server's overlap check is
// half-open (a term may start the day another ends) while every date range here
// is inclusive, so they both contain the shared boundary date. Prefer the one
// that just started — the other ends today and would leave a single day to
// schedule into. GET /api/semesters has no ORDER BY, so both branches sort
// explicitly rather than trusting the response order.
export function pickDefaultSemesterId(semesters, today) {
  const byStartDesc = (a, b) => b.startDate.localeCompare(a.startDate) || a.id - b.id;
  const byStartAsc = (a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id;
  const ongoing = semesters
    .filter(s => s.startDate <= today && today <= s.endDate)
    .sort(byStartDesc)[0];
  if (ongoing) return ongoing.id;
  const upcoming = semesters
    .filter(s => s.startDate > today)
    .sort(byStartAsc)[0];
  return upcoming ? upcoming.id : null;
}

export default function BatchScheduleDialog({ onClose, onSaved }) {
  const toast = useToast();
  const dialogRef = useRef(null);
  useDialogFocusTrap(dialogRef);
  const backdrop = useBackdropClose(onClose);

  const [classes, setClasses] = useState([]);
  const [semesters, setSemesters] = useState([]);
  // 学期列表到达前 selectedSemester 必然是 undefined。不区分「还没加载完」和
  // 「加载完了但没选」的话，每次打开弹窗都会先闪一下红字「请先选择学期」——
  // 而下一瞬 pickDefaultSemesterId 就把它选上了。报一个根本不是错的状态。
  // 失败也算加载完（真的取不到学期，那就该说「请先选择学期」）。
  const [semestersLoaded, setSemestersLoaded] = useState(false);
  const [op, setOp] = useState('create'); // create | delete
  const [mode, setMode] = useState('semester'); // semester | dates
  const [result, setResult] = useState(null);
  const [rangeStart, setRangeStart] = useState(todayStr());
  const [rangeEnd, setRangeEnd] = useState('');
  const [rangeStep, setRangeStep] = useState(1);
  const [previewCount, setPreviewCount] = useState(null);
  const [previewHint, setPreviewHint] = useState('');
  const previewGeneration = useRef(0);

  function resetPreview() {
    previewGeneration.current++;
    setPreviewCount(null);
    setPreviewHint('');
  }
  function invalidateConfirmation() {
    resetPreview();
    setCrossSemester(false);
  }
  function changeOperation(nextOp) {
    setOp(nextOp);
    invalidateConfirmation();
  }
  function changeMode(nextMode) {
    setMode(nextMode);
    invalidateConfirmation();
  }
  const [delStart, setDelStart] = useState(todayStr());
  const [delEnd, setDelEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [crossSemester, setCrossSemester] = useState(false);
  // 截断的提示不能只靠 toast：它 3 秒后就没了，而截断后的 365 个日期本身是合法输入，
  // 错过提示的人会直接提交，以为排完了整个区间。
  const [truncateNote, setTruncateNote] = useState('');
  const [form, setForm] = useState({
    classId: '',
    semesterId: '',
    weekday: 1,
    startTime: '08:00',
    endTime: '10:00',
    durationBilling: '',
    dates: '',
  });

  useEffect(() => {
    api.getClasses().then(setClasses).catch(e => toast(e.message || '加载班级失败'));
    api.getSemesters().then(list => {
      setSemesters(list);
      const defaultId = pickDefaultSemesterId(list, todayStr());
      // Fill only an untouched field, so a choice made while loading survives.
      // 下面每个 onChange 都必须用函数式更新：写成 {...form, x} 的话，它闭包的是
      // 渲染那一刻的 form。学期列表恰好在这一刻之后到达、把 semesterId 填上，
      // 而用户在重渲前按下了班级下拉框的话，那个展开会把 semesterId 又写回 ''——
      // 下拉框里有选项却没选中任何一项，提交时只能报「请先选择学期」。
      if (defaultId != null) setForm(f => (f.semesterId ? f : { ...f, semesterId: String(defaultId) }));
    }).catch(e => toast(e.message || '加载学期失败'))
      .finally(() => setSemestersLoaded(true));
  }, []);

  const selectedSemester = semesters.find(s => s.id === +form.semesterId);

  // 学期模式的操作区间：从今天（或学期开始，取晚的）到学期结束。
  function semesterRange(semester) {
    const today = todayStr();
    return {
      start: today > semester.startDate ? today : semester.startDate,
      end: semester.endDate,
    };
  }

  function generateRangeDates() {
    // 间隔来自一个只有正数选项的 select，这一步今天走不到；但它是防循环不推进的守卫，
    // 留着就得和这个函数里其它分支一样能说出理由，而不是默默返回。
    if (rangeStep <= 0) { toast('间隔须大于 0 天'); return; }
    // 循环的上界完全取自输入框：年份打到一半（0002）就点生成，会从那一年一天天
    // 走到结束日期，几十万个日期直接塞进输入框。用不了的区间一律当输入错误；
    // 倒挂的区间也得说一声，否则循环一次都不跑，只看到输入框被清空。
    const error = dateRangeError(rangeStart, rangeEnd);
    if (error) {
      toast(error);
      return;
    }
    const dates = [];
    const d = new Date(rangeStart + 'T00:00:00');
    const end = new Date(rangeEnd + 'T00:00:00');
    // 上下限之内也可能是几十年的跨度（1900 ~ 2999 逐日就是 40 万个日期）。
    // 服务端一次最多收 MAX_BATCH_DATES 个，先在这里封顶，不然主线程会先拼出
    // 一个几 MB 的字符串再被整单打回。截断而不是丢弃：前 365 个日期本身是对的，
    // 丢弃的话提示说「最多生成 365 个」，输入框却纹丝不动。
    while (d <= end && dates.length < MAX_BATCH_DATES) {
      dates.push(fmt(d));
      d.setDate(d.getDate() + rangeStep);
    }
    setForm(f => ({ ...f, dates: dates.join(', ') }));
    invalidateConfirmation();
    if (d <= end) {
      const note = `一次最多生成 ${MAX_BATCH_DATES} 个日期，已截断到 ${dates[dates.length - 1]}`;
      setTruncateNote(note);
      toast(note);
    } else {
      setTruncateNote('');
    }
  }

  const semesterDelRange = selectedSemester ? semesterRange(selectedSemester) : null;
  // 学期行自己的起止日期可能是旧服务端收下的越界值。排课和删课都要拦：
  // 服务端会 400，不拦的话这边还写着「从 X 起排课」，承诺一个做不成的操作。
  //
  // 判的是两个操作真正用到的区间端点（开始已经取过今天），和服务端一致；
  // 不用 dateRangeError，因为已结束的学期这个区间必然倒挂，那不是日期错。
  const semesterDateError = !semesterDelRange ? null
    : (!isUsableDate(semesterDelRange.start) || !isUsableDate(semesterDelRange.end)) ? DATE_INVALID_HINT
    // 学期行可能本身就是倒挂的（还原不校验学期日期）。那是数据坏了，
    // 不是「已经结束」——两者算出来都是 start > end，说法得分开。
    : selectedSemester.startDate > selectedSemester.endDate ? '开始日期晚于结束日期'
    : null;
  // 已经结束的学期：区间必然倒挂，服务端会老实地返回 0 条。但一个不可撤销的
  // 操作没必要把人领进「将删除 0 条排课，操作不可撤销」的确认流程，红框里已经说清楚了。
  // 日期范围模式专用；之前写成一个按 mode 分支的 deleteRangeError，而它的学期分支
  // 根本没人读——学期模式走的是 semesterDateError。
  const dateModeError = dateRangeError(delStart, delEnd);
  const semesterEnded = mode === 'semester' && !!selectedSemester && !semesterDateError
    && selectedSemester.endDate < todayStr();
  // 「为什么不能做」每侧只算一次，且直接算成一句完整的话：提示、按钮禁用态、
  // handleSubmit 的拦截读的都是同一个值。各算各的话就会出现按钮亮着、点下去
  // 又报一句跟原因无关的话——这个弹窗在这上面栽过好几次。
  const endedMsg = (what) => `「${selectedSemester.name}」已经结束，从今天起没有可${what}。`;

  // 加载期间不报错，但也不能放行：还不知道会不会自动选上学期，这个窗口里提交
  // 会把 semesterId: +'' === 0 发出去，换回一句服务端的硬错。按钮置灰、但不配红字。
  const semesterPending = mode === 'semester' && !semestersLoaded;

  const createBlocked = !(op === 'create' && mode === 'semester') ? null
    : !semestersLoaded ? null
    : !selectedSemester ? '请先选择学期'
    : semesterDateError ? `${semesterDateError}。请先修正该学期的起止日期。`
    : semesterEnded ? endedMsg('排课的日期')
    : null;

  // 日期范围模式下「没填完」被 dateRangeError 盖住、按钮置灰；学期模式下「没选学期」
  // 是同一回事，不能一个置灰一个亮着等着弹提示。
  const deleteBlocked = op !== 'delete' ? null
    : mode === 'semester'
      ? (!semestersLoaded ? null
        : !selectedSemester ? '请先选择学期'
        : semesterDateError ? `${semesterDateError}。请先修正该学期的起止日期，再预览要删除的排课。`
        : semesterEnded ? endedMsg('删除的排课')
        : null)
      : (dateModeError ? `${dateModeError}。请先修正日期范围，再预览要删除的排课。` : null);

  // 删除不可撤销，两种模式的区间都要拦：日期框的年份会被原生控件左移成 0261，
  // 学期行则可能是旧服务端收下的越界值——两种都会把删除范围从本意的那几周
  // 悉数扩到该班历史上的全部排课。
  //
  // 不再自己判一遍：按钮的禁用态、红框里的话和这里必须是同一个结论。各算各的话，
  // 就会出现按钮亮着、点下去又永远报一句跟原因无关的话这种事。
  function getDeleteRange() {
    if (deleteBlocked) return null;
    if (mode === 'semester') return semesterDelRange;
    return { start: delStart, end: delEnd };
  }

  async function handlePreviewDelete() {
    // 按钮一直是可点的，没选班级/学期时如果默默返回，点下去就像页面卡死了。
    if (!form.classId) { toast('请先选择班级'); return; }
    const range = getDeleteRange();
    if (!range) {
      toast(deleteBlocked || '删除范围无效');
      return;
    }
    const generation = ++previewGeneration.current;
    try {
      // Use the same dryRun code path as the actual delete so the preview
      // matches what will really be removed (incl. semester filtering).
      const res = await api.batchDeleteSchedules({
        classId: +form.classId,
        start: range.start,
        end: range.end,
        dryRun: true,
      });
      if (generation !== previewGeneration.current) return;
      setPreviewCount(res.count);
      // 界面里没有 semesterOnly 这个开关（它只是接口参数），所以不能让提示去教
      // 用户"设置 semesterOnly=false"——那是一条他在这个弹窗里走不通的路。
      // 学期过滤只在"一部分在学期内、一部分在学期外"时才生效（见服务端
      // filterBySemesters 的注释），全部在学期外时根本不过滤。所以对界面用户来说，
      // 真正可行的办法是把范围缩到学期之外，单独处理那一段。
      // 给 API 调用方的那句 semesterOnly=false 仍由服务端的 resp.hint 提供。
      setPreviewHint(res.semesterFiltered
        ? `另有 ${res.semesterFiltered} 条因不在当前学期内不会删除（把日期范围缩到学期之外，可单独删这部分）`
        : '');
    } catch (e) {
      if (generation === previewGeneration.current) toast(e.message || '查询失败');
    }
  }

  async function handleSubmit() {
    if (saving) return;
    if (!form.classId) { toast('请先选择班级'); return; }
    setSaving(true);
    try {
      if (op === 'create') {
        if (!form.startTime || !form.endTime) { toast('请先填写上课时间'); return; }
        const body = {
          classId: +form.classId,
          startTime: form.startTime,
          endTime: form.endTime,
          durationBilling: form.durationBilling !== '' ? +form.durationBilling : undefined,
          crossSemester: crossSemester || undefined,
        };
        if (mode === 'semester') {
          // 已经结束的学期从今天起没有任何可排的日期，服务端只会回一句生硬的
          // No valid dates to schedule。和删课那边一样，在这里就说清楚。
          if (createBlocked) { toast(createBlocked); return; }
          body.semesterId = +form.semesterId;
          body.weekday = form.weekday;
        } else {
          const dates = form.dates.split(/[,，\s]+/).map(d => d.trim()).filter(Boolean);
          if (dates.length === 0) { toast('请先生成或填写日期列表'); return; }
          // 生成的那条路会就地截断到 MAX_BATCH_DATES 并说一声，手敲/粘贴的这条不拦的话
          // 就要跑一趟服务端才换回一句「dates 须为数组,最多 365 项」。两条路得一致。
          if (dates.length > MAX_BATCH_DATES) {
            toast(`一次最多排 ${MAX_BATCH_DATES} 个日期，当前有 ${dates.length} 个`);
            return;
          }
          // 日期列表可以手敲、可以粘贴，不经过日期输入框：0261-01-01 服务端照收，
          // 存进去之后所有视图都按区间查询，这批排课再也看不到、删不掉。
          const bad = dates.filter(d => !isUsableDate(d));
          if (bad.length > 0) {
            toast(`${DATE_INVALID_HINT}：${bad.slice(0, 3).join('、')}${bad.length > 3 ? ' 等' : ''}`);
            return;
          }
          body.dates = dates;
        }
        const res = await api.batchSchedules(body);
        setResult({ op: 'create', count: res.count, holidayDataMissing: res.holidayDataMissing });
      } else {
        // delete mode
        const range = getDeleteRange();
        if (!range) { toast(deleteBlocked || '删除范围无效'); return; }
        const res = await api.batchDeleteSchedules({ classId: +form.classId, start: range.start, end: range.end });
        setResult({ op: 'delete', count: res.count });
      }
    } catch (e) {
      if (e.crossSemester && !crossSemester) {
        setCrossSemester(true);
      } else {
        toast(e.message || '操作失败');
      }
    }
    finally { setSaving(false); }
  }

  const sel = 'w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-3"
      {...backdrop}
      role="dialog" aria-modal="true" aria-label="批量排课">
      <div ref={dialogRef} tabIndex={-1} className="modal-enter bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-6 w-full max-w-[500px] max-h-[90vh] overflow-auto thin-scroll shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">批量操作</h3>
          <button onClick={onClose} aria-label="关闭" className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-sm transition-colors leading-none">✕</button>
        </div>

        {!result ? (
          <div className="space-y-3">
            {/* 操作类型 */}
            <div className="flex gap-2">
              <button onClick={() => changeOperation('create')}
                className={`flex-1 p-2 rounded font-medium ${op === 'create' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
                批量排课
              </button>
              <button onClick={() => changeOperation('delete')}
                className={`flex-1 p-2 rounded font-medium ${op === 'delete' ? 'bg-red-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
                批量删课
              </button>
            </div>

            {/* 班级 */}
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">选择班级</label>
              <select className={sel} value={form.classId} onChange={e => { setForm(f => ({ ...f, classId: e.target.value })); invalidateConfirmation(); }}>
                <option value="">-- 请选择 --</option>
                {classes.map(c => (
                  <option key={c.id} value={c.id}>{c.isCompetition ? '★ ' : ''}{c.name} ({c.grade} {c.subject})</option>
                ))}
              </select>
            </div>

            {/* 模式 */}
            <div className="flex gap-2">
              <button onClick={() => changeMode('semester')}
                className={`flex-1 p-2 rounded ${mode === 'semester' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
                学期模式
              </button>
              <button onClick={() => changeMode('dates')}
                className={`flex-1 p-2 rounded ${mode === 'dates' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
                {op === 'delete' ? '日期范围' : '指定日期'}
              </button>
            </div>

            {mode === 'semester' && (
              <>
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">选择学期（必填，自动跳过节假日）</label>
                  <select className={sel} value={form.semesterId} onChange={e => { setForm(f => ({ ...f, semesterId: e.target.value })); invalidateConfirmation(); }}>
                    <option value="">-- 请选择 --</option>
                    {semesters.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.startDate} ~ {s.endDate})</option>
                    ))}
                  </select>
                </div>
                {op === 'create' && (
                  <div>
                    <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">每周几上课</label>
                    <select className={sel} value={form.weekday} onChange={e => { setForm(f => ({ ...f, weekday: +e.target.value })); invalidateConfirmation(); }}>
                      {WEEKDAY_OPTIONS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                    </select>
                    {/* 不能套在 selectedSemester 里：没选学期正是 createBlocked 的一种，套起来的话
                        按钮置灰而屏上一句话没有——没建过学期的老师一打开就是这个样子。 */}
                    {createBlocked ? (
                      <p className="mt-1 text-xs text-red-500">{createBlocked}</p>
                    ) : selectedSemester ? (
                      <p className="mt-1 text-xs text-gray-400">
                        从 {semesterDelRange.start} 起排课
                      </p>
                    ) : null}
                  </div>
                )}
                {op === 'delete' && (
                  <p className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
                    {!semesterDelRange
                      ? '请选择学期，将删除该学期内从今天起该班级的全部排课，操作不可撤销。'
                      : deleteBlocked
                        || `删除「${selectedSemester.name}」学期内，${semesterDelRange.start} 至 ${semesterDelRange.end} 该班级的全部排课，操作不可撤销。`}
                  </p>
                )}
              </>
            )}

            {mode === 'dates' && op === 'create' && (
              <>
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 space-y-2">
                  <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">日期范围（自动生成）</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-0.5">开始</label>
                      <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} className={sel} value={rangeStart} onChange={e => {
                        setRangeStart(e.target.value);
                        // 越界/位数不对的日期喂给 new Date() 是 Invalid Date，
                        // fmt() 会把结束日期写成「NaN-NaN-NaN」，输入框直接变空。
                        // +9 天可能越过 DATE_MAX：不夹的话这个对话框会自己写出一个用户没打过的
                        // 越界日期，然后每次点「生成日期」都报日期无效。
                        if (isUsableDate(e.target.value) && (!rangeEnd || rangeEnd <= e.target.value)) {
                          const d = new Date(e.target.value + 'T00:00:00');
                          d.setDate(d.getDate() + 9);
                          setRangeEnd(clampDate(fmt(d)));
                        }
                      }} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-0.5">结束</label>
                      <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} className={sel} value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-400 mb-0.5">间隔</label>
                      <select className={sel} value={rangeStep} onChange={e => setRangeStep(+e.target.value)}>
                        <option value={1}>每天</option>
                        <option value={2}>隔天</option>
                        <option value={3}>隔两天</option>
                        <option value={7}>每周</option>
                      </select>
                    </div>
                    <button type="button" onClick={generateRangeDates}
                      className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 whitespace-nowrap">
                      生成日期
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">日期列表（可手动编辑）</label>
                  <textarea className={`${sel} h-24`} value={form.dates}
                    onChange={e => { setForm(f => ({ ...f, dates: e.target.value })); setTruncateNote(''); invalidateConfirmation(); }}
                    placeholder="2026-05-01, 2026-05-08, 2026-05-15" />
                  {truncateNote && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{truncateNote}</p>
                  )}
                </div>
              </>
            )}

            {mode === 'dates' && op === 'delete' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">开始日期</label>
                    <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} className={sel} value={delStart} onChange={e => { setDelStart(e.target.value); resetPreview(); }} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">结束日期</label>
                    <input type="date" lang="zh-CN" min={DATE_MIN} max={DATE_MAX} className={sel} value={delEnd} onChange={e => { setDelEnd(e.target.value); resetPreview(); }} />
                  </div>
                </div>
                <p className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
                  {/* 三种状态分开写：还没填完时仍要说清这个操作是什么、不可撤销（用户刚切到
                      删课页时看到的就是这句）；真的填错了才说怎么改。报错不能拼进「将删除…」
                      那句话里——「开始日期晚于结束日期，将删除…」读起来像是在确认这个非法区间
                      照样会被删。不可撤销的操作，用户读到的这句话就是唯一的保险丝。 */}
                  {!delStart || !delEnd
                    ? '请设置日期范围，将删除该范围内该班级的全部排课，操作不可撤销。'
                    : deleteBlocked
                      || `删除 ${delStart} 至 ${delEnd} 日期范围内该班级的全部排课，操作不可撤销。`}
                </p>
              </>
            )}

            {op === 'create' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">开始时间</label>
                  <input type="time" lang="zh-CN" className={sel} value={form.startTime}
                    onChange={e => { setForm(f => ({ ...f, startTime: e.target.value })); invalidateConfirmation(); }} />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">结束时间</label>
                  <input type="time" lang="zh-CN" className={sel} value={form.endTime}
                    onChange={e => { setForm(f => ({ ...f, endTime: e.target.value })); invalidateConfirmation(); }} />
                </div>
              </div>
            )}

            {op === 'create' && (
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">计费时长（分钟，留空自动计算）</label>
                <input type="number" className={sel} value={form.durationBilling}
                  onChange={e => { setForm(f => ({ ...f, durationBilling: e.target.value === '' ? '' : +e.target.value })); invalidateConfirmation(); }}
                  placeholder="默认由结束-开始时间计算" />
              </div>
            )}

            {crossSemester && op === 'create' && (
              <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-200">
                部分日期不在已定义的学期范围内，是否继续排课？
                <div className="flex gap-2 mt-2">
                  <button onClick={() => setCrossSemester(false)}
                    className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600">
                    取消
                  </button>
                  <button onClick={handleSubmit} disabled={saving}
                    className="px-3 py-1 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50">
                    {saving ? '处理中...' : '确认跨学期排课'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-4">
              {op === 'delete' ? (
                previewCount != null ? (
                  <>
                    {previewHint && (
                      <p className="w-full text-xs text-amber-600 dark:text-amber-400 text-center px-2">
                        {previewHint}
                      </p>
                    )}
                    <p className="flex-1 p-2 text-sm text-red-600 dark:text-red-400 font-medium text-center">
                      将删除 {previewCount} 条排课，操作不可撤销
                    </p>
                    <button onClick={handleSubmit} disabled={saving}
                      className="px-4 p-2 text-white bg-red-600 hover:bg-red-700 rounded disabled:opacity-50">
                      {saving ? '处理中...' : '确认'}
                    </button>
                    <button onClick={resetPreview} className="p-2 bg-gray-300 dark:bg-gray-600 rounded">取消</button>
                  </>
                ) : (
                  <>
                    <button onClick={handlePreviewDelete} disabled={!!deleteBlocked || semesterPending}
                      className="flex-1 p-2 text-white bg-red-600 hover:bg-red-700 rounded disabled:opacity-40">
                      预览删除
                    </button>
                    <button onClick={onClose} className="p-2 bg-gray-300 dark:bg-gray-600 rounded">取消</button>
                  </>
                )
              ) : (
                <>
                  <button onClick={handleSubmit} disabled={saving || !!createBlocked || semesterPending}
                    className="flex-1 p-2 text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50">
                    {saving ? '处理中...' : '批量排课'}
                  </button>
                  <button onClick={onClose} className="p-2 bg-gray-300 dark:bg-gray-600 rounded">取消</button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center">
            {result.op === 'create'
              ? <p className="text-lg mb-4">成功排课 {result.count} 次</p>
              : <p className="text-lg mb-4">已删除 {result.count} 条排课</p>
            }
            {result.holidayDataMissing?.length > 0 && (
              <p className="mb-4 text-sm text-amber-700 dark:text-amber-300">
                {result.holidayDataMissing.join('、')} 年没有节假日数据，本次排课未跳过节假日。
              </p>
            )}
            <button onClick={onSaved}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">完成</button>
          </div>
        )}
      </div>
    </div>
  );
}
