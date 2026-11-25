import { afterAll, expect, it } from 'vitest';
import { withStackedMonthPages } from '../services/image-helpers.js';
import { getBrowser, closeBrowser } from '../services/browser.js';

afterAll(closeBrowser);

it('retains the final month footer when a long export is downscaled', async () => {
  const months = Array.from({ length: 4 }, (_, i) => ({ html: `<!doctype html>
    <style>*{box-sizing:border-box;margin:0}html,body{height:auto;min-height:0}body{padding:10px;background:white}</style>
    <div style="height:11960px"></div><div style="height:20px;background:${i === 3 ? '#ff00ff' : '#00ff00'}"></div>` }));
  const png = await withStackedMonthPages(months, { bg: '#fff', totalWidth: 80, deviceScaleFactor: 2 });
  expect(png.readUInt32BE(20)).toBeLessThanOrEqual(32000);
  const page = await (await getBrowser()).newPage();
  try {
    const footerPixels = await page.evaluate(async url => {
      const img = new Image(); img.src = url; await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, Math.floor(img.width / 2), 0, 1, img.height, 0, 0, 1, img.height);
      const pixels = ctx.getImageData(0, 0, 1, img.height).data;
      let found = 0;
      for (let y = 0; y < img.height; y++) {
        if (pixels[y * 4] > 240 && pixels[y * 4 + 1] < 15 && pixels[y * 4 + 2] > 240) found++;
      }
      return found;
    }, `data:image/png;base64,${png.toString('base64')}`);
    expect(footerPixels).toBeGreaterThan(0);
  } finally { await page.close(); }
}, 30000);
