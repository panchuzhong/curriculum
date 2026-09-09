import { describe, it, expect, afterAll, vi } from 'vitest';
import { generateScheduleImage } from '../services/image-gen.js';
import { generateMonthlyImage } from '../services/image-gen-monthly.js';
import { closeBrowser, getBrowser } from '../services/browser.js';

afterAll(async () => {
  await closeBrowser();
});

function makeClass(overrides = {}) {
  return {
    id: 1,
    name: '数学班',
    grade: '高三',
    subject: '数学',
    studentCount: 3,
    unitPrice: 200,
    discountAmount: 0,
    isCompetition: 0,
    ...overrides,
  };
}

function makeSchedule(overrides = {}) {
  return {
    id: 1,
    classId: 1,
    date: '2026-05-13',
    startTime: '09:00',
    endTime: '11:00',
    durationBilling: 120,
    locationName: '教室A',
    ...overrides,
  };
}

describe('generateScheduleImage (Puppeteer integration)', () => {
  it.each(['weekly', 'monthly'])('escapes restored time values in %s images', async view => {
    const browser = await getBrowser();
    const newPage = browser.newPage.bind(browser);
    const messages = [];
    const spy = vi.spyOn(browser, 'newPage').mockImplementation(async () => {
      const page = await newPage();
      page.on('console', message => messages.push(message.text()));
      return page;
    });
    try {
      const schedules = [{ ...makeSchedule({
        endTime: '11:00"><script>console.log("audit-render-executed")</script>',
      }), class: makeClass() }];
      if (view === 'weekly') await generateScheduleImage(schedules, '2026-05-11', '2026-05-17');
      else await generateMonthlyImage(schedules, 2026, 4);
      expect(messages).not.toContain('audit-render-executed');
    } finally {
      spy.mockRestore();
    }
  });

  it('renders a half-scale PNG at half the full-scale dimensions', async () => {
    const full = await generateScheduleImage([], '2026-05-11', '2026-05-17', { scale: 1 });
    const half = await generateScheduleImage([], '2026-05-11', '2026-05-17', { scale: 0.5 });
    expect(half.readUInt32BE(16)).toBe(Math.round(full.readUInt32BE(16) / 2));
    expect(half.readUInt32BE(20)).toBe(Math.round(full.readUInt32BE(20) / 2));
  });

  it('returns a valid PNG buffer for a week with schedules', async () => {
    const cls = makeClass();
    const scheds = [
      makeSchedule({ date: '2026-05-11', startTime: '09:00', endTime: '11:00' }),
      makeSchedule({ date: '2026-05-13', startTime: '14:00', endTime: '16:00' }),
    ].map(s => ({ ...s, class: cls }));

    const buf = await generateScheduleImage(scheds, '2026-05-11', '2026-05-17');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50); // P
    expect(buf[2]).toBe(0x4e); // N
    expect(buf[3]).toBe(0x47); // G
  });

  it('works with no schedules (empty week)', async () => {
    const buf = await generateScheduleImage([], '2026-05-11', '2026-05-17');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
  });

  it('works with theme=dark', async () => {
    const buf = await generateScheduleImage([], '2026-05-11', '2026-05-17', { theme: 'dark' });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });

  it('works with fractional rowH producing integer viewport', async () => {
    const cls = makeClass();
    const scheds = [makeSchedule({ startTime: '07:30', endTime: '23:30' })].map(s => ({ ...s, class: cls }));
    // rowH=33 produces fractional totalH — the exact bug scenario
    const buf = await generateScheduleImage(scheds, '2026-05-11', '2026-05-17', { rowH: 33 });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });

  it('works with conflicting schedules', async () => {
    const cls1 = makeClass({ id: 1, name: '数学班' });
    const cls2 = makeClass({ id: 2, name: '物理班', subject: '物理', grade: '高二' });
    const scheds = [
      { ...makeSchedule({ classId: 1, date: '2026-05-13', startTime: '09:00', endTime: '11:00' }), class: cls1 },
      { ...makeSchedule({ id: 2, classId: 2, date: '2026-05-13', startTime: '09:30', endTime: '11:30' }), class: cls2 },
    ];
    const buf = await generateScheduleImage(scheds, '2026-05-11', '2026-05-17');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });

  it('respects highlight parameter', async () => {
    const buf = await generateScheduleImage([], '2026-05-11', '2026-05-17', { highlight: '2026-05-13' });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });

  it('respects scale parameter', async () => {
    const buf = await generateScheduleImage([], '2026-05-11', '2026-05-17', { scale: 1 });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });

  it('falls back to the default scale for non-numeric scale instead of failing', async () => {
    // NaN used to leak into deviceScaleFactor and crash Puppeteer (HTTP 500)
    const buf = await generateScheduleImage([], '2026-05-11', '2026-05-17', { scale: 'abc' });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x89);
  });
});
