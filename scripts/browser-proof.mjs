// Drive the built site in headless Chrome. Usage:
//   node scripts/browser-proof.mjs demo  <url>
//   node scripts/browser-proof.mjs real  <url> <pdf> [sample=1|2]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [mode, base, pdf, sample = '1'] = process.argv.slice(2);
const shots = path.resolve(import.meta.dirname, '../screenshots');
fs.mkdirSync(shots, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1100,1800'],
  userDataDir: '/tmp/portion-cut-chrome',
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1400, deviceScaleFactor: 1 });
const log = [];
page.on('console', (m) => { log.push(m.text()); if (m.text().startsWith('[portion-cut]')) console.log(m.text()); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const t0 = Date.now();
if (mode === 'demo') {
  await page.goto(`${base}?demo=1`, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(shots, '01-home-demo.png'), fullPage: true });
  await page.waitForFunction(() => !document.querySelector('#cut').disabled, { timeout: 30000 });
  await page.click('#cut');
  await page.waitForSelector('#results:not([hidden])', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800));
  const summary = await page.$eval('#summary', (e) => e.textContent);
  console.log('demo summary:', summary, 'ms', Date.now() - t0);
  await page.screenshot({ path: path.join(shots, '02-demo-results.png'), fullPage: true });
} else {
  await page.goto(base, { waitUntil: 'networkidle0' });
  // First visit reloads once so the service worker can add isolation headers.
  for (let i = 0; i < 20 && !(await page.evaluate(() => self.crossOriginIsolated).catch(() => false)); i += 1) {
    await new Promise((r) => setTimeout(r, 500));
  }
  await page.waitForSelector('#file');
  console.log('isolated:', await page.evaluate(() => self.crossOriginIsolated));
  const input = await page.$('#file');
  await input.uploadFile(pdf);
  await page.waitForFunction(() => document.querySelector('#book-info').textContent.length > 0, { timeout: 120000 });
  console.log('book info:', await page.$eval('#book-info', (e) => e.textContent));
  await page.click(sample === '2' ? '#sample2' : '#sample1');
  await page.screenshot({ path: path.join(shots, `real-before-${sample}.png`), fullPage: true });
  const tCut = Date.now();
  await page.click('#cut');
  let lastLog = 0;
  while (true) {
    const done = await page.$eval('#results', (e) => !e.hidden);
    const status = await page.$eval('#status', (e) => e.textContent);
    if (done || /error|fail/i.test(status)) break;
    if (Date.now() - lastLog > 30000) {
      lastLog = Date.now();
      console.log(`${Math.round((Date.now() - tCut) / 1000)}s`, await page.$eval('#progress-text', (e) => e.textContent));
      await page.screenshot({ path: path.join(shots, `real-progress-${sample}.png`), fullPage: false });
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await new Promise((r) => setTimeout(r, 800));
  const result = await page.evaluate(() => ({
    summary: document.querySelector('#summary').textContent,
    status: document.querySelector('#status').textContent,
    net: document.querySelector('#net-count').textContent,
    cutMs: document.body.dataset.cutMs,
    embedMs: document.body.dataset.embedMs,
    threads: document.body.dataset.threads,
    isolated: self.crossOriginIsolated,
    topics: [...document.querySelectorAll('#topics li')].map((li) => li.textContent),
  }));
  result.wallMs = Date.now() - tCut;
  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(shots, `browser-real-${sample}.json`), JSON.stringify({ when: new Date().toISOString(), log: log.filter((l) => l.startsWith('[portion-cut]')), ...result }, null, 2));
  await page.screenshot({ path: path.join(shots, `real-results-${sample}.png`), fullPage: true });
}
await browser.close();
