import puppeteer from 'puppeteer';

let browserPromise = null;

export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    }).catch(err => {
      browserPromise = null;
      throw err;
    });
  }
  try {
    return await browserPromise;
  } catch {
    browserPromise = null;
    // Retry once
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    }).catch(err => {
      browserPromise = null;
      throw err;
    });
    return browserPromise;
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}
