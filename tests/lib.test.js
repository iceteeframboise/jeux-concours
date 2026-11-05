import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify } from '../extension/lib/categories.js';
import { detectType, paidReason, extractValue, extractEndDate, extractOrganizer, extractPrize } from '../extension/lib/analyze.js';
import { parseFeed, discoverFeeds, contestLinksFromPage, findOutboundLinks, looksLikeFeed } from '../extension/lib/feeds.js';
import { isAllowed } from '../extension/lib/robots.js';
import { canonicalUrl, mergeContests, isSameContest } from '../extension/lib/dedupe.js';
import { buildContest } from '../extension/lib/pipeline.js';
import { applyFilters, sortContests, groupByFamily, dailyTodo, endingSoon, lastPlayedMap } from '../extension/lib/filters.js';
import { collectSource, canRun } from '../extension/lib/collect.js';

const NOW = new Date(2026, 10, 5, 10, 0, 0); // 5 novembre 2026
const RSS = readFileSync(new URL('./fixtures/flux.xml', import.meta.url), 'utf8');

test('classement par famille', () => {
  const cases = [
    ['Gagnez une PS5 et 2 manettes', ['jeux_video']],
    ['Un iPhone 17 Pro à gagner', ['high_tech']],
    ['Un panier gourmand de produits du terroir', ['alimentation']],
    ['Une palette de maquillage et un mascara', ['maquillage']],
    ['Un coffret parfum Chanel', ['beaute_parfums']],
    ['Des soins visage La Roche-Posay', ['soins']],
    ['Une paire de baskets Nike', ['mode', 'sport']],
    ['Un robot pâtissier KitchenAid', ['maison']],
    ['Un séjour de 7 nuits en Martinique', ['voyages']],
    ['2 places pour le concert de Zaz au Zénith de Strasbourg', ['sorties']],
    ['Une boîte de LEGO et une peluche', ['enfants']],
    ['Un an de croquettes pour votre chien', ['animaux']],
    ['Une carte cadeau Amazon de 100 €', ['bons_argent']],
    ['Gagnez 500 €', ['bons_argent']],
    ['Un vélo électrique', ['auto_moto_velo']],
    ['Un lot mystère', ['autres']],
    ['Des tablettes de chocolat Milka', ['alimentation']],
  ];
  for (const [text, expected] of cases) {
    const got = classify(text);
    for (const e of expected) assert.ok(got.includes(e), `${text} → ${got} (attendu ${e})`);
  }
  // "jeu-concours" ne fait pas un jeu vidéo, une valeur en € pas un bon d'achat
  assert.deepEqual(classify('Jeu-concours : un séjour en Alsace d\'une valeur de 800 €'), ['voyages']);
  // plusieurs familles possibles
  const multi = classify('Une PS5 et un week-end à Europa-Park');
  assert.ok(multi.includes('jeux_video') && multi.includes('voyages') && multi.includes('sorties'), String(multi));
});

test('type de concours', () => {
  assert.deepEqual(detectType('Instant gagnant : tentez votre chance'), { type: 'instant', daily: false });
  assert.deepEqual(detectType('Instant gagnant quotidien'), { type: 'instant', daily: true });
  assert.deepEqual(detectType('Jouez chaque jour pour gagner'), { type: 'quotidien', daily: true });
  assert.equal(detectType('Concours Instagram : abonnez-vous et commentez').type, 'social');
  assert.equal(detectType('Concours photo : envoyez votre photo de vacances').type, 'creatif');
  assert.equal(detectType('Grand tirage au sort de Noël').type, 'tirage');
});

test('exclusion des jeux payants', () => {
  assert.equal(paidReason('Jeu gratuit sans obligation d\'achat'), null);
  assert.equal(paidReason('Gagnez 1 an d\'abonnement Netflix'), null);
  assert.equal(paidReason('Achat obligatoire d\'un produit'), 'achat obligatoire');
  assert.equal(paidReason('Conservez votre ticket de caisse'), 'achat obligatoire');
  assert.equal(paidReason('Appelez le 0899 12 34 56'), 'numéro ou SMS surtaxé');
  assert.equal(paidReason('Envoyez JEU par SMS au 71030 (0,75 € par SMS)'), 'numéro ou SMS surtaxé');
  assert.equal(paidReason('Réservé aux abonnés payants, abonnement obligatoire'), 'abonnement payant');
});

