import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { api } from '../api';
import { parseDateStr, todayStr, getMonday, addDays } from '../utils/date';
import useSwipeNavigation from '../hooks/useSwipeNavigation';
import { useToast } from '../components/ToastProvider';

const TOTAL_COLS = 21;
const BUFFER = 7;
const INITIAL_OFFSET = -(BUFFER / TOTAL_COLS * 100);
const ANIM_MS = 220;

function getAllDates(center) {
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

export default function useWeekNavigation({ searchParams }) {
  const toast = useToast();
  const [orient, setOrient] = useState(getOrientation);
  useEffect(() => {
    const onResize = () => setOrient(getOrientation());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isMobile = orient.mobile;
  const visibleDays = isMobile ? 2 : 7;

  const initialWeek = searchParams.get('week') || (() => {
    const { mobile } = getOrientation();
    return mobile ? todayStr() : getMonday(todayStr());
  })();

  const [weekStart, setWeekStart] = useState(initialWeek);
  const [allDates, setAllDates] = useState(() => getAllDates(initialWeek));
  const [allSchedules, setAllSchedules] = useState([]);

  const gridRef = useRef(null);
  const navLockRef = useRef(false);
  const centerRef = useRef(initialWeek);
  const isInteractingRef = useRef(false);
  const pendingSchedulesRef = useRef(null);
  const visibleDaysRef = useRef(visibleDays);
  visibleDaysRef.current = visibleDays;

  // Snap CSS to INITIAL_OFFSET when content changes (buffer swap)
  useLayoutEffect(() => {
    centerRef.current = allDates[BUFFER];
    if (!isInteractingRef.current) {
      snapToOffset(INITIAL_OFFSET);
    }
  }, [allDates]);

  useEffect(() => {
    api.getSchedules(allDates[0], allDates[TOTAL_COLS - 1])
      .then(setAllSchedules)
      .catch(e => toast(e.message || '加载课表失败'));
  }, []);

  function reload() {
    api.getSchedules(allDates[0], allDates[TOTAL_COLS - 1])
      .then(setAllSchedules)
      .catch(e => toast(e.message || '加载课表失败'));
  }

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

  async function animateToOffset(pct) {
    if (!gridRef.current) return;
    gridRef.current.style.setProperty('--day-transition', `transform ${ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`);
    await new Promise(r => requestAnimationFrame(r));
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
    centerRef.current = newCenter;
    setWeekStart(newCenter);
    const newDates = getAllDates(newCenter);
    flushSync(() => setAllDates(newDates));
    // useLayoutEffect has already snapped CSS to INITIAL_OFFSET
    api.getSchedules(newDates[0], newDates[TOTAL_COLS - 1])
      .then(safeSetSchedules)
      .catch(e => toast(e.message || '加载课表失败'));
  }

  // Animated button navigation (desktop prev/next, "today")
  async function navigateTo(newWeekStart) {
    if (navLockRef.current) return;
    const days = daysBetween(centerRef.current, newWeekStart);
    if (days === 0) return;

    if (Math.abs(days) <= BUFFER) {
      navLockRef.current = true;
      await animateToOffset(toOffset(BUFFER + days));
      navLockRef.current = false;
    }

    navigateToWeek(newWeekStart);
  }

  // Swipe settle callback: hook tells us how many cells forward the user scrolled
  const onSettleRef = useRef(null);
  onSettleRef.current = (dayOffset) => {
    applyPendingSchedules();
    if (dayOffset === 0) return;
    const newCenter = addDays(centerRef.current, dayOffset);
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
    navigateTo(target);
  }

  return {
    gridRef, weekStart, allDates, allSchedules, isMobile, visibleDays,
    navigateTo, goToThisWeek, reload,
  };
}
