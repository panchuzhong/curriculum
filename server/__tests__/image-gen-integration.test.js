import { describe, it, expect, afterAll } from 'vitest';
import { generateScheduleImage } from '../services/image-gen.js';
import { closeBrowser } from '../services/browser.js';

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
});
