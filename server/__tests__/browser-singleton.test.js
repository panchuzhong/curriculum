import { describe, it, expect, vi, beforeEach } from 'vitest';

let launches;

vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn(async () => {
      const browser = { id: ++launches.count, connected: true, close: vi.fn(async () => {}) };
      launches.all.push(browser);
      // A real launch is not instantaneous; yielding here lets a second caller
      // interleave, which is exactly the window this test is about.
      await Promise.resolve();
      return browser;
    }),
  },
}));

async function loadBrowser() {
  vi.resetModules();
  launches = { count: 0, all: [] };
  return import('../services/browser.js');
}

describe('puppeteer browser singleton', () => {
  beforeEach(() => { launches = { count: 0, all: [] }; });

  it('reuses one browser across calls', async () => {
    const m = await loadBrowser();
    const [a, b] = await Promise.all([m.getBrowser(), m.getBrowser()]);
    expect(a).toBe(b);
    expect(launches.count).toBe(1);
  });

  // Chromium can die on its own (OOM is common on small servers). When two
  // image requests notice the dead browser at the same time, each used to
  // start its own replacement and the second overwrote the first — leaking a
  // Chromium process that nothing can ever close.
  it('launches exactly one replacement when concurrent callers see a dead browser', async () => {
    const m = await loadBrowser();
    const first = await m.getBrowser();
    first.connected = false;

    const [a, b] = await Promise.all([m.getBrowser(), m.getBrowser()]);
    expect(a).toBe(b);
    expect(launches.count).toBe(2);          // the original plus one replacement
    expect(launches.all).toHaveLength(2);    // no orphaned third browser
  });

  it('closeBrowser survives a failed launch instead of rejecting', async () => {
    vi.resetModules();
    launches = { count: 0, all: [] };
    const puppeteer = (await import('puppeteer')).default;
    puppeteer.launch.mockImplementationOnce(async () => { throw new Error('no chromium'); });
    const m = await import('../services/browser.js');
    await expect(m.getBrowser()).rejects.toThrow('no chromium');
    // SIGTERM handlers call this; an unhandled rejection here blocks shutdown.
    await expect(m.closeBrowser()).resolves.toBeUndefined();
  });
});
