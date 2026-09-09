import { afterEach, expect, it, vi } from 'vitest';

vi.mock('react', () => ({ useRef: current => ({ current }) }));
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
  touch.handleDayTouchStart({ touches: [{ clientX: 50, clientY: minute + 5 }] }, '2026-12-31');
  vi.advanceTimersByTime(450);
  expect(onCellClick).toHaveBeenCalledExactlyOnceWith(date, time);
});
