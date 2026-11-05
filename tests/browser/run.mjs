// Test de bout en bout : charge l'extension dans Chromium, collecte une source
// locale, affiche les familles, ouvre un concours, vérifie le pré-remplissage
// (sans soumission) puis la détection de la page de confirmation.
//   npm run test:browser
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '../..');
const extPath = path.join(root, 'extension');
const shots = process.env.SHOTS_DIR || path.join(tmpdir(), 'jc-shots');
mkdirSync(shots, { recursive: true });

// ---- faux site "annuaire" + faux site "marque" ----
let base;
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const send = (body, type = 'text/html; charset=utf-8') => { res.writeHead(200, { 'Content-Type': type }); res.end(body); };
  if (url === '/robots.txt') return send('User-agent: *\nDisallow: /prive\n', 'text/plain');
  if (url === '/') return send('<html><head><link rel="alternate" type="application/rss+xml" href="/feed"></head><body>Annuaire</body></html>');
  if (url === '/feed') {
    const marque = base.replace('127.0.0.1', 'localhost');
    return send(readFileSync(path.join(root, 'tests/fixtures/flux.xml'), 'utf8')
      .replaceAll('https://annuaire.example', base)
      .replace('https://www.sony.example/jeu-ps5', `${marque}/form.html`), 'application/rss+xml');
  }
  if (url === '/concours/milka') return send(`<a href="${base.replace('127.0.0.1', 'localhost')}/form.html?milka">Participer au jeu</a>`);
  if (url === '/form.html') return send(readFileSync(path.join(here, 'form.html')));
  if (url === '/merci.html') return send(readFileSync(path.join(here, 'merci.html')));
  res.writeHead(404); res.end('404');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
