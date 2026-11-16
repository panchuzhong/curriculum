
// ── Theme detection ─────────────────────────────────────────────
export function isDarkTheme(theme) {
  const hour = new Date().getHours();
  return theme === 'dark' ? true : theme === 'light' ? false : (hour < 7 || hour >= 19);
}

// ── Browser page lifecycle ──────────────────────────────────────
// Chromium silently paints nothing (or throws) once a screenshot exceeds
// roughly 1.3e8 device pixels — a 4x monthly export went blank after about
// seven months — so the scale factor is lowered, in half steps, until it fits.
const MAX_DEVICE_PIXELS = 1.2e8;
export function fitDeviceScaleFactor(requested, cssWidth, cssHeight) {
  const fit = Math.floor(Math.sqrt(MAX_DEVICE_PIXELS / (cssWidth * cssHeight)) * 2) / 2;
  return Math.min(requested, Math.max(1, fit));
}

// canvas.toDataURL returns "data:," once the bitmap exceeds the browser's
// maximum canvas height (Chromium starts failing around 50–65k px here).
// 24 months at 4x is ~118k px, so the stitched image is capped; the capture
// scale is derived from that same ratio (see below).
const MAX_CANVAS_HEIGHT = 32000;

// 纯计算，导出给单测：先量出各月 CSS 高度，再决定每月按多大倍率截图。
// 24 个月若一律按 4 倍截再整体降到 0.27 倍，浏览器要渲染、编码、传输、
// 解码大约 14 倍于交付图像的像素，然后扔掉其中 93%——既慢又费内存。
// 这里把「最终一定会降采样」提前到截图那一步，交付尺寸完全一样。
export function planMonthlyCapture(cssHeights, { deviceScaleFactor = 4, monthGap = 24, maxCanvasHeight = MAX_CANVAS_HEIGHT } = {}) {
  const gapPx = monthGap * deviceScaleFactor;
  const fullHeight = cssHeights.reduce((h, x) => h + Math.ceil(x * deviceScaleFactor), 0)
    + gapPx * Math.max(0, cssHeights.length - 1);
  const outScale = fullHeight > maxCanvasHeight ? maxCanvasHeight / fullHeight : 1;
  return {
    fullHeight,
    outScale,
    captureScale: deviceScaleFactor * outScale,
    gapPx,
  };
}

// 按月分块截图再拼接，而不是整页截一张：
//   · 整页截图的高度有 Chromium 上限，超过就整张空白（6017e91）；
//   · 24 个月的整页 RGBA 表面加上浏览器副本是数百 MiB，小内存机器会被 OOM。
// 每月一块，任何时刻只有一块原始截图和解码后的位图活着。
//
// 间距：每月文档自带上下各 10px 的 body padding，所以相邻两月的内容间距
// 本来就是 20px；monthGap 是「目标总间距」，拼接时只补差额（24-20=4px），
// 否则两个月的图会隔出 44px 而不是原来的 24px。
export async function withStackedMonthPages(months, { bg, totalWidth, deviceScaleFactor = 4, monthGap = 24 }) {
  const { getBrowser } = await import('./browser.js');
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // 第一遍：只量高度，不截图。setContent 很便宜，贵的是截图与编码。
    await page.setViewport({ width: totalWidth, height: 800, deviceScaleFactor: 1 });
    const cssHeights = [];
    for (const m of months) {
      await page.setContent(m.html, { waitUntil: 'load', timeout: 30000 });
      cssHeights.push(await page.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height)));
    }
    const plan = planMonthlyCapture(cssHeights, { deviceScaleFactor, monthGap });
    const { captureScale, outScale, gapPx } = plan;
    // 每块图里已经带着上下各 10 CSS px 的 body padding，相邻两块之间本来就有
    // 20 CSS px；要凑到 monthGap，只补差额，不能整段再加一遍。
    const padGapPx = Math.max(0, gapPx - 20 * captureScale);

    // 第二遍：逐月截图，base64 留在 Node 侧。此时浏览器里没有拼接用的 canvas，
    // 渲染进程只要扛得住「一个月」的表面。
    const chunks = [];
    for (let i = 0; i < months.length; i++) {
      await page.setContent(months[i].html, { waitUntil: 'load', timeout: 30000 });
      await page.setViewport({ width: totalWidth, height: 800, deviceScaleFactor: captureScale });
      const buf = await page.screenshot({
        type: 'png', timeout: 30000,
        clip: { x: 0, y: 0, width: totalWidth, height: cssHeights[i] },
      });
      chunks.push(`data:image/png;base64,${Buffer.from(buf).toString('base64')}`);
    }

    // 第三遍才在同一个页面里拼。不能另开一个页面边截边拼：那样截图页的表面和
    // 拼接页的 canvas 同时活着，内存翻倍——三个月就在渲染进程里 OOM 了
    // （Page.captureScreenshot: Target closed）。这里任何时刻只有一份大表面，
    // 逐块 decode 再画，块本身随每次 evaluate 结束释放。
    await page.setContent('<!DOCTYPE html><html><body></body></html>', { waitUntil: 'load' });
    const canvasWidth = Math.max(1, Math.round(totalWidth * captureScale));
    const canvasHeight = Math.max(1, Math.round(plan.fullHeight * outScale));
    const stitched = await page.evaluate(async ({ urls, width, height, bg, padGapPx }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      let y = 0;
      for (let i = 0; i < urls.length; i++) {
        const img = new Image();
        img.src = urls[i];
        await img.decode();
        if (i > 0) y += padGapPx;
        ctx.drawImage(img, 0, Math.round(y));
        y += img.height;
        urls[i] = null; // 释放这一块，下一块再解码
      }
      return canvas.toDataURL('image/png').split(',')[1];
    }, { urls: chunks, width: canvasWidth, height: canvasHeight, bg, padGapPx });
    if (!stitched) throw new Error('月度课表导出失败：浏览器未能合成图片');
    return Buffer.from(stitched, 'base64');
  } finally {
    // A page that died with the browser throws on close; keep the real error.
    await page.close().catch(() => {});
  }
}

export async function withBrowserPage(html, viewport, clipFn) {
  const { getBrowser } = await import('./browser.js');
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.setViewport({ ...viewport, isMobile: !!viewport.isMobile });
    const opts = { type: 'png', timeout: 30000 };
    if (clipFn) opts.clip = await clipFn(page);
    const requested = viewport.deviceScaleFactor ?? 1;
    const cssHeight = opts.clip?.height ?? await page.evaluate(() => document.documentElement.scrollHeight);
    const dsf = fitDeviceScaleFactor(requested, opts.clip?.width ?? viewport.width, cssHeight);
    if (dsf !== requested) await page.setViewport({ ...viewport, deviceScaleFactor: dsf, isMobile: !!viewport.isMobile });
    const buf = await page.screenshot(opts);
    return Buffer.from(buf);
  } finally {
    // A page that died with the browser throws on close; keep the real error.
    await page.close().catch(() => {});
  }
}
