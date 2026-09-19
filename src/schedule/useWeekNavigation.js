import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { api } from '../api';
import { parseDateStr, todayStr, getMonday, addDays, isUsableDate, clampDate } from '../utils/date';
import { setViewDate } from '../utils/viewDate';
import useSwipeNavigation from '../hooks/useSwipeNavigation';
import { useToast } from '../components/ToastProvider';
import useBoundWarning from '../hooks/useBoundWarning';

const TOTAL_COLS = 21;
const BUFFER = 7;
const INITIAL_OFFSET = -(BUFFER / TOTAL_COLS * 100);
const ANIM_MS = 220;

export function getAllDates(center) {
  const start = addDays(center, -BUFFER);
  return Array.from({ length: TOTAL_COLS }, (_, i) => addDays(start, i));
}

function toOffset(colIndex) {
  return -(colIndex / TOTAL_COLS * 100);
}

function daysBetween(a, b) {
  return Math.round((parseDateStr(b) - parseDateStr(a)) / 86400000);
}

function getOrientation() {
  return { mobile: window.innerWidth < 768 };
}

export function dateParam(value) {
  // 位数、日历、上下限一起判：服务端的 isValidDate 带着同一对上下限，
  // ?week=1000-01-01 这种参数会让区间查询 400，整屏课表都没了。
  return isUsableDate(value) ? value : null;
}

// 前后各多取 BUFFER 天做缓冲，贴着上下限时这几天会越界。夹的是请求参数；
// 这些列在屏外，不影响看得见的那一段。
export function fetchRange(dates) {
  return [clampDate(dates[0]), clampDate(dates[TOTAL_COLS - 1])];
}

// 约束的是首列，不是整个可见窗口。一个 7 列的网格无法同时做到：整段不越界、
// 范围内每一天都可见、以及始终周一对齐——三选二。这里舍的是第一条：
//   舍可见性 → 桌面端看不到 2999-12-30/31；
//   舍周一对齐 → 边界那一周从周三开头，之后每次翻页都歪着；
//   舍「整段不越界」→ 最后一屏尾巴上多几个空格子。
// 选第三种：另外两种都要动用户真正依赖的性质，而多出来的那几个格子里
// 永远没有排课，点进去会被告知日期无效（见 WeeklySchedule 的 onCellClick），
// 抓取和导出则各自夹回合法区间。