base = `http://127.0.0.1:${server.address().port}`;

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'jc-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1100, height: 900 },
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const ok = (m) => console.log('  ✓ ' + m);
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  ok(`extension chargée (${extId})`);

  // 1. Profil via la page d'options
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/ui/options.html`);
  const p = { firstName: 'Camille', lastName: 'Martin', address: '12 rue des Vosges', zip: '67000', city: 'Strasbourg', email: 'camille@example.fr', phone: '0612345678', birthDate: '1990-07-14' };
  await opt.selectOption('select[name=civility]', 'Mme');
  for (const [k, v] of Object.entries(p)) await opt.fill(`[name=${k}]`, v);
  await opt.click('#profile button[type=submit]');
  await opt.waitForSelector('#profile-saved:has-text("Enregistré")');
  ok('profil enregistré localement');

  // Une seule source : notre annuaire local
  await sw.evaluate(async (url) => {
    // seule notre source locale est active (les sources par défaut restent décochées)
    await chrome.storage.local.set({ sources: [{ id: 'test', name: 'Annuaire test', url, kind: 'auto', enabled: true }] });
  }, base + '/');

  // 2. Collecte + affichage
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 460, height: 900 });
  await panel.goto(`chrome-extension://${extId}/ui/panel.html`);
  await panel.click('#btn-refresh');
  await panel.waitForSelector('article.contest');
  const groups = await panel.$$eval('details.group > summary', (s) => s.map((x) => x.textContent.trim()));
  console.log('    familles :', groups.join(' | '));
  assert.ok(groups.some((g) => g.includes('Jeux vidéo') && g.includes('(1)')));
  assert.ok(groups.some((g) => g.includes('Alimentation')));
  assert.ok(!groups.some((g) => g.includes('Électronique') && g.includes('(2)')), 'tablette de chocolat ≠ high-tech');
  assert.doesNotMatch(await panel.textContent('#status'), /problème/);
  assert.equal(await panel.$$eval('article.contest', (a) => new Set(a.map((x) => x.querySelector('.prize').textContent)).size), 3);
  ok('3 concours gratuits affichés, 2 payants écartés, classés par famille');
  const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
  assert.equal(badge, '', 'badge remis à zéro après consultation');
  ok('badge remis à zéro après consultation');
  await panel.screenshot({ path: path.join(shots, '1-panneau.png'), fullPage: true });

  // 2b. Une 2e collecte immédiate est refusée (1 passage par jour)
  const st1 = await sw.evaluate(async () => (await chrome.storage.local.get('sourceStatus')).sourceStatus.test.lastRun);
  await panel.click('#btn-refresh');
  await panel.waitForSelector('#status:has-text("1 passage par jour")');
  const st2 = await sw.evaluate(async () => (await chrome.storage.local.get('sourceStatus')).sourceStatus.test.lastRun);
  assert.equal(st1, st2);
  ok('2e collecte le même jour bloquée');

  // 3. Participer → formulaire pré-rempli, rien de soumis
  const ps5 = panel.locator('article.contest', { hasText: 'PS5' }).first();
  const [form] = await Promise.all([ctx.waitForEvent('page'), ps5.locator('.go').click()]);
  await form.waitForSelector('#jeux-concours-helper', { state: 'attached' });
  await form.waitForTimeout(300);
  const vals = await form.evaluate(() => Object.fromEntries([...document.querySelectorAll('input:not([type=radio]):not([type=checkbox]), select')].map((e) => [e.name, e.value])));
  console.log('    valeurs :', JSON.stringify(vals));
  assert.equal(vals.civilite, '2');
  assert.equal(vals.firstname, 'Camille');
  assert.equal(vals.lastname, 'Martin');
  assert.equal(vals.mail, 'camille@example.fr');
  assert.equal(vals.mobile, '0612345678');
  assert.equal(vals.cp, '67000');
  assert.equal(vals.ville, 'Strasbourg');
  assert.equal(vals.naissance_jour, '14');
  assert.equal(vals.naissance_mois, '7');
  assert.equal(vals.naissance_annee, '1990');
  assert.equal(vals.captcha_code, '', 'captcha non touché');
  assert.equal(await form.isChecked('[name=reglement]'), false, 'règlement non coché');
  assert.equal(await form.isChecked('[name=newsletter]'), false);
  assert.equal(await form.evaluate(() => [...document.querySelectorAll('[name=q1]')].some((r) => r.checked)), false, 'réponse suggérée mais pas cochée');
  assert.match(await form.evaluate(() => document.querySelector('[name=q1][value=b]').closest('label').style.outline), /solid/);
  assert.equal(new URL(form.url()).pathname, '/form.html', 'formulaire non soumis');
  ok('formulaire pré-rempli, règlement/captcha/réponse laissés à l\'utilisateur, pas de soumission');
  await form.screenshot({ path: path.join(shots, '2-formulaire.png'), fullPage: true });

  // 4. L'utilisateur coche et valide lui-même → confirmation détectée
  await form.check('[name=reglement]');
  await form.check('[name=q1][value=b]');
  await form.click('#valider');
  await form.waitForURL(/merci/);
  await form.waitForFunction(() => document.querySelector('#jeux-concours-helper')?.shadowRoot?.textContent.includes('Participation enregistrée'));
  const history = await sw.evaluate(async () => (await chrome.storage.local.get('history')).history);
  assert.equal(history.length, 1);
  assert.equal(history[0].how, 'confirmation');
  ok('page de confirmation détectée, concours marqué joué');
  await form.screenshot({ path: path.join(shots, '3-confirmation.png') });

  // 5. Fiche d'annuaire sans lien direct : on retrouve le lien du formulaire
  const milka = panel.locator('article.contest', { hasText: 'chocolat' }).first();
  const [f2] = await Promise.all([ctx.waitForEvent('page'), milka.locator('.go').click()]);
  await f2.waitForLoadState();
  assert.match(f2.url(), /localhost.*form\.html\?milka/);
  ok('lien direct du formulaire retrouvé depuis la fiche d\'annuaire');
  await f2.waitForSelector('#jeux-concours-helper', { state: 'attached' });
  await f2.evaluate(() => [...document.querySelector('#jeux-concours-helper').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.includes('Fait')).click());
  await panel.waitForTimeout(500);
  const h2 = await sw.evaluate(async () => (await chrome.storage.local.get('history')).history);
  assert.equal(h2.length, 2);
  assert.equal(h2[1].how, 'manuel');
  ok('bouton « Fait » de la page enregistre la participation');

  // 6. Correction manuelle de famille + quotidiens + gains
  await panel.reload();
  await panel.waitForSelector('article.contest');
  const dior = panel.locator('article.contest', { hasText: 'Dior' }).first();
  await dior.locator('.edit').click();
  await dior.locator('.fam-editor input[value=beaute_parfums]').uncheck();
  await dior.locator('.fam-editor input[value=mode]').check();
  await dior.locator('.fam-editor button.primary').click();
  await panel.waitForSelector('details.group summary:has-text("Mode")');
  ok('famille corrigée à la main');

  // le Milka quotidien joué "hier" apparaît dans "À refaire"
  await sw.evaluate(async () => {
    const { history } = await chrome.storage.local.get('history');
    const d = new Date(); d.setDate(d.getDate() - 1);
    const y = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    history[1].day = y; history[1].at -= 86400000;
    await chrome.storage.local.set({ history });
  });
  await panel.reload();
  await panel.click('nav button[data-tab=daily]');
  await panel.waitForSelector('#daily-list article.contest');
  ok('concours quotidien listé dans « À refaire »');
  await panel.screenshot({ path: path.join(shots, '4-a-refaire.png'), fullPage: true });

  await panel.click('nav button[data-tab=history]');
  await panel.locator('#history-list button[title="J\'ai gagné !"]').first().click();
  await panel.waitForSelector('#wins-list .item');
  await panel.locator('#wins-list input[type=checkbox]').check();
  const wins = await sw.evaluate(async () => (await chrome.storage.local.get('wins')).wins);
  assert.equal(wins.length, 1);
  await panel.waitForTimeout(200);
  assert.equal((await sw.evaluate(async () => (await chrome.storage.local.get('wins')).wins))[0].received, true);
  ok('journal des gains (ajout + « reçu »)');
  await panel.screenshot({ path: path.join(shots, '5-gains.png'), fullPage: true });

  // 7. Badge : un nouveau concours arrivé après la dernière ouverture
  await sw.evaluate(async () => {
    const { contests } = await chrome.storage.local.get('contests');
    contests.push({ ...contests[0], id: 'nouveau', title: 'Nouveau', link: 'https://x.example/n', formUrl: null, firstSeen: Date.now() + 1000 });
    await chrome.storage.local.set({ contests });
  });
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'updateBadge' }));
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '1');
  ok('badge : 1 nouveau concours');
  console.log(`\nTout est OK. Captures : ${shots}`);
} finally {
  await ctx.close();
  server.close();
}
