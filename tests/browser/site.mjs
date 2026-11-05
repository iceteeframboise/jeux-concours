// Test du site (version tablette) : npm run test:site
import { createRequire } from 'node:module';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const shots = process.env.SHOTS_DIR || path.join(tmpdir(), 'jc-shots');
mkdirSync(shots, { recursive: true });

// Données : le flux de test lu par le script Python, comme le fera GitHub chaque jour.
const out = mkdtempSync(path.join(tmpdir(), 'jc-site-'));
execFileSync('python3', [path.join(root, 'tools/build_site.py'), out]);
const items = JSON.parse(execFileSync('python3', ['-c', `
import json, sys; sys.path.insert(0, ${JSON.stringify(path.join(root, 'python'))})
import collecteur
items = collecteur.parse_feed(open(${JSON.stringify(path.join(root, 'tests/fixtures/flux.xml'))}, encoding='utf-8').read(), 'https://annuaire.example/')
for i in items: i['sourceId'] = 'test'
print(json.dumps(items))`]).toString());
writeFileSync(path.join(out, 'data/concours.json'), JSON.stringify({ generated: new Date().toISOString(), items }));
writeFileSync(path.join(out, 'data/etat.json'), JSON.stringify({ test: { ok: true, note: 'flux RSS', count: items.length } }));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(out, decodeURIComponent(req.url.split('?')[0]));
  if (existsSync(f) && statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!f.startsWith(out) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 800, height: 1280 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, locale: 'fr-FR' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.slice(0, -1) });
// Les sites des concours ne sont pas joignables pendant le test : on renvoie une page vide.
await ctx.route(/example/, (r) => r.fulfill({ contentType: 'text/html', body: '<h1>Page du concours</h1>' }));
const ok = (m) => console.log('  ✓ ' + m);
const errors = [];
try {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('article.contest');
  const groups = await page.$$eval('details.group > summary', (s) => s.map((x) => x.textContent.trim()));
  console.log('    familles :', groups.join(' | '));
  assert.equal(await page.$$eval('article.contest', (a) => new Set(a.map((x) => x.querySelector('.prize').textContent)).size), 3);
  ok('3 concours gratuits, classés par famille (payants écartés)');
  await page.screenshot({ path: path.join(shots, 'site-liste.png') });

  // Profil + copie
  await page.click('nav button[data-tab=profile]');
  await page.selectOption('select[name=civility]', 'Madame');
  await page.fill('[name=firstName]', 'Camille');
  await page.fill('[name=lastName]', 'Martin');
  await page.fill('[name=birthDate]', '1990-07-14');
  await page.click('#profile button[type=submit]');
  await page.locator('.field', { hasText: 'Date de naissance' }).locator('button').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '14/07/1990');
  ok('profil enregistré, bouton 📋 copie l\'info');

  // Participer → retour sur le site → question
  await page.click('nav button[data-tab=list]');
  const [concours] = await Promise.all([ctx.waitForEvent('page'), page.locator('article.contest', { hasText: 'PS5' }).first().locator('.go').click()]);
  await concours.waitForLoadState();
  assert.equal(concours.url(), 'https://www.sony.example/jeu-ps5');
  ok('« Participer » ouvre directement le formulaire de la marque');
  await concours.waitForTimeout(4200); // le temps de remplir le formulaire
  await concours.close();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForSelector('#ask:not([hidden])');
  await page.screenshot({ path: path.join(shots, 'site-question.png') });
  await page.click('#ask-yes');
  await page.click('nav button[data-tab=history]');
  assert.equal(await page.locator('#history-list .item').count(), 1);
  ok('au retour, « Avez-vous participé ? » → enregistré dans l\'historique');

  // Gain + persistance après rechargement
  await page.locator('#history-list button[title="J\'ai gagné !"]').click();
  await page.locator('#wins-list input[type=checkbox]').check();
  await page.reload();
  await page.waitForSelector('article.contest');
  await page.click('nav button[data-tab=wins]');
  assert.equal(await page.locator('#wins-list input[type=checkbox]').isChecked(), true);
  await page.click('nav button[data-tab=profile]');
  assert.equal(await page.inputValue('[name=firstName]'), 'Camille');
  ok('gain « reçu » et profil conservés après rechargement');

  // Correction de famille
  await page.click('nav button[data-tab=list]');
  const dior = page.locator('article.contest', { hasText: 'Dior' }).first();
  await dior.locator('.edit').click();
  await dior.locator('.fam-editor input[value=mode]').check();
  await dior.locator('.fam-editor button.primary').click();
  await page.waitForSelector('details.group summary:has-text("Mode")');
  ok('famille corrigée à la main');
  assert.deepEqual(errors, []);
  console.log(`\nTout est OK. Captures : ${shots}`);
} finally {
  await browser.close();
  server.close();
}