export default function useWeekNavigation({ searchParams, setSearchParams }) {
  const toast = useToast();
  const [orient, setOrient] = useState(getOrientation);
  useEffect(() => {
    const onResize = () => setOrient(getOrientation());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isMobile = orient.mobile;
  const visibleDays = isMobile ? 2 : 7;

  const initialWeek = dateParam(searchParams.get('week')) || (() => {
    const selectedDate = dateParam(searchParams.get('date'));
    const { mobile } = getOrientation();
    if (selectedDate) return mobile ? selectedDate : getMonday(selectedDate);
    return mobile ? todayStr() : getMonday(todayStr());
  })();

  const [weekStart, setWeekStart] = useState(initialWeek);
  const [allDates, setAllDates] = useState(() => getAllDates(initialWeek));
  const [allSchedules, setAllSchedules] = useState([]);

  const gridRef = useRef(null);
  const navLockRef = useRef(false);
  const centerRef = useRef(initialWeek);
  const targetRef = useRef(initialWeek);
  const queuedTargetRef = useRef(null);
  const isInteractingRef = useRef(false);
  const pendingSchedulesRef = useRef(null);
  const fetchGenRef = useRef(0);
  const visibleDaysRef = useRef(visibleDays);
  visibleDaysRef.current = visibleDays;
  // 键盘翻页走到头时按钮是灰的、键盘却什么都不说，和页面卡死了没区别。
  // 长按方向键会连续触发，所以这条提示限流，不然一口气弹五条一模一样的。
  const warnAtBound = useBoundWarning();

  // Snap CSS to INITIAL_OFFSET when content changes (buffer swap)
  useLayoutEffect(() => {
    centerRef.current = allDates[BUFFER];
    if (!isInteractingRef.current) {
      snapToOffset(INITIAL_OFFSET);
    }
  }, [allDates]);

  function reload() {
    const gen = ++fetchGenRef.current;
    api.getSchedules(...fetchRange(allDates))
      .then(data => { if (mountedRef.current && gen === fetchGenRef.current) setAllSchedules(data); })
      .catch(e => { if (mountedRef.current && gen === fetchGenRef.current) toast(e.message || '加载课表失败'); });
  }

  // 首次拉取和 reload() 一模一样，写两份的话每次改都得改两处。
  useEffect(() => { reload(); }, []);

  function safeSetSchedules(schedules) {
    if (isInteractingRef.current) {
      pendingSchedulesRef.current = schedules;
    } else {
      setAllSchedules(schedules);
    }
  }

  function applyPendingSchedules() {
    if (pendingSchedulesRef.current !== null) {
      setAllSchedules(pendingSchedulesRef.current);
      pendingSchedulesRef.current = null;
    }
  }

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  async function animateToOffset(pct) {
    if (!gridRef.current) return;
    gridRef.current.style.setProperty('--day-transition', `transform ${ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`);
    await new Promise(r => requestAnimationFrame(r));
    if (!mountedRef.current || !gridRef.current) return;
    gridRef.current.style.setProperty('--day-offset', `${pct}%`);
    await new Promise(r => setTimeout(r, ANIM_MS + 16));
  }

  function snapToOffset(pct) {
    if (!gridRef.current) return;
    gridRef.current.style.setProperty('--day-transition', 'none');
    gridRef.current.style.setProperty('--day-offset', `${pct}%`);
  }

  // Instant buffer swap: update dates centered on newCenter, snap offset to 0
  function navigateToWeek(newCenter) {
    if (!mountedRef.current) return;
    setViewDate('week', newCenter);
    setSearchParams({ week: newCenter }, { replace: true });
    centerRef.current = newCenter;
    setWeekStart(newCenter);
    const newDates = getAllDates(newCenter);
    flushSync(() => setAllDates(newDates));
    // useLayoutEffect has already snapped CSS to INITIAL_OFFSET
    const gen = ++fetchGenRef.current;
    api.getSchedules(...fetchRange(newDates))
      .then(data => { if (mountedRef.current && gen === fetchGenRef.current) safeSetSchedules(data); })
      .catch(e => { if (mountedRef.current && gen === fetchGenRef.current) toast(e.message || '加载课表失败'); });
  }

  // Animated button navigation (desktop prev/next, "today")
  async function navigateTo(newWeekStart) {
    // 越界的一步直接不走，而不是夹到边界上：DATE_MAX（2999-12-31）是周二，
    // 夹过去之后桌面端的「上一周/下一周」按整周走，会一路周二到周二，
    // 周一~周日的格子再也对不齐（报表的 stepWeek 同理）。范围内最后几天
    // 仍可以用「后一天」逐天走到。
    //
    // 这里不弹提示是故意的：四个按钮都用 canStep 置了灰，
    // navigateByDays 自己先判并说清楚了原因（整周还是一天），goToThisWeek 和排队重放
    // 给的也一定在范围内——所以这一句是兜底，今天踩不到。
    // 新增调用方的话：要么把按钮置灰，要么自己先判再说一声，别指望这里提示；
    // 在这里统一弹一句话反而说不准——跨度是 1 天还是一整周，只有调用方知道。
    if (!isUsableDate(newWeekStart)) return;
    targetRef.current = newWeekStart;
    if (navLockRef.current) {
      queuedTargetRef.current = newWeekStart;
      return;
    }
    const days = daysBetween(centerRef.current, newWeekStart);
    if (days === 0) return;
    setViewDate('week', newWeekStart);

    if (Math.abs(days) <= BUFFER) {
      navLockRef.current = true;
      await animateToOffset(toOffset(BUFFER + days));
      navLockRef.current = false;
      // A touch that landed during the animation has taken over the grid; its
      // settle callback navigates from wherever the swipe ends, and committing
      // our pre-computed target on top of it would yank the grid back.
      if (isInteractingRef.current) return;
    }

    navigateToWeek(newWeekStart);

    const queuedTarget = queuedTargetRef.current;
    queuedTargetRef.current = null;
    if (queuedTarget && queuedTarget !== newWeekStart && mountedRef.current) {
      await navigateTo(queuedTarget);
    }
  }

  // Swipe settle callback: hook tells us how many cells forward the user scrolled
  const onSettleRef = useRef(null);
  onSettleRef.current = (dayOffset) => {
    applyPendingSchedules();
    if (dayOffset === 0) return;
    // 滑动是按天拖的，越过边界就停在范围内最后一天，而不是整个手势弹回原处：
    // 移动端隐藏了上一周/后一天按钮，滑动是唯一的走法，弹回就等于走不到最后一天。
    // （整周翻页不夹：那会把一个周步变成半个周步，见 navigateTo。）
    //
    // 平板横屏（≥768px）既是 7 列周视图、又能滑，夹到 2999-12-31（周二）后周步会一直歪着。
    // 但那不是夹造成的：本视图的滑动和「前一天/后一天」一样按格子走，从 2999-12-30
    // 滑一格同样落在周二。夹只影响「滑过头了」这一种，而它落在的位置本来就是小幅
    // 滑动能到的位置。要重新对齐，按「本周」。
    const newCenter = clampDate(addDays(centerRef.current, dayOffset));
    // 夹回原位时没有任何东西变了，再走一遍 navigateToWeek 就是白拉一次同样的区间
    // 加一次 flushSync（在边界上连滑几下就是几次）。但网格还停在手势结束的位置上，
    // 平时靠 allDates 变化触发的 useLayoutEffect 回弹，这里得自己来。
    //
    // 移动端隐藏了所有翻页按钮，滑动就是全部导航：只回弹不说话的话，和页面卡死了
    // 没区别。月/年视图的滑动走 prevMonth/changeYear，那边是会提示的。
    if (newCenter === centerRef.current) {
      // 这一句不能省：onSettle 的每条路都得让 targetRef 和 centerRef 对齐。
      // navigateTo 是先写 targetRef 再动画的，而动画期间落下一个手指会让它在
      // isInteractingRef 那里直接 return，navigateToWeek 没跑——centerRef 还是旧的、
      // targetRef 已经是新的。此时再滑一下被夹住走这条分支，不重新对齐的话，
      // 下一次方向键从 addDays(targetRef, ±1) 算起，网格会往回跳一格。
      targetRef.current = newCenter;
      snapToOffset(INITIAL_OFFSET);
      warnAtBound(`已到可用日期范围的${dayOffset < 0 ? '最早' : '最晚'}一天`);
      return;
    }
    targetRef.current = newCenter;
    setViewDate('week', newCenter);
    navigateToWeek(newCenter);
  };

  useSwipeNavigation({
    gridRef,
    visibleDaysRef,
    onSettleRef,
    isInteractingRef,
    constants: { TOTAL_COLS, BUFFER, INITIAL_OFFSET },
  });

  function goToThisWeek() {
    const target = isMobile ? todayStr() : getMonday(todayStr());
    const n = new Date();
    setViewDate('month', `${n.getFullYear()}-${n.getMonth()}`);
    setViewDate('year', String(n.getFullYear()));
    navigateTo(target);
  }

  function navigateByDays(days, { animate = true } = {}) {
    const target = addDays(targetRef.current, days);
    // 不夹：Ctrl+方向键一步跨 visibleDays 天，夹一下就把整周步变成了半个周步。
    if (!isUsableDate(target)) {
      // Ctrl+方向键一步跨 visibleDays 天（桌面 7、窄屏 2），被拒不等于到头了：
      // 站在 2999-12-25 时整周翻越界，而 12-26 到 12-31 都还走得到。两种情况得分开说，
      // 而且话不能写死成「一周」或者点名某个按钮——窄屏下跨度是 2 天，
      // 前一天/后一天两个按钮也根本不渲染。
      warnAtBound(Math.abs(days) === 1
        ? `已到可用日期范围的${days < 0 ? '最早' : '最晚'}一天`
        : `这一步跨 ${Math.abs(days)} 天，会超出可用日期范围`);
      return;
    }
    targetRef.current = target;
    if (animate) navigateTo(target);
    else navigateToWeek(target);
  }

  // Sync weekStart to viewDate store for cross-view navigation
  useLayoutEffect(() => {
    setViewDate('week', weekStart);
  }, [weekStart]);

  return {
    gridRef, weekStart, allDates, allSchedules, isMobile, visibleDays,
    navigateTo, navigateByDays, goToThisWeek, reload,
  };
}