test('valeur, date de fin, organisateur, lot', () => {
  assert.equal(extractValue('Lot d\'une valeur de 1 299,99 € et un bonus de 50 €'), 1299.99);
  assert.equal(extractValue('aucune valeur'), null);
  assert.equal(extractEndDate('Jeu jusqu\'au 30/11/2026 inclus', NOW), '2026-11-30');
  assert.equal(extractEndDate('Fin le 15 décembre 2026', NOW), '2026-12-15');
  assert.equal(extractEndDate('Du 01/11 au 20/11', NOW), '2026-11-20');
  assert.equal(extractEndDate('Se termine le 3 janvier', NOW), '2027-01-03');
  assert.equal(extractEndDate('Publié le 02/11/2026', NOW), null);
  assert.equal(extractOrganizer('Jeu concours Sony : gagnez une PS5'), 'Sony');
  assert.equal(extractOrganizer('Gagnez un séjour', 'Un jeu organisé par Alsace Tourisme.'), 'Alsace Tourisme');
  assert.equal(extractPrize('Jeu concours Sony : gagnez une PS5 et 2 manettes'), 'une PS5 et 2 manettes');
  assert.equal(extractPrize('Des tablettes de chocolat à gagner'), 'Des tablettes de chocolat');
  assert.equal(extractPrize('Instant gagnant quotidien Milka : des tablettes de chocolat à gagner'), 'des tablettes de chocolat');
  assert.equal(extractOrganizer('Instant gagnant quotidien Milka : des tablettes de chocolat à gagner'), 'Milka');
  assert.equal(extractOrganizer('Concours Instagram : gagnez un coffret'), '');
});

test('lecture RSS et découverte de flux', () => {
  assert.ok(looksLikeFeed(RSS));
  const items = parseFeed(RSS, 'https://annuaire.example/feed');
  assert.equal(items.length, 5);
  assert.equal(items[0].title, 'Jeu concours Sony : gagnez une PS5 et 2 manettes');
  assert.match(items[0].description, /valeur de 549,99/);
  assert.deepEqual(items[0].categories, ['High-Tech']);
  const atom = '<feed><entry><title>Gagnez un vélo</title><link rel="alternate" href="/v"/><summary>x</summary></entry></feed>';
  assert.equal(parseFeed(atom, 'https://a.example/')[0].link, 'https://a.example/v');
  const html = '<head><link rel="alternate" type="application/rss+xml" href="/feed/"><link rel="alternate" type="application/rss+xml" href="/comments/feed/"></head>';
  assert.deepEqual(discoverFeeds(html, 'https://a.example/'), ['https://a.example/feed/']);
});

test('scraping léger de page et liens sortants', () => {
  const page = `<nav><a href="/">Accueil</a><a href="/reglement">Règlement</a></nav>
    <a href="/jeux/velo-electrique">Gagnez un vélo électrique Decathlon</a>
    <a href="/jeux/velo-electrique">Gagnez un vélo électrique Decathlon</a>
    <a href="/article/meteo">La météo de la semaine en Alsace</a>
    <a href="/concours/places-racing">2 places pour le Racing Club de Strasbourg à gagner</a>`;
  const items = contestLinksFromPage(page, 'https://media.example/jeux-concours');
  assert.deepEqual(items.map((i) => i.link), ['https://media.example/jeux/velo-electrique', 'https://media.example/concours/places-racing']);
  const fiche = '<a href="https://annuaire.example/reglement-ps5">Règlement du jeu</a> <a href="https://www.marque.example/jeu">Participer au jeu</a>';
  assert.deepEqual(findOutboundLinks(fiche, 'https://www.annuaire.example/fiche/1'), {
    formUrl: 'https://www.marque.example/jeu', rulesUrl: 'https://annuaire.example/reglement-ps5',
  });
});

test('robots.txt', () => {
  const robots = `User-agent: *\nDisallow: /recherche\nDisallow: /*.pdf$\nAllow: /recherche/jeux\n\nUser-agent: BadBot\nDisallow: /`;
  assert.equal(isAllowed(robots, 'https://a.example/'), true);
  assert.equal(isAllowed(robots, 'https://a.example/recherche?q=x'), false);
  assert.equal(isAllowed(robots, 'https://a.example/recherche/jeux'), true);
  assert.equal(isAllowed(robots, 'https://a.example/doc.pdf'), false);
  assert.equal(isAllowed(robots, 'https://a.example/x', 'BadBot/1.0'), false);
  assert.equal(isAllowed('', 'https://a.example/x'), true);
});

test('pipeline : exclusion et doublons', () => {
  const items = parseFeed(RSS, 'https://annuaire.example/feed');
  const res = items.map((r) => buildContest(r, { id: 'test' }, NOW));
  const kept = res.filter((r) => r.contest).map((r) => r.contest);
  assert.equal(kept.length, 3, 'Super U (achat) et SMS surtaxé écartés');
  const ps5 = kept[0];
  assert.equal(ps5.organizer, 'Sony');
  assert.equal(ps5.value, 549.99);
  assert.equal(ps5.endDate, '2026-11-30');
  assert.equal(ps5.formUrl, 'https://www.sony.example/jeu-ps5');
  assert.equal(ps5.rulesUrl, 'https://annuaire.example/reglements/ps5.pdf');
  assert.ok(ps5.families.includes('jeux_video'));
  const milka = kept[1];
  assert.equal(milka.type, 'instant');
  assert.equal(milka.daily, true);
  assert.ok(milka.families.includes('alimentation'));
  assert.equal(kept[2].type, 'social');

  // le même concours sur un autre annuaire
  const other = buildContest({ title: 'Sony vous offre une PS5 et 2 manettes !', link: 'https://autre.example/ps5',
    description: 'Jusqu\'au 30/11/2026, avec Sony', formUrl: 'https://sony.example/jeu-ps5/?utm_campaign=x' }, { id: 'autre' }, NOW).contest;
  assert.ok(isSameContest(ps5, other));
  const { list, added } = mergeContests(kept, [other]);
  assert.equal(list.length, 3);
  assert.equal(added.length, 0);
  assert.deepEqual(list[0].sources, ['test', 'autre']);
  assert.equal(canonicalUrl('https://www.Sony.example/jeu-ps5/?utm_source=a#x'), 'sony.example/jeu-ps5');
  // concours terminé : écarté
  assert.equal(buildContest({ title: 'Gagnez un vélo', link: 'https://x.example/', description: 'jusqu\'au 01/10/2026' }, { id: 't' }, NOW).excluded, 'déjà terminé');
});

