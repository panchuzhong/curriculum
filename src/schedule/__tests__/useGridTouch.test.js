import { afterEach, expect, it, vi } from 'vitest';

vi.mock('react', () => ({ useRef: current => ({ current }), useEffect: vi.fn() }));
const { default: useGridTouch } = await import('../useGridTouch.js');

afterEach(() => vi.useRealTimers());

it.each([
  [9 * 60, '2026-12-31', '09:00'],
  [23 * 60 + 50, '2027-01-01', '00:00'],
  [25 * 60 + 30, '2027-01-01', '01:30'],
])('long press at minute %s uses the matching calendar date', (minute, date, time) => {
  vi.useFakeTimers();
  const onCellClick = vi.fn();
  const touch = useGridTouch({
    gridStateRef: { current: { rowHeight: 60, topGapHeight: 5, firstLabelMin: 0, startHour: 0 } },
    onCellClick,
  });
  touch.dayBodyEls.current['2026-12-31'] = { getBoundingClientRect: () => ({ top: 0 }) };
  touch.handleDayTouchStart({ currentTarget: { isConnected: true }, touches: [{ clientX: 50, clientY: minute + 5 }] }, '2026-12-31');
  vi.advanceTimersByTime(450);
  expect(onCellClick).toHaveBeenCalledExactlyOnceWith(date, time);
});

it.each(['cancel', 'second touch', 'detached target'])('cancels a pending long press on %s', reason => {
  vi.useFakeTimers();
  const onPress = vi.fn();
  const touch = useGridTouch({});
  const finger = { clientX: 5, clientY: 5 };
  const currentTarget = { isConnected: true };
  touch.startPress({ currentTarget, touches: [finger] }, 300, onPress);
  if (reason === 'cancel') touch.cancelPress();
  if (reason === 'second touch') touch.startPress({ currentTarget, touches: [finger, finger] }, 300, onPress);
  if (reason === 'detached target') currentTarget.isConnected = false;
  vi.advanceTimersByTime(500);
  expect(onPress).not.toHaveBeenCalled();
});
