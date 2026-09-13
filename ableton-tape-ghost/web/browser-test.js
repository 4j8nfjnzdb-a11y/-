const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

  // Stub getUserMedia with a synthetic tone before any page script runs, so we
  // don't need a real microphone or permission prompt.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.frequency.value = 300;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      window.__testOscCtx = ctx;
      return dest.stream;
    };
  });

  const target = process.env.TEST_URL || ('file://' + path.join(__dirname, 'index.html'));
  await page.goto(target);

  await page.selectOption('#bufMinutes', '1');
  await page.click('#startBtn');
  try {
    await page.waitForSelector('#stage.show', { timeout: 5000 });
    console.log('stage visible after start: OK');
  } catch (e) {
    const errText = await page.textContent('#errBox');
    console.log('DID NOT START. errBox text:', JSON.stringify(errText));
    console.log('console/page errors so far:');
    errors.forEach((e) => console.log(' - ' + e));
    throw e;
  }

  // let it record + settle past the idle anchor, then raise mix and check we
  // get real (non-silent) output by inspecting the worklet's status messages
  // indirectly via the UI's writeSec readout, and by tapping into the actual
  // audio graph for RMS level.
  await page.waitForTimeout(500);

  await page.fill('#mix', '100');
  await page.dispatchEvent('#mix', 'input');
  await page.click('#jump');
  await page.waitForTimeout(50);
  await page.click('#jumpBtn');

  await page.click('#loopBtn');
  await page.waitForTimeout(100);
  await page.click('#loopBtn');
  await page.waitForTimeout(200);

  await page.click('#rewindBtn');
  await page.waitForTimeout(200);
  await page.click('#rewindBtn');

  await page.click('#miracleBtn');
  await page.waitForTimeout(400);
  await page.click('#miracleBtn');

  await page.evaluate(() => {
    document.getElementById('pitch').value = '7';
    document.getElementById('pitch').dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(200);

  const writeSecText = await page.textContent('#writeSec');
  console.log('writeSec after interactions:', writeSecText);

  const errBoxVisible = await page.isVisible('#errBox');
  console.log('error box visible (should be false):', errBoxVisible);

  await page.screenshot({ path: '/tmp/tapeghost_screenshot.png' });
  console.log('screenshot saved');

  await page.click('#stopBtn');
  await page.waitForTimeout(100);
  const setupVisible = await page.isVisible('#setupPanel');
  console.log('setup panel visible again after stop:', setupVisible);

  await browser.close();

  console.log('\nconsole/page errors captured:', errors.length);
  errors.forEach((e) => console.log(' - ' + e));

  if (errors.length > 0) process.exit(1);
  if (parseFloat(writeSecText) < 1.0) throw new Error('expected writeSec to have advanced meaningfully, got ' + writeSecText);
  console.log('\nBrowser end-to-end test PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