test('filtres, tri, regroupement, quotidiens, rappels', () => {
  const c = (id, extra) => ({ id, title: id, prize: id, organizer: '', families: ['autres'], type: 'tirage', daily: false, firstSeen: 1, ...extra });
  const list = [
    c('a', { endDate: '2026-11-05', families: ['voyages'], value: 300 }),
    c('b', { endDate: '2026-11-09', families: ['voyages', 'sorties'], value: 1000, firstSeen: 5 }),
    c('d', { endDate: '2026-12-31', daily: true, type: 'quotidien' }),
    c('old', { endDate: '2026-11-01' }),
  ];
  const ctx = { today: '2026-11-05', lastPlayed: { d: '2026-11-04' }, overrides: { a: ['mode'] } };
  assert.deepEqual(applyFilters(list, {}, ctx).map((x) => x.id), ['a', 'b', 'd']);
  assert.deepEqual(applyFilters(list, { end: 'today' }, ctx).map((x) => x.id), ['a']);
  assert.deepEqual(applyFilters(list, { end: 'week' }, ctx).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(applyFilters(list, { family: 'mode' }, ctx).map((x) => x.id), ['a'], 'correction manuelle prise en compte');
  assert.deepEqual(applyFilters(list, { notPlayed: true }, ctx).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(applyFilters(list, { dailyTodo: true }, ctx).map((x) => x.id), ['d']);
  assert.deepEqual(sortContests(list.slice(0, 3), 'value').map((x) => x.id), ['b', 'a', 'd']);
  assert.deepEqual(sortContests(list.slice(0, 3), 'new')[0].id, 'b');
  const groups = groupByFamily(list.slice(0, 3), ctx.overrides);
  assert.deepEqual(groups.map((g) => [g.family.id, g.items.length]), [['mode', 1], ['voyages', 1], ['sorties', 1], ['autres', 1]]);
  assert.deepEqual(dailyTodo(list, ctx.lastPlayed, '2026-11-05').map((x) => x.id), ['d']);
  assert.deepEqual(endingSoon(list, {}, NOW).map((x) => x.id), ['a']);
  assert.deepEqual(lastPlayedMap([{ id: 'x', day: '2026-11-01' }, { id: 'x', day: '2026-11-03' }]), { x: '2026-11-03' });
});

test('collecte : robots.txt respecté, RSS découvert, rythme quotidien', async () => {
  const site = {
    'https://ok.example/robots.txt': { status: 200, text: 'User-agent: *\nDisallow: /prive' },
    'https://ok.example/': { status: 200, text: '<link rel="alternate" type="application/rss+xml" href="/feed">' },
    'https://ok.example/feed': { status: 200, text: RSS },
    'https://non.example/robots.txt': { status: 200, text: 'User-agent: *\nDisallow: /' },
    'https://erreur.example/robots.txt': { status: 503, text: '' },
  };
  const calls = [];
  const fetchText = async (url) => {
    calls.push(url);
    const r = site[url] || { status: 404, text: '' };
    return { ok: r.status < 400, status: r.status, text: r.text };
  };
  const ok = await collectSource({ id: 'ok', url: 'https://ok.example/', kind: 'auto' }, fetchText);
  assert.equal(ok.items.length, 5);
  assert.match(ok.note, /flux RSS trouvé/);
  const no = await collectSource({ id: 'no', url: 'https://non.example/', kind: 'auto' }, fetchText);
  assert.equal(no.blocked, true);
  assert.ok(!calls.includes('https://non.example/'), 'page interdite jamais téléchargée');
  const err = await collectSource({ id: 'e', url: 'https://erreur.example/', kind: 'auto' }, fetchText);
  assert.equal(err.blocked, true, 'robots.txt en erreur serveur = on s\'abstient');

  const now = Date.now();
  assert.equal(canRun({ kind: 'auto' }, { lastRun: now - 3600e3, ok: true }, now), false);
  assert.equal(canRun({ kind: 'auto' }, { lastRun: now - 21 * 3600e3, ok: true }, now), true);
  assert.equal(canRun({ kind: 'auto' }, undefined, now), true);
});
