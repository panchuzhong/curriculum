import { describe, it, expect } from 'vitest';
import { fitDeviceScaleFactor, planMonthlyCapture } from '../services/image-helpers.js';

// Chromium returns blank pixels (or throws) once a screenshot exceeds roughly
// 1.3e8 device pixels; a 4x monthly export went blank after about 7 months.
describe('fitDeviceScaleFactor', () => {
  it('keeps the requested factor when the capture fits', () => {
    expect(fitDeviceScaleFactor(4, 1164, 1100 * 5)).toBe(4);
  });

  it('lowers the factor for a 12-month monthly export', () => {
    const dsf = fitDeviceScaleFactor(4, 1164, 1100 * 12);
    expect(dsf).toBeLessThan(4);
    expect(1164 * 1100 * 12 * dsf * dsf).toBeLessThanOrEqual(1.2e8);
  });

  it('never drops below 1', () => {
    expect(fitDeviceScaleFactor(4, 1164, 1100 * 200)).toBe(1);
  });
});

// 月度分块导出的取图倍率必须「提前」算好：先按 4 倍截 24 个月再整体降到 0.27，
// 浏览器要渲染、编码、传输、解码约 14 倍于交付图像的像素再扔掉 93%。
// 交付尺寸不变的前提下，截图倍率本身就该是那个 0.27。
describe('planMonthlyCapture', () => {
  it('单月不降采样，按请求的 4 倍取图', () => {
    const plan = planMonthlyCapture([1053]);
    expect(plan.outScale).toBe(1);
    expect(plan.captureScale).toBe(4);
  });

  it('24 个月直接按降采样后的倍率取图，而不是先截 4 倍', () => {
    const heights = Array.from({ length: 24 }, () => 1053);
    const plan = planMonthlyCapture(heights);
    expect(plan.fullHeight).toBeGreaterThan(32000);
    expect(plan.outScale).toBeLessThan(1);
    expect(plan.captureScale).toBeCloseTo(4 * plan.outScale, 10);
    // 取图像素总量 ≈ 交付像素总量，不应出现 14 倍的浪费
    const captured = heights.reduce((h, x) => h + Math.ceil(x * plan.captureScale), 0);
    expect(captured).toBeLessThanOrEqual(32000 + 24);
  });

  it.each([2, 24])('%s 个月缩放后仍保持 24 CSS px 的总间距', count => {
    const plan = planMonthlyCapture(Array(count).fill(1053));
    const padGapPx = Math.max(0, plan.gapPx - 20 * plan.captureScale);
    // 若把整段 24px 再加到两块的 padding 上，相邻月之间就变成 44px
    expect(padGapPx / plan.captureScale).toBeCloseTo(4);
    expect(plan.gapPx / plan.captureScale).toBeCloseTo(24);
  });
});
