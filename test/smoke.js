/* Offline smoke test. Run: NODE_PATH=/opt/node22/lib/node_modules node test/smoke.js */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..', '.smoke');

const CSV = [
  'Date,Ship,Role,Mission,Type,Outcome,Duration,Notes',
  '2182-01-14,UCS Takanami,Helm,Silent Harbour,Frontline,Objective met,90,Lost port thruster on approach',
  '2182-01-28,UCS Takanami,Missiles,Ashfall,Military,Objective met,75,',
  '2182-02-03,UCS Havock,Comms,Ridgeline Parley,Diplomacy,Stood down,105,Envoy refused the first terms',
  '2182-02-19,UCS Takanami,Helm,Deep Survey 7,Exploration,Objective met,120,',
  '2182-02-25,UCS Havock,Radar,Nightjar,Intrigue,Inconclusive,60,',
  '2182-04-02,UCS Havock,Captain,Longshore,Campaign,Objective met,150,Held the line at the relay',
  '14/05/2182,UCS Takanami,Beams,Gauntlet,Frontline,Lost,95,',
  '2182-05-30,UCS Takanami,Helm,Tidewater,Frontline,Objective met,80,',
  'not-a-date,UCS Havock,Helm,Broken Row,Frontline,,,',
  '2182-06-11,Shuttle Kestrel,Shuttle Helm,Fetch and Carry,Exploration,Objective met,45,',
  ''
].join('\n');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    acceptDownloads: true
  });
  const page = await ctx.newPage();

  const errors = [];
  const external = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('request', r => { if (!r.url().startsWith('file://')) external.push(r.url()); });

  await page.goto(FILE);
  await page.evaluate(() => Promise.all([
    document.fonts.load('700 20px Orbitron'),
    document.fonts.load('400 20px "Exo 2"'),
    document.fonts.load('700 20px "Exo 2"'),
    document.fonts.load('italic 400 20px "Exo 2"')
  ]));

  const step = async (name) => {
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
  };

  /* --- setup --- */
  await page.fill('#suLoggedBy', 'Fin Harker');
  await page.selectOption('#suRank', 'Lt Cmdr');
  await page.selectOption('#suRole', 'Helm');
  await page.selectOption('#suShip', 'UCS Takanami');
  await page.fill('#suMissionName', 'Operation Silent Harbour');
  await page.selectOption('#suMissionType', 'Campaign');
  await page.fill('#suCampaignMission', 'Longshore');
  await page.fill('#suGroupName', 'Watch Three');
  await page.selectOption('#suAuth', 'Engage with discretion');
  await page.selectOption('#suThreat', 'Active (Red)');
  await page.fill('#suBriefing', 'Relay station went dark at 0200. Expect contested approach.');

  const dateVal = await page.inputValue('#suDate');
  const timeVal = await page.inputValue('#suTime');
  const campaignVisible = await page.isVisible('#campaignWrap');
  const threatCls = await page.getAttribute('#suThreat', 'class');
  await step('01-setup');

  /* --- other... reveal --- */
  await page.selectOption('#suShip', '__other__');
  const otherVisible = await page.isVisible('#suShipOther');
  await page.fill('#suShipOther', 'UCS Sable');
  await page.selectOption('#suShip', 'UCS Takanami');

  /* --- import via paste --- */
  await page.click('#nav-import');
  await page.click('button[aria-controls="impPasteBody"]');
  await page.fill('#impPaste', CSV);
  await page.click('#impPasteGo');
  await page.waitForSelector('#impConfig:not(.hidden)');
  const mapped = await page.evaluate(() => ({
    date: document.getElementById('map_date').value,
    ship: document.getElementById('map_ship').value,
    role: document.getElementById('map_role').value,
    name: document.getElementById('map_name').value,
    duration: document.getElementById('map_duration').value
  }));
  const goLabel = await page.textContent('#impGo');
  await step('02-import');

  await page.click('#impGo');
  await page.waitForSelector('#tab-analytics.active');
  await page.waitForSelector('#anBody svg');
  const charts = await page.locator('#anBody svg').count();
  const tiles = await page.locator('#anBody .tile').count();
  await step('03-analytics');

  /* --- role filter --- */
  await page.selectOption('#flRole', 'Helm');
  await page.waitForTimeout(120);
  const filteredTotal = await page.textContent('#anBody .tile .tile-v');
  await step('04-filtered');
  await page.selectOption('#flRole', '');

  /* --- log tab + sheet --- */
  await page.click('#nav-log');
  const cards = await page.locator('#logBody .card').count();
  await page.click('#logAdd');
  await page.waitForSelector('#sheet [id="msSave"]');
  const focusInSheet = await page.evaluate(() =>
    document.getElementById('sheet').contains(document.activeElement));
  await step('05-sheet');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#scrim.hidden', { state: 'attached' });

  /* --- pdf --- */
  await page.click('#nav-analytics');
  const dl = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.click('#anExport')
  ]).then(r => r[0]);
  const pdfPath = path.join(OUT, 'report.pdf');
  await dl.saveAs(pdfPath);
  const pdfSize = fs.statSync(pdfPath).size;
  const head = fs.readFileSync(pdfPath).slice(0, 5).toString('latin1');

  /* --- more tab --- */
  await page.click('#nav-more');
  await page.click('button[aria-controls="aboutBody"]');
  await step('06-more');

  /* --- layout: header height published, nothing clipped, no h-scroll --- */
  await page.click('#nav-setup');
  const layout = await page.evaluate(() => {
    const h = document.getElementById('appHeader');
    const main = document.querySelector('main');
    const varH = getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim();
    const first = document.querySelector('#tab-setup h2.sec');
    return {
      headerH: Math.round(h.getBoundingClientRect().height),
      cssVar: varH,
      mainPadTop: Math.round(parseFloat(getComputedStyle(main).paddingTop)),
      mainPadBottom: Math.round(parseFloat(getComputedStyle(main).paddingBottom)),
      firstHeadingTop: Math.round(first.getBoundingClientRect().top),
      headerBottom: Math.round(h.getBoundingClientRect().bottom),
      docScrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    };
  });

  /* --- header hide toggle persists --- */
  await page.click('#hdToggle');
  const hiddenAfterClick = await page.evaluate(() =>
    document.getElementById('hdMeta').className.indexOf('hidden') > -1);
  await page.reload();
  await page.evaluate(() => document.fonts.load('700 20px Orbitron'));
  const hiddenAfterReload = await page.evaluate(() =>
    document.getElementById('hdMeta').className.indexOf('hidden') > -1);

  /* --- persistence --- */
  await page.reload();
  await page.evaluate(() => document.fonts.load('700 20px Orbitron'));
  const persisted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ucn.missionAnalytics.v1')).missions.length);

  await browser.close();

  const report = {
    externalRequests: external,
    consoleErrors: errors,
    dateDefault: dateVal,
    timeDefault: timeVal,
    campaignVisible, threatClass: threatCls, otherRevealed: otherVisible,
    columnMapping: mapped,
    importButton: goLabel.trim(),
    chartCount: charts, tileCount: tiles,
    filteredHeadlineTile: (filteredTotal || '').trim(),
    logCards: cards, focusMovedIntoSheet: focusInSheet,
    pdfBytes: pdfSize, pdfMagic: head,
    missionsAfterReload: persisted,
    layout: layout,
    headerHiddenAfterClick: hiddenAfterClick,
    headerHiddenAfterReload: hiddenAfterReload
  };
  console.log(JSON.stringify(report, null, 2));

  const fail = [];
  if (external.length) fail.push('made ' + external.length + ' external request(s)');
  if (errors.length) fail.push('console errors: ' + errors.join(' | '));
  if (head !== '%PDF-') fail.push('PDF magic bytes wrong: ' + head);
  if (pdfSize < 50000) fail.push('PDF suspiciously small: ' + pdfSize);
  if (charts < 2) fail.push('expected at least 2 charts');
  if (persisted !== 9) fail.push('expected 9 persisted missions, got ' + persisted);
  if (!campaignVisible) fail.push('campaign fields did not reveal');
  if (!focusInSheet) fail.push('focus did not move into the sheet');
  if (layout.cssVar !== layout.headerH + 'px') fail.push('--header-h ' + layout.cssVar + ' != ' + layout.headerH + 'px');
  if (layout.mainPadTop !== layout.headerH) fail.push('main padding-top does not clear the header');
  if (layout.firstHeadingTop < layout.headerBottom) fail.push('content clipped under the fixed header');
  if (layout.mainPadBottom < 84) fail.push('main does not reserve room for the nav');
  if (layout.docScrollW > layout.clientW) fail.push('page scrolls horizontally');
  if (!hiddenAfterClick) fail.push('hide toggle did not hide the meta row');
  if (!hiddenAfterReload) fail.push('hide state not remembered across reload');
  if (fail.length) { console.error('\nFAIL:\n - ' + fail.join('\n - ')); process.exit(1); }
  console.log('\nPASS');
})();
