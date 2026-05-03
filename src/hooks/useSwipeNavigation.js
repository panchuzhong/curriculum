import { useEffect } from 'react';

export default function useSwipeNavigation({
  gridRef,
  visibleDaysRef,
  onSettleRef,
  isInteractingRef,
  constants: { TOTAL_COLS, BUFFER, INITIAL_OFFSET },
}) {
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const CELL_PCT = 100 / TOTAL_COLS;
    let offsetCells = 0; // positive = forward (later dates)
    let velocity = 0;    // cells/ms
    let rafId = null;

    // Read current offset from CSS custom property
    function readCSS() {
      const raw = el.style.getPropertyValue('--day-offset');
      if (!raw) return 0;
      const v = parseFloat(raw);
      if (isNaN(v)) return 0;
      return Math.round((INITIAL_OFFSET - v) / CELL_PCT * 1000) / 1000;
    }

    // Apply current offsetCells to CSS
    function apply() {
      el.style.setProperty('--day-transition', 'none');
      el.style.setProperty('--day-offset', `${INITIAL_OFFSET - offsetCells * CELL_PCT}%`);
    }

    // Animated snap to target cell (ease-out cubic)
    function easeTo(target, ms, cb) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      const start = offsetCells;
      const d = target - start;
      if (Math.abs(d) < 0.005) { offsetCells = target; apply(); cb?.(); return; }
      const t0 = performance.now();
      function tick(now) {
        const p = Math.min((now - t0) / ms, 1);
        offsetCells = start + d * (1 - Math.pow(1 - p, 3));
        apply();
        if (p < 1) rafId = requestAnimationFrame(tick);
        else { offsetCells = target; apply(); rafId = null; cb?.(); }
      }
      rafId = requestAnimationFrame(tick);
    }

    // Notify parent that interaction ended at this cell offset
    function settle() {
      const day = Math.round(offsetCells);
      velocity = 0;
      if (isInteractingRef) isInteractingRef.current = false;
      onSettleRef?.current?.(day);
    }

    // -- Touch state --
    let sx, sy, st, sOff;
    let locked, cancelled;
    let samples;
    let inhV;

    function onStart(e) {
      if (e.touches.length !== 1) return;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      inhV = velocity;                       // inherit from interrupted momentum
      offsetCells = readCSS();               // sync with actual DOM position
      if (isInteractingRef) isInteractingRef.current = true;

      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now();
      sOff = offsetCells;
      locked = false; cancelled = false;
      samples = [];
    }

    function onMove(e) {
      if (cancelled || e.touches.length !== 1) { cancelled = true; return; }
      const t = e.touches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;

      if (!locked) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        if (Math.abs(dy) > Math.abs(dx)) { cancelled = true; return; }
        locked = true;
      }
      e.preventDefault();

      samples.push({ x: t.clientX, t: Date.now() });
      if (samples.length > 12) samples.shift();

      const w = el.offsetWidth || 1;
      const dCells = -(t.clientX - sx) / (w / visibleDaysRef.current);
      let target = sOff + dCells;

      // Rubber-band at buffer edges
      if (Math.abs(target) > BUFFER) {
        const over = Math.abs(target) - BUFFER;
        target = Math.sign(target) * (BUFFER + over / (1 + over / 3));
      }

      offsetCells = target;
      apply();
    }

    function calcVelocity() {
      const w = el.offsetWidth || 1;
      const cpx = w / visibleDaysRef.current;
      const lt = samples.length ? samples[samples.length - 1].t : st;
      const rc = samples.filter(s => lt - s.t <= 100);
      let vp = 0;
      if (rc.length >= 2) {
        vp = (rc[rc.length - 1].x - rc[0].x) / Math.max(rc[rc.length - 1].t - rc[0].t, 1);
      } else if (samples.length) {
        vp = (samples[samples.length - 1].x - sx) / Math.max(lt - st, 16);
      }
      let v = -vp / cpx;
      // Accumulate speed from interrupted momentum
      if (inhV && v && Math.sign(inhV) === Math.sign(v)) v += inhV * 0.4;
      return v;
    }

    function onEnd() {
      if (!locked) { velocity = 0; settle(); return; }

      const v0 = calcVelocity();

      // Low velocity → snap to nearest cell
      if (Math.abs(v0) < 0.0003) {
        const nearest = Math.max(-BUFFER, Math.min(BUFFER, Math.round(offsetCells)));
        easeTo(nearest, 180, settle);
        return;
      }

      // Project landing position with reference glide
      const refMs = Math.max(300, Math.min(1100, Math.abs(v0) * 1500));
      const proj = offsetCells + v0 * refMs * 0.65;
      let tgt = v0 > 0 ? Math.ceil(proj) : Math.floor(proj);
      tgt = Math.max(-BUFFER, Math.min(BUFFER, tgt));

      // Guarantee at least 1 cell in swipe direction
      if (tgt === Math.round(offsetCells)) {
        const n = tgt + Math.sign(v0);
        if (Math.abs(n) <= BUFFER) tgt = n;
      }

      if (Math.abs(tgt - offsetCells) < 0.01) {
        offsetCells = tgt; apply(); settle(); return;
      }

      // Extend target for minimum glide duration
      const a0 = -(v0 * v0) / (2 * (tgt - offsetCells));
      if (Math.abs(v0 / a0) < 250) {
        const n = tgt + Math.sign(v0);
        if (Math.abs(n) <= BUFFER) tgt = n;
      }

      startMomentum(v0, tgt);
    }

    function startMomentum(v0, tgt) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      const d = tgt - offsetCells;
      if (Math.abs(d) < 0.005) { offsetCells = tgt; apply(); settle(); return; }

      const a = -(v0 * v0) / (2 * d);
      let v = v0;
      let lt = performance.now();

      function tick(now) {
        const dt = Math.min(now - lt, 50);
        lt = now;
        const nv = v + a * dt;

        // Velocity crossed zero → reached target
        if ((a > 0 && nv >= 0) || (a < 0 && nv <= 0)) {
          offsetCells = tgt; apply(); velocity = 0; rafId = null; settle(); return;
        }

        offsetCells += (v + nv) / 2 * dt;
        v = nv; velocity = v;
        offsetCells = Math.max(-BUFFER - 0.5, Math.min(BUFFER + 0.5, offsetCells));
        apply();
        rafId = requestAnimationFrame(tick);
      }

      rafId = requestAnimationFrame(tick);
    }

    function onCancel() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      velocity = 0;
      offsetCells = Math.max(-BUFFER, Math.min(BUFFER, Math.round(offsetCells)));
      apply();
      settle();
    }

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, []);
}
