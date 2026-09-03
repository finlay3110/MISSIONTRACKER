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
async function openOptions(page) {
  const tog = 'button[aria-controls="impOptsBody"]';
  if ((await page.getAttribute(tog, 'aria-expanded')) !== 'true') await page.click(tog);
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
    /* no header: the date is found in the data, the rest is the user's to confirm,
       and the mapping opens itself rather than guessing from column position */
    ok(await page.isVisible('#impColsBody'), 'mapping stayed shut on a headerless file');
    const guessed = await page.evaluate(() => ({
      date: document.getElementById('map_date').value,
      ship: document.getElementById('map_ship').value,
      notes: document.getElementById('map_notes').value
    }));
    ok(guessed.date === '0', 'date not inferred from the data: ' + guessed.date);
    ok(guessed.ship === '-1' && guessed.notes === '-1', 'columns guessed from position');
    await page.selectOption('#map_ship', '1');
    await page.selectOption('#map_role', '2');
    await page.selectOption('#map_name', '3');
    await page.selectOption('#map_notes', '7');
    const label = (await page.textContent('#impGo')).trim();
    ok(label === 'Import 2 missions', 'semicolon/quoted parse gave: ' + label);
    await page.click('#impGo');
    await page.waitForSelector('#tab-analytics.active');
    await page.click('#nav-log');
    const log = await page.textContent('#logBody');
    ok(/Parley, second pass/.test(log), 'quoted comma field lost');
    ok(/Helm/.test(log), 'role column from the file was lost');
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
    await openOptions(page);
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
    await page.selectOption('#suRank', '__other__');
    await page.fill('#suRankOther', 'Wing Commander');
    await page.waitForTimeout(150);
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ucn.missionAnalytics.v1')).setup);
    ok(stored.rank === 'Wing Commander', 'rank stored as: ' + stored.rank);
    await page.reload();
    await page.evaluate(() => document.fonts.load('700 20px Orbitron'));
    ok(await page.isVisible('#suRankOther'), 'Other text field not restored');
    ok((await page.inputValue('#suRankOther')) === 'Wing Commander', 'Other value not restored');
    ok(/Wing Commander/.test(await page.textContent('#hdMeta')), 'header chip missing typed rank');
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
    await page.click('#nav-import');
    const tog = 'button[aria-controls="impPasteBody"]';
    ok((await page.getAttribute(tog, 'aria-expanded')) === 'false', 'collapsible starts open');
    await page.click(tog);
    ok((await page.getAttribute(tog, 'aria-expanded')) === 'true', 'aria-expanded not synced');
    ok(await page.isVisible('#impPasteBody'), 'collapsible body did not open');
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

  /* --- 8. the real deployments export: quoted fields, "Category" header,
           no role column, real-world years -------------------------------- */
  {
    const { ctx, page, errs } = await fresh(browser);
    const real = require('fs').readFileSync(
      path.resolve(__dirname, 'fixture-deployments.csv'), 'utf8');
    await paste(page, real);
    await page.waitForSelector('#impConfig:not(.hidden)');
    const map = await page.evaluate(() => ({
      date: document.getElementById('map_date').selectedOptions[0].textContent,
      ship: document.getElementById('map_ship').selectedOptions[0].textContent,
      name: document.getElementById('map_name').selectedOptions[0].textContent,
      type: document.getElementById('map_type').selectedOptions[0].textContent,
      role: document.getElementById('map_role').value
    }));
    ok(map.date === 'Date', 'date column: ' + map.date);
    ok(map.ship === 'Ship', 'ship column: ' + map.ship);
    ok(map.name === 'Mission', 'mission column: ' + map.name);
    ok(map.type === 'Category', '"Category" not mapped to mission type: ' + map.type);
    ok(map.role === '-1', 'invented a role column: ' + map.role);
    ok(/No role column in this file/.test(await page.textContent('#impPreview')),
       'no note about the missing role column');
    ok((await page.textContent('#impGo')).trim() === 'Import 17 missions',
       'row count: ' + (await page.textContent('#impGo')).trim());

    await page.click('#impGo');
    await page.waitForSelector('#anBody svg');
    const after = await page.evaluate(() => {
      const m = JSON.parse(localStorage.getItem('ucn.missionAnalytics.v1')).missions;
      return { n: m.length, first: m[0].date, last: m[m.length - 1].date,
               setupFirst: JSON.parse(localStorage.getItem('ucn.missionAnalytics.v1'))
                             .setup.firstDeployment };
    });
    ok(after.n === 17, 'imported ' + after.n);
    ok(after.first === '2026-05-08', 'dates altered on import: ' + after.first);
    ok(after.last === '2026-09-01', 'dates altered on import: ' + after.last);
    ok(after.setupFirst === '2026-05-08', 'first deployment not derived: ' + after.setupFirst);
    const anText = await page.textContent('#anBody');
    ok(/Both Ships/.test(anText), '"Both Ships" value lost');
    ok(/No role recorded on any mission/.test(anText), 'no guidance for the empty role section');
    ok(/No missions rated yet/.test(anText), 'no empty state for ratings');

    /* rate one, then check it reaches the report */
    await page.click('#nav-log');
    await page.locator('.stars-host').first().locator('[data-star="5"]').click();
    await page.waitForTimeout(120);
    await page.click('#nav-analytics');
    ok(/Average rating/.test(await page.textContent('#anBody')), 'rating not picked up');
    await page.evaluate(() => document.getElementById('anExport').click());
    await page.waitForTimeout(2500);
    ok(errs.length === 0, 'real csv errors: ' + errs.join('|'));
    await ctx.close();
  }

  await browser.close();
  if (fails.length) { console.error('FAIL:\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('PASS (8 edge cases)');
})();
