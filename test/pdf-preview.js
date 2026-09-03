/* Renders the report's jsPDF drawing calls onto canvases so the PDF layout can
   be inspected visually (no PDF rasteriser is available in this environment).
   It swaps window.jspdf.jsPDF for a canvas-backed stand-in implementing only
   the API the report uses, then screenshots each page.
   Run: NODE_PATH=/opt/node22/lib/node_modules node test/pdf-preview.js */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = path.resolve(__dirname, '..', '.smoke', 'pdf');

const CSV = fs.readFileSync(path.resolve(__dirname, 'fixture-deployments.csv'), 'utf8');

const MOCK = () => {
  const S = 4;                                   // px per mm
  const PT = 0.352778;                           // pt -> mm
  function Doc() {
    this.pages = []; this.cur = -1;
    this.font = { name: 'helvetica', style: 'normal' }; this.size = 10;
    this.fill = '#000'; this.draw = '#000'; this.text_ = '#000'; this.lw = 0.2;
    this.dash = null; this.links = [];
    this.addPage();
  }
  function rgb(a) { return 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')'; }
  Doc.prototype.addPage = function () {
    const c = document.createElement('canvas');
    c.width = 210 * S; c.height = 297 * S;
    c.className = 'pdfpage';
    document.body.appendChild(c);
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    this.pages.push({ c: c, x: x }); this.cur = this.pages.length - 1;
    return this;
  };
  Doc.prototype.setPage = function (n) { this.cur = n - 1; return this; };
  Doc.prototype.ctx = function () { return this.pages[this.cur].x; };
  Doc.prototype.setFont = function (n, s) { this.font = { name: n, style: s || 'normal' }; return this; };
  Doc.prototype.setFontSize = function (n) { this.size = n; return this; };
  Doc.prototype.setTextColor = function (r, g, b) { this.text_ = rgb([r, g, b]); return this; };
  Doc.prototype.setFillColor = function (r, g, b) { this.fill = rgb([r, g, b]); return this; };
  Doc.prototype.setDrawColor = function (r, g, b) { this.draw = rgb([r, g, b]); return this; };
  Doc.prototype.setLineWidth = function (w) { this.lw = w; return this; };
  Doc.prototype.setLineDashPattern = function (a) { this.dash = a && a.length ? a : null; return this; };
  Doc.prototype.cssFont = function () {
    const fam = this.font.name === 'Orbitron' ? '"Orbitron"'
      : this.font.name === 'Exo2' ? '"Exo 2"' : 'Helvetica, Arial';
    const w = this.font.style === 'bold' ? '700' : '400';
    const st = this.font.style === 'italic' ? 'italic' : 'normal';
    return st + ' ' + w + ' ' + (this.size * PT * S).toFixed(2) + 'px ' + fam;
  };
  Doc.prototype.getTextWidth = function (s) {
    const x = this.ctx(); x.font = this.cssFont();
    return x.measureText(String(s)).width / S;
  };
  Doc.prototype.splitTextToSize = function (t, w) {
    const words = String(t).split(/\s+/); const out = []; let line = '';
    for (let i = 0; i < words.length; i++) {
      const probe = line ? line + ' ' + words[i] : words[i];
      if (line && this.getTextWidth(probe) > w) { out.push(line); line = words[i]; }
      else line = probe;
    }
    if (line) out.push(line);
    return out.length ? out : [''];
  };
  Doc.prototype.text = function (s, x, y, o) {
    const c = this.ctx(); c.save(); c.font = this.cssFont(); c.fillStyle = this.text_;
    c.textAlign = (o && o.align) ? o.align : 'left'; c.textBaseline = 'alphabetic';
    c.fillText(String(s), x * S, y * S); c.restore(); return this;
  };
  Doc.prototype._paint = function (c, style) {
    if (style === 'F' || style === 'FD') { c.fillStyle = this.fill; c.fill(); }
    if (style !== 'F') { c.strokeStyle = this.draw; c.lineWidth = Math.max(0.6, this.lw * S); c.stroke(); }
  };
  Doc.prototype.rect = function (x, y, w, h, st) {
    const c = this.ctx(); c.save(); c.beginPath(); c.rect(x * S, y * S, w * S, h * S);
    this._paint(c, st || 'S'); c.restore(); return this;
  };
  Doc.prototype.circle = function (x, y, r, st) {
    const c = this.ctx(); c.save(); c.beginPath(); c.arc(x * S, y * S, r * S, 0, Math.PI * 2);
    this._paint(c, st || 'S'); c.restore(); return this;
  };
  Doc.prototype.triangle = function (x1, y1, x2, y2, x3, y3, st) {
    const c = this.ctx(); c.save(); c.beginPath();
    c.moveTo(x1 * S, y1 * S); c.lineTo(x2 * S, y2 * S); c.lineTo(x3 * S, y3 * S); c.closePath();
    this._paint(c, st || 'S'); c.restore(); return this;
  };
  Doc.prototype.line = function (x1, y1, x2, y2) {
    const c = this.ctx(); c.save(); c.beginPath();
    if (this.dash) c.setLineDash(this.dash.map(v => v * S));
    c.moveTo(x1 * S, y1 * S); c.lineTo(x2 * S, y2 * S);
    c.strokeStyle = this.draw; c.lineWidth = Math.max(0.6, this.lw * S); c.stroke();
    c.restore(); return this;
  };
  Doc.prototype.lines = function (segs, x, y, scale, st, closed) {
    const c = this.ctx(); const sx = (scale && scale[0]) || 1, sy = (scale && scale[1]) || 1;
    c.save(); c.beginPath(); c.moveTo(x * S, y * S);
    let px = x, py = y;
    for (let i = 0; i < segs.length; i++) { px += segs[i][0] * sx; py += segs[i][1] * sy; c.lineTo(px * S, py * S); }
    if (closed) c.closePath();
    this._paint(c, st || 'S'); c.restore(); return this;
  };
  Doc.prototype.addImage = function () { return this; };
  // Present so registerPdfFonts() succeeds and the report uses its real fonts;
  // the canvas draws with the same faces the page already has loaded.
  Doc.prototype.addFileToVFS = function () { return this; };
  Doc.prototype.addFont = function () { return this; };
  Doc.prototype.link = function (x, y, w, h, o) { this.links.push({ page: this.cur + 1, to: o.pageNumber }); return this; };
  Doc.prototype.save = function () { window.__pdfDone = { pages: this.pages.length, links: this.links }; };
  Doc.prototype.internal = null;
  const F = function (opts) {
    const d = new Doc();
    d.internal = { getNumberOfPages: function () { return d.pages.length; } };
    return d;
  };
  window.jspdf.jsPDF = F;
  const st = document.createElement('style');
  st.textContent = 'body{background:#333!important}main,header,nav,.toast,.scrim{display:none!important}' +
    'body::before{display:none!important}.pdfpage{display:block;margin:12px auto;box-shadow:0 0 0 1px #000}';
  document.head.appendChild(st);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  // fonts.status flips to 'loaded' before anything has been requested, so ask
  // for each face explicitly before the canvas measures with it.
  await page.evaluate(() => Promise.all([
    document.fonts.load('700 20px Orbitron'),
    document.fonts.load('400 20px "Exo 2"'),
    document.fonts.load('700 20px "Exo 2"'),
    document.fonts.load('italic 400 20px "Exo 2"')
  ]));

  await page.click('#nav-setup');
  await page.fill('#suLoggedBy', 'Fin Harker');
  await page.selectOption('#suRank', 'Lt Cmdr');

  await page.click('#nav-import');
  await page.click('button[aria-controls="impPasteBody"]');
  await page.fill('#impPaste', CSV);
  await page.click('#impPasteGo');
  await page.waitForSelector('#impConfig:not(.hidden)');
  await page.click('#impGo');
  await page.waitForSelector('#tab-analytics.active');

  /* roles and ratings, the two things the CSV does not carry */
  await page.click('#nav-log');
  const roles = ['Helm', 'Comms', 'Radar', 'Missiles', 'Navigation'];
  for (let i = 0; i < 8; i++) {
    await page.locator('.stars-host').nth(i).locator('[data-star="' + (2 + (i % 4)) + '"]').click();
  }
  for (let i = 0; i < 5; i++) {
    await page.locator('[data-edit]').nth(i).click();
    await page.waitForSelector('#msSave');
    await page.selectOption('#msRole', roles[i]);
    await page.click('#msSave');
    await page.waitForSelector('#scrim.hidden', { state: 'attached' });
  }
  await page.click('#nav-analytics');

  await page.evaluate(MOCK);
  await page.evaluate(() => document.getElementById('anExport').click());
  await page.waitForFunction(() => !!window.__pdfDone, null, { timeout: 60000 });
  const info = await page.evaluate(() => window.__pdfDone);

  const pages = await page.locator('.pdfpage').count();
  for (let i = 0; i < pages; i++) {
    await page.locator('.pdfpage').nth(i).screenshot({ path: path.join(OUT, 'p' + String(i + 1).padStart(2, '0') + '.png') });
  }
  await browser.close();
  console.log(JSON.stringify({ pages: info.pages, tocLinks: info.links, errors }, null, 2));
})();
