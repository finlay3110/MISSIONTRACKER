/* Edge cases: odd CSV shapes, empty state, blocked storage, single-point charts.
   Run: NODE_PATH=/opt/node22/lib/node_modules node test/edge.js */
const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

async function fresh(browser, initScript) {
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
  if (initScript) await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('request', r => { if (!r.url().startsWith('file://')) errs.push('NET ' + r.url()); });
  await page.goto(FILE);
  await page.evaluate(() => Promise.all([
    document.fonts.load('700 20px Orbitron'), document.fonts.load('400 20px "Exo 2"')
  ]));
  return { ctx, page, errs };
}
async function paste(page, text) {
  await page.click('#nav-import');
  const open = await page.getAttribute('button[aria-controls="impPasteBody"]', 'aria-expanded');
  if (open !== 'true') await page.click('button[aria-controls="impPasteBody"]');
  await page.fill('#impPaste', text);
  await page.click('#impPasteGo');
}

(async () => {
  const browser = await chromium.launch();

  /* --- 1. empty state --------------------------------------------------- */
  {
    const { ctx, page, errs } = await fresh(browser);
    await page.click('#nav-analytics');
    const body = await page.textContent('#anBody');
    ok(/No missions logged yet/.test(body), 'empty analytics message missing');
    ok(await page.isDisabled('#anExport'), 'export enabled with no data');
    ok(!(await page.isVisible('#anFilters')), 'filters shown with no data');
    await page.click('#nav-log');
    ok(/None recorded\./.test(await page.textContent('#logBody')), 'empty log message missing');
    ok(errs.length === 0, 'empty state errors: ' + errs.join('|'));
    await ctx.close();
  }

  /* --- 2. semicolons, no header, quoted comma + embedded newline -------- */
  {
    const { ctx, page, errs } = await fresh(browser);
    const csv = [
      '2182-03-01;UCS Havock;Helm;"Parley, second pass";Diplomacy;Objective met;60;"Line one',
      'line two, with a comma"',
      '2182-03-08;UCS Havock;Radar;Nightjar;Intrigue;Lost;45;'
    ].join('\n');
    await paste(page, csv);
    await page.waitForSelector('#impConfig:not(.hidden)');
    const headerSwitch = await page.getAttribute('#impHeader', 'aria-checked');
    ok(headerSwitch === 'false', 'header auto-detect should be off for a data first row');
    const label = (await page.textContent('#impGo')).trim();
    ok(label === 'Import 2 missions', 'semicolon/quoted parse gave: ' + label);
    await page.click('#impGo');
    await page.waitForSelector('#tab-analytics.active');
    await page.click('#nav-log');
    const log = await page.textContent('#logBody');
    ok(/Parley, second pass/.test(log), 'quoted comma field lost');
    ok(/line two, with a comma/.test(log), 'embedded newline field lost');
    ok(errs.length === 0, 'semicolon csv errors: ' + errs.join('|'));
    await ctx.close();
  }

  /* --- 3. ambiguous dates + replace banner ------------------------------ */
  {
    const { ctx, page, errs } = await fresh(browser);
    await paste(page, 'date,ship\n01/02/2182,UCS Havock\n03/04/2182,UCS Havock\n');
    await page.waitForSelector('#impConfig:not(.hidden)');
    ok(/ambiguous/.test(await page.textContent('#impPreview')), 'no ambiguous-date note');
    await page.click('#impGo');
    await page.waitForSelector('#tab-analytics.active');
    await paste(page, 'date,ship\n2182-05-05,UCS Havock\n');
    await page.selectOption('#impMerge', 'replace');
    const banner = await page.textContent('#impPreview .banner');
    ok(/Replace will delete data/.test(banner || ''), 'replace banner missing');
    /* replace must confirm first */
    await page.click('#impGo');
    await page.waitForSelector('#cfYes');
    await page.click('#cfNo');
    const stillTwo = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ucn.missionAnalytics.v1')).missions.length);
    ok(stillTwo === 2, 'cancelling replace still changed the log: ' + stillTwo);
    await page.click('#impGo');
    await page.click('#cfYes');
    await page.waitForSelector('#tab-analytics.active');
    const one = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ucn.missionAnalytics.v1')).missions.length);
    ok(one === 1, 'replace did not replace: ' + one);
    ok(errs.length === 0, 'ambiguous/replace errors: ' + errs.join('|'));
    await ctx.close();
  }

  /* --- 4. single mission: charts must not divide by zero ---------------- */
  {
    const { ctx, page, errs } = await fresh(browser);
    await paste(page, 'date,ship,role\n2182-08-01,UCS Havock,Helm\n');
    await page.click('#impGo');
    await page.waitForSelector('#anBody svg');
    ok((await page.locator('#anBody svg').count()) === 2, 'single-row charts missing');
    const svg = await page.innerHTML('#anBody');
    ok(!/NaN/.test(svg), 'NaN in single-row chart geometry');
    await page.evaluate(() => document.getElementById('anExport').click());
    await page.waitForTimeout(1500);
    ok(errs.length === 0, 'single-row errors: ' + errs.join('|'));
    await ctx.close();
  }

  /* --- 5. "Other..." stores the typed value and survives reload --------- */
  {
    const { ctx, page, errs } = await fresh(browser);
    await page.selectOption('#suShip', '__other__');
    await page.fill('#suShipOther', 'UCS Sable');
    await page.selectOption('#suRole', '__other__');
    await page.fill('#suRoleOther', 'Quartermaster');
    await page.waitForTimeout(150);
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ucn.missionAnalytics.v1')).setup);
    ok(stored.ship === 'UCS Sable', 'ship stored as: ' + stored.ship);
    ok(stored.role === 'Quartermaster', 'role stored as: ' + stored.role);
    await page.reload();
    await page.evaluate(() => document.fonts.load('700 20px Orbitron'));
    ok(await page.isVisible('#suShipOther'), 'Other text field not restored');
    ok((await page.inputValue('#suShipOther')) === 'UCS Sable', 'Other value not restored');
    ok(/UCS Sable/.test(await page.textContent('#hdMeta')), 'header chip missing typed ship');
    ok(errs.length === 0, 'other-value errors: ' + errs.join('|'));
    await ctx.close();
  }

  /* --- 6. blocked localStorage must say so loudly ----------------------- */
  {
    const { ctx, page, errs } = await fresh(browser, () => {
      const boom = () => { throw new Error('blocked'); };
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { return { getItem: boom, setItem: boom, removeItem: boom }; }
      });
    });
    const banner = await page.textContent('#setupBanner');
    ok(/Nothing is being saved/.test(banner), 'no storage banner when storage blocked');
    await page.fill('#suLoggedBy', 'Fin');
    ok(errs.length === 0, 'blocked storage errors: ' + errs.join('|'));
    await ctx.close();
  }

  /* --- 7. collapsible + modal a11y wiring ------------------------------- */
  {
    const { ctx, page, errs } = await fresh(browser);
    const tog = 'button[aria-controls="suOptional"]';
    ok((await page.getAttribute(tog, 'aria-expanded')) === 'false', 'collapsible starts open');
    await page.click(tog);
    ok((await page.getAttribute(tog, 'aria-expanded')) === 'true', 'aria-expanded not synced');
    ok(await page.isVisible('#suOptional'), 'collapsible body did not open');
    await page.click('#nav-log');
    await page.click('#logAdd');
    await page.waitForSelector('#msSave');
    /* backdrop click closes */
    await page.mouse.click(207, 60);
    await page.waitForTimeout(200);
    ok((await page.getAttribute('#scrim', 'class')).indexOf('hidden') > -1, 'backdrop click did not close');
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    ok(focused === 'logAdd', 'focus not returned to trigger, got: ' + focused);
    ok(errs.length === 0, 'a11y errors: ' + errs.join('|'));
    await ctx.close();
  }

  await browser.close();
  if (fails.length) { console.error('FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('PASS (7 edge cases)');
})();
