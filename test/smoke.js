/* Offline smoke test. Run: NODE_PATH=/opt/node22/lib/node_modules node test/smoke.js */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..', '.smoke');
const CSV = fs.readFileSync(path.resolve(__dirname, 'fixture-deployments.csv'), 'utf8');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, acceptDownloads: true
  });
  const page = await ctx.newPage();

  const errors = [];
  const external = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('request', r => { if (!r.url().startsWith('file://')) external.push(r.url()); });

  await page.goto(FILE);
  const loadFonts = () => page.evaluate(() => Promise.all([
    document.fonts.load('700 20px Orbitron'), document.fonts.load('400 20px "Exo 2"'),
    document.fonts.load('700 20px "Exo 2"'), document.fonts.load('italic 400 20px "Exo 2"')
  ]));
  await loadFonts();
  const step = n => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });

  /* --- setup: name and rank, nothing else --- */
  const setupFields = await page.evaluate(() =>
    [...document.querySelectorAll('#tab-setup input, #tab-setup select')]
      .filter(e => e.offsetParent !== null).map(e => e.id));
  await page.fill('#suLoggedBy', 'Fin Harker');
  await page.selectOption('#suRank', 'Lt Cmdr');
  const firstBefore = await page.inputValue('#suFirst');
  await step('01-setup');

  /* --- rank "Other..." stores the typed value --- */
  await page.selectOption('#suRank', '__other__');
  const otherVisible = await page.isVisible('#suRankOther');
  await page.fill('#suRankOther', 'Wing Commander');
  await page.waitForTimeout(120);
  const otherStored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ucn.missionAnalytics.v1')).setup.rank);
  await page.selectOption('#suRank', 'Lt Cmdr');

  /* --- import --- */
  await page.click('#nav-import');
  await page.click('button[aria-controls="impPasteBody"]');
  await page.fill('#impPaste', CSV);
  await page.click('#impPasteGo');
  await page.waitForSelector('#impConfig:not(.hidden)');
  const optionsCollapsed = await page.evaluate(() => ({
    cols: document.getElementById('impColsBody').className,
    opts: document.getElementById('impOptsBody').className
  }));
  const goLabel = (await page.textContent('#impGo')).trim();
  await step('02-import');

  await page.click('#impGo');
  await page.waitForSelector('#tab-analytics.active');
  await page.waitForSelector('#anBody svg');
  const charts = await page.locator('#anBody svg').count();
  await step('03-analytics');

  /* --- first deployment derived from the earliest mission --- */
  await page.click('#nav-setup');
  const firstAfter = await page.inputValue('#suFirst');
  const firstNote = await page.textContent('#suFirstNote');

  /* --- rate missions straight from the log --- */
  await page.click('#nav-log');
  await page.waitForSelector('.stars-host');
  await page.locator('.stars-host').first().locator('[data-star="4"]').click();
  await page.locator('.stars-host').nth(1).locator('[data-star="2"]').click();
  await page.locator('.stars-host').nth(2).locator('[data-star="5"]').click();
  await page.waitForTimeout(150);
  const ratings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ucn.missionAnalytics.v1')).missions
      .filter(m => m.rating).map(m => m.rating).sort());
  /* tapping the same star again clears it */
  await page.locator('.stars-host').nth(1).locator('[data-star="2"]').click();
  await page.waitForTimeout(120);
  const afterClear = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ucn.missionAnalytics.v1')).missions.filter(m => m.rating).length);
  await page.locator('.stars-host').nth(1).locator('[data-star="3"]').click();
  await step('04-log');

  /* --- a role can be set per mission --- */
  await page.locator('[data-edit]').first().click();
  await page.waitForSelector('#msSave');
  const focusInSheet = await page.evaluate(() =>
    document.getElementById('sheet').contains(document.activeElement));
  await page.selectOption('#msRole', 'Helm');
  await page.click('#msSave');
  await page.waitForSelector('#scrim.hidden', { state: 'attached' });
  const roleSet = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ucn.missionAnalytics.v1')).missions.filter(m => m.role).length);
  await step('05-log-rated');

  /* --- analytics reflects ratings --- */
  await page.click('#nav-analytics');
  const anText = await page.textContent('#anBody');
  await step('06-analytics-rated');

  /* --- pdf --- */
  const dl = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.evaluate(() => document.getElementById('anExport').click())
  ]).then(r => r[0]);
  const pdfPath = path.join(OUT, 'report.pdf');
  await dl.saveAs(pdfPath);
  const pdfSize = fs.statSync(pdfPath).size;
  const pdfName = dl.suggestedFilename();
  const head = fs.readFileSync(pdfPath).slice(0, 5).toString('latin1');

  await page.click('#nav-more');
  await page.click('button[aria-controls="aboutBody"]');
  await step('07-more');

  /* --- layout --- */
  await page.click('#nav-setup');
  const layout = await page.evaluate(() => {
    const h = document.getElementById('appHeader');
    const main = document.querySelector('main');
    const first = document.querySelector('#tab-setup h2.sec');
    return {
      headerH: Math.round(h.getBoundingClientRect().height),
      cssVar: getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim(),
      mainPadTop: Math.round(parseFloat(getComputedStyle(main).paddingTop)),
      mainPadBottom: Math.round(parseFloat(getComputedStyle(main).paddingBottom)),
      firstHeadingTop: Math.round(first.getBoundingClientRect().top),
      headerBottom: Math.round(h.getBoundingClientRect().bottom),
      docScrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    };
  });
  await page.click('#hdToggle');
  const hiddenAfterClick = await page.evaluate(() =>
    document.getElementById('hdMeta').className.indexOf('hidden') > -1);

  await page.reload();
  await loadFonts();
  const persisted = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('ucn.missionAnalytics.v1'));
    return { missions: d.missions.length, rated: d.missions.filter(m => m.rating).length,
             first: d.setup.firstDeployment, name: d.setup.loggedBy };
  });
  const hiddenAfterReload = await page.evaluate(() =>
    document.getElementById('hdMeta').className.indexOf('hidden') > -1);

  /* --- desktop: left rail, multi-column board, no h-scroll --- */
  const desk = await ctx.newPage();
  const deskErr = [];
  desk.on('pageerror', e => deskErr.push(e.message));
  desk.on('request', r => { if (!r.url().startsWith('file://')) deskErr.push('NET ' + r.url()); });
  await desk.setViewportSize({ width: 1440, height: 900 });
  await desk.goto(FILE);
  await desk.evaluate(() => Promise.all([document.fonts.load('700 20px Orbitron'),
                                         document.fonts.load('400 20px "Exo 2"')]));
  await desk.click('#nav-analytics');
  await desk.waitForSelector('#anBody svg');
  const wide = await desk.evaluate(() => {
    const nav = document.querySelector('nav').getBoundingClientRect();
    const hdr = document.getElementById('appHeader').getBoundingClientRect();
    const cta = document.getElementById('anExport').getBoundingClientRect();
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      navIsRail: nav.height > nav.width && Math.round(nav.left) === 0,
      navClearsHeader: Math.round(nav.top) >= Math.round(hdr.bottom),
      mainLeft: Math.round(document.querySelector('main').getBoundingClientRect().left),
      navW: Math.round(nav.width),
      anCols: getComputedStyle(document.getElementById('anBody')).gridTemplateColumns.split(' ').length,
      logCols: getComputedStyle(document.getElementById('logBody')).gridTemplateColumns.split(' ').length,
      ctaWidth: Math.round(cta.width),
      zeroMeterFills: [...document.querySelectorAll('#anBody .meter')]
        .filter(m => /\(0%\)/.test(m.textContent))
        .map(m => Math.round(m.querySelector('.meter-fill').getBoundingClientRect().width))
    };
  });
  await desk.screenshot({ path: path.join(OUT, '08-desktop.png') });
  /* narrow again: the rail must give way to the bottom nav */
  await desk.setViewportSize({ width: 414, height: 896 });
  await desk.waitForTimeout(200);
  const narrowAgain = await desk.evaluate(() => {
    const nav = document.querySelector('nav').getBoundingClientRect();
    return { navIsBar: nav.width > nav.height,
             scrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  await desk.close();

  await browser.close();

  const report = {
    externalRequests: external, consoleErrors: errors,
    visibleSetupFields: setupFields,
    firstDeployment: { beforeImport: firstBefore, afterImport: firstAfter, note: firstNote.trim() },
    rankOther: { revealed: otherVisible, stored: otherStored },
    importOptionsCollapsed: optionsCollapsed,
    importButton: goLabel, chartCount: charts,
    ratings, ratingsAfterClear: afterClear, rolesSet: roleSet,
    focusMovedIntoSheet: focusInSheet,
    analyticsMentionsRating: /Average rating/.test(anText),
    pdf: { name: pdfName, bytes: pdfSize, magic: head },
    layout, headerHiddenAfterClick: hiddenAfterClick, headerHiddenAfterReload: hiddenAfterReload,
    persisted, desktop: wide, backToNarrow: narrowAgain, desktopErrors: deskErr
  };
  console.log(JSON.stringify(report, null, 2));

  const fail = [];
  const F = (c, m) => { if (!c) fail.push(m); };
  F(!external.length, 'made ' + external.length + ' external request(s)');
  F(!errors.length, 'console errors: ' + errors.join(' | '));
  F(setupFields.join(',') === 'suLoggedBy,suRank,suFirst',
    'setup should ask for name, rank and first deployment only: ' + setupFields.join(','));
  F(firstBefore === '', 'first deployment pre-filled before any import');
  F(firstAfter === '2026-05-08', 'first deployment not derived: ' + firstAfter);
  F(/earliest logged mission/i.test(firstNote), 'first-deployment note unhelpful: ' + firstNote);
  F(otherVisible && otherStored === 'Wing Commander', 'rank Other... did not store the typed value');
  F(optionsCollapsed.cols === 'coll-body' && optionsCollapsed.opts === 'coll-body',
    'import options should start collapsed');
  F(goLabel === 'Import 17 missions', 'row count: ' + goLabel);
  F(charts >= 2, 'expected at least 2 charts');
  F(ratings.join(',') === '2,4,5', 'ratings not stored: ' + ratings.join(','));
  F(afterClear === 2, 're-tapping a star did not clear it: ' + afterClear);
  F(roleSet === 1, 'per-mission role not saved: ' + roleSet);
  F(focusInSheet, 'focus did not move into the sheet');
  F(/Average rating/.test(anText), 'analytics does not report ratings');
  F(head === '%PDF-', 'PDF magic bytes wrong: ' + head);
  F(pdfSize > 50000, 'PDF suspiciously small: ' + pdfSize);
  F(layout.cssVar === layout.headerH + 'px', '--header-h out of sync');
  F(layout.mainPadTop === layout.headerH, 'main padding-top does not clear the header');
  F(layout.firstHeadingTop >= layout.headerBottom, 'content clipped under the fixed header');
  F(layout.mainPadBottom >= 84, 'main does not reserve room for the nav');
  F(layout.docScrollW <= layout.clientW, 'page scrolls horizontally');
  F(hiddenAfterClick && hiddenAfterReload, 'hide toggle not remembered');
  F(persisted.missions === 17 && persisted.rated === 3, 'ratings did not persist');
  F(persisted.first === '2026-05-08', 'first deployment did not persist');
  F(!deskErr.length, 'desktop errors: ' + deskErr.join(' | '));
  F(wide.scrollW <= wide.clientW, 'desktop scrolls horizontally');
  F(wide.navIsRail, 'nav did not become a left rail on desktop');
  F(wide.navClearsHeader, 'rail overlaps the fixed header');
  F(wide.mainLeft === wide.navW, 'main does not clear the rail: ' + wide.mainLeft + ' vs ' + wide.navW);
  F(wide.anCols === 2, 'analytics board is not two columns: ' + wide.anCols);
  F(wide.logCols === 3, 'log grid is not three columns at 1440: ' + wide.logCols);
  F(wide.ctaWidth <= 380, 'desktop CTA stretched to ' + wide.ctaWidth + 'px');
  F(wide.zeroMeterFills.every(w => w === 0),
    'a zero-count meter still draws a fill: ' + wide.zeroMeterFills.join(','));
  F(narrowAgain.navIsBar, 'nav did not return to a bottom bar when narrowed');
  F(!narrowAgain.scrolls, 'narrowing back left a horizontal scrollbar');
  if (fail.length) { console.error('\nFAIL:\n - ' + fail.join('\n - ')); process.exit(1); }
  console.log('\nPASS');
})();
