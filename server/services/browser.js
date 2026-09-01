import puppeteer from 'puppeteer';

let browserPromise = null;

function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
}

export async function getBrowser() {
  const pending = browserPromise;
  if (pending) {
    try {
      const browser = await pending;
      if (browser.connected) return browser;
    } catch { /* launch failed; fall through and retry below */ }
    // Awaiting yielded, so another caller may already have replaced the dead
    // browser. Only retire the entry we actually observed — clearing blindly
    // would discard their fresh browser and orphan the Chromium process.
    if (browserPromise === pending) browserPromise = null;
    else if (browserPromise) return browserPromise;
  }
  browserPromise = launchBrowser().catch(err => {
    browserPromise = null;
    throw err;
  });
  return browserPromise;
}

export async function closeBrowser() {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    const browser = await pending;
    await browser.close();
  } catch { /* launch failed or already gone — nothing left to close */ }
}
