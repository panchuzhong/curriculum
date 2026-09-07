import { describe, it, expect, vi } from 'vitest';

vi.mock('react', () => ({ useEffect: (fn) => fn() }));
const { default: useSwipeNavigation } = await import('../useSwipeNavigation.js');

const INITIAL_OFFSET = -(7 / 21 * 100);

function setup() {
  const listeners = {};
  const style = { props: {}, setProperty(k, v) { this.props[k] = v; }, getPropertyValue(k) { return this.props[k] || ''; } };
  const el = { style, offsetWidth: 700, addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener() {} };
  const settled = [];
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
  globalThis.cancelAnimationFrame = clearTimeout;
  useSwipeNavigation({
    gridRef: { current: el }, visibleDaysRef: { current: 7 },
    // Like useWeekNavigation, re-centre the grid once a gesture has settled.
    onSettleRef: { current: (d) => { settled.push(d); style.setProperty('--day-offset', `${INITIAL_OFFSET}%`); } },
    isInteractingRef: { current: false },
    constants: { TOTAL_COLS: 21, BUFFER: 7, INITIAL_OFFSET },
  });
  return { listeners, settled };
}
const T = (n, x, y = 0) => ({ touches: Array.from({ length: n }, () => ({ clientX: x, clientY: y })), preventDefault() {} });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fastSwipe(listeners) {
  listeners.touchstart(T(1, 300));
  for (let i = 1; i <= 6; i++) { listeners.touchmove(T(1, 300 - i * 20)); await sleep(10); }
  listeners.touchend({ touches: [] });
  await sleep(1500);
}

describe('useSwipeNavigation', () => {
  it('a fast one-finger swipe navigates forward', async () => {
    const { listeners, settled } = setup();
    await fastSwipe(listeners);
    expect(settled).toHaveLength(1);
    expect(settled[0]).toBeGreaterThan(0);
  });

  it('a two-finger tap after a swipe does not replay the previous gesture', async () => {
    const { listeners, settled } = setup();
    await fastSwipe(listeners);
    const before = settled.length;
    listeners.touchstart(T(2, 100));
    listeners.touchmove(T(2, 101, 1));
    listeners.touchend({ touches: [{ clientX: 100, clientY: 0 }] });
    listeners.touchend({ touches: [] });
    await sleep(1500);
    expect(settled.slice(before).filter(d => d !== 0)).toEqual([]);
  });

  it('a swipe cancelled by a second finger does not navigate', async () => {
    const { listeners, settled } = setup();
    listeners.touchstart(T(1, 300));
    // A fast 40px drag: momentum would carry it a cell, the drag itself stays put.
    for (let i = 1; i <= 4; i++) { listeners.touchmove(T(1, 300 - i * 10)); await sleep(10); }
    listeners.touchmove(T(2, 200));
    listeners.touchend({ touches: [{ clientX: 200, clientY: 0 }] });
    await sleep(1500);
    expect(settled.filter(d => d !== 0)).toEqual([]);
  });
});
