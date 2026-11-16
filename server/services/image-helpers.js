
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

// A single screenshot of a long export is not just a paint-size problem: the
// full-height RGBA surface (and its copies during PNG encoding) has to fit in
// memory at once. 24 months at the old floor of 1.5x was ~78M device pixels —
// roughly 300 MiB before the browser's own copies — on a small VPS that is an
// OOM kill. Screenshots are therefore taken one month at a time and stitched
// on a canvas inside the page, so no single capture exceeds a few megapixels
// and the requested scale factor never has to be lowered.
//
// monthGap is the CSS margin between consecutive month blocks (see
// image-gen-monthly.js); it is painted as background between the chunks.
export async function withStackedMonthPages(months, { bg, totalWidth, deviceScaleFactor = 4, monthGap = 24 }) {
  const { getBrowser } = await import('./browser.js');
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const chunks = [];
    // Viewport is set once: all months share the same width and scale factor.
    await page.setViewport({ width: totalWidth, height: 800, deviceScaleFactor });
    for (const m of months) {
      // 'load' rather than 'networkidle0': the page is a static, self-contained
      // document with no sub-resources, so waiting for network idle only adds
      // latency — and repeating setContent 24 times makes that add up.
      await page.setContent(m.html, { waitUntil: 'load', timeout: 30000 });
      const height = await page.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height));
      const buf = await page.screenshot({ type: 'png', timeout: 30000, clip: { x: 0, y: 0, width: totalWidth, height } });
      // Each chunk is handed to the page immediately, so only one raw capture
      // is alive at a time on the Node side.
      chunks.push(`data:image/png;base64,${Buffer.from(buf).toString('base64')}`);
    }
    const stitched = await page.evaluate(async ({ urls, width, dsf, bg, gap }) => {
      const images = [];
      for (const src of urls) {
        const img = new Image();
        img.src = src;
        await img.decode();
        images.push(img);
      }
      const gapPx = gap * dsf;
      // canvas.toDataURL returns "data:," once the bitmap exceeds the browser's
      // maximum canvas height (Chromium: 65535px) — 24 months at 4x is ~118k px.
      // Downscale the stitched image only in that case; the per-month captures
      // stay at full scale either way, which is the point of chunking.
      const MAX_CANVAS_HEIGHT = 32000;
      const fullHeight = images.reduce((h, img) => h + img.height, 0) + gapPx * (images.length - 1);
      const outScale = fullHeight > MAX_CANVAS_HEIGHT ? MAX_CANVAS_HEIGHT / fullHeight : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * dsf * outScale));
      canvas.height = Math.max(1, Math.round(fullHeight * outScale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      let y = 0;
      for (let i = 0; i < images.length; i++) {
        if (i > 0) y += gapPx;
        ctx.drawImage(images[i], 0, Math.round(y * outScale), Math.round(images[i].width * outScale), Math.round(images[i].height * outScale));
        y += images[i].height;
      }
      return canvas.toDataURL('image/png').split(',')[1];
    }, { urls: chunks, width: totalWidth, dsf: deviceScaleFactor, bg, gap: monthGap });
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
