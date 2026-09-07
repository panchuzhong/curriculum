import { describe, it, expect } from 'vitest';
import { fitDeviceScaleFactor } from '../services/image-helpers.js';

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
