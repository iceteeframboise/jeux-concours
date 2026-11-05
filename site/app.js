// Site Jeux-Concours : affiche les concours collectés chaque jour par GitHub.
// Toutes vos données (profil, historique, gains) restent dans CE navigateur.
import { FAMILIES, FAMILY_BY_ID } from './lib/categories.js';
import { TYPES, PLATFORMS, detectPlatform, detectType, extractEndDate } from './lib/analyze.js';
import { classify } from './lib/categories.js';
import { canonicalUrl } from './lib/dedupe.js';
import { hash } from './lib/text.js';
import { buildContest } from './lib/pipeline.js';
import { mergeContests } from './lib/dedupe.js';
import { applyFilters, sortContests, groupByFamily, lastPlayedMap, dailyTodo, endingSoon, familiesOf } from './lib/filters.js';
import { dateKey, formatFr, addDays } from './lib/dates.js';

const $ = (s) => document.querySelector(s);
const KEY = 'jeux-concours-v1';
const FILTER_KEY = 'jeux-concours-filtres';
const DEFAULT = { profile: {}, contests: [], overrides: {}, hidden: {}, history: [], wins: [], lastVisit: 0, pending: null };

// ---------- stockage local ----------
function loadState() {
  try { return { ...structuredClone(DEFAULT), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return structuredClone(DEFAULT); }
}
let S = loadState();
let storageOk = true;
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { storageOk = false; }
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

function toast(msg) {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const t = el('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

// ---------- données du jour ----------
let previousVisit = S.lastVisit;
let sourceState = {};
let generated = null;

async function loadData() {
  const now = new Date();
  try {
    const [c, e] = await Promise.all([
      fetch('data/concours.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch('data/etat.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => ({})),
    ]);
    generated = c.generated;
    sourceState = e;
    const fresh = [];
    for (const raw of c.items || []) {
      const r = buildContest(raw, { id: raw.sourceId || 'site' }, now);
      if (r.contest) fresh.push(r.contest);
    }
    S.contests = mergeContests(S.contests, fresh).list;
  } catch (err) {
    console.warn('Données indisponibles', err);
  }
  // On oublie les concours finis depuis plus de 2 jours (ou sans date, vus il y a plus de 60 jours).
  const limit = addDays(dateKey(now), -2);
  const old = now.getTime() - 60 * 864e5;
  S.contests = S.contests.filter((c) => (c.endDate ? c.endDate >= limit : c.firstSeen > old));
  S.lastVisit = Date.now();
  persist();
}

// ---------- participation ----------
function markPlayed(id, how = 'manuel') {
  const day = dateKey();
  if (S.history.some((h) => h.id === id && h.day === day)) return;
  const c = S.contests.find((x) => x.id === id) || {};
  S.history.push({ id, title: c.prize || c.title || '(concours)', organizer: c.organizer || '', at: Date.now(), day, how, daily: !!c.daily });
  persist();
}

function askIfPlayed() {
  const p = S.pending;
  if (!p || Date.now() - p.at < 4000) return;
  const c = S.contests.find((x) => x.id === p.id);
  if (!c) { S.pending = null; persist(); return; }
  $('#ask-title').textContent = c.prize || c.title;
  $('#ask').hidden = false;
}
$('#ask-yes').addEventListener('click', () => {
  if (S.pending) markPlayed(S.pending.id);
  S.pending = null;
  persist();
  $('#ask').hidden = true;
  toast('Bien noté, bonne chance ! 🍀');
  render();
});
$('#ask-no').addEventListener('click', () => {
  S.pending = null;
  persist();
  $('#ask').hidden = true;
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') askIfPlayed(); });
window.addEventListener('focus', askIfPlayed);

// ---------- affichage d'un concours ----------
function card(c, lp) {
  const node = $('#tpl-card').content.firstElementChild.cloneNode(true);
  const today = dateKey();
  if (lp[c.id] === today) node.classList.add('played');
  node.querySelector('.new').hidden = !(previousVisit && c.firstSeen > previousVisit);
  node.querySelector('.prize').textContent = c.prize || c.title;
  node.querySelector('.prize').title = c.title;

  const meta = node.querySelector('.meta');
  const parts = [];
  if (c.organizer) parts.push(el('span', {}, `🏷 ${c.organizer}`));
  if (c.endDate) {
    const soon = c.endDate <= addDays(today, 1);
    parts.push(el('span', { class: soon ? 'soon' : '' }, `⏳ fin ${c.endDate === today ? "aujourd'hui" : formatFr(c.endDate)}`));
  } else parts.push(el('span', {}, '⏳ fin non indiquée'));
  if (c.platform && c.platform !== 'web') parts.push(el('span', {}, `📲 ${PLATFORMS[c.platform]}`));
  parts.push(el('span', {}, `🎲 ${TYPES[c.type] || c.type}${c.daily && c.type !== 'quotidien' ? ' · quotidien' : ''}`));
  if (c.value) parts.push(el('span', {}, `💶 ${Math.round(c.value).toLocaleString('fr-FR')} €`));
  if (lp[c.id]) parts.push(el('span', {}, `✓ joué le ${formatFr(lp[c.id])}`));
  parts.forEach((p, i) => { if (i) meta.append(' · '); meta.append(p); });

  const current = familiesOf(c, S.overrides);
  const fams = node.querySelector('.fams');
  for (const f of current) fams.append(el('span', { class: 'chip' }, `${FAMILY_BY_ID[f]?.emoji || ''} ${FAMILY_BY_ID[f]?.label || f}`));

  const go = node.querySelector('.go');
  go.href = c.formUrl || c.link;
  go.addEventListener('click', () => { S.pending = { id: c.id, at: Date.now() }; persist(); });
  const rules = node.querySelector('.rules');
  if (c.rulesUrl) rules.href = c.rulesUrl; else rules.remove();

  node.querySelector('.done').addEventListener('click', () => { markPlayed(c.id); render(); });
  node.querySelector('.hide').addEventListener('click', () => { S.hidden[c.id] = true; persist(); render(); toast('Concours masqué'); });

  const editor = node.querySelector('.fam-editor');
  node.querySelector('.edit').addEventListener('click', () => {
    editor.hidden = !editor.hidden;
    if (editor.hidden || editor.childElementCount) return;
    for (const f of FAMILIES) {
      const cb = el('input', { type: 'checkbox', value: f.id });
      cb.checked = current.includes(f.id);
      editor.append(el('label', {}, cb, `${f.emoji} ${f.label}`));
    }
    editor.append(
      el('button', { class: 'primary', onclick: () => {
        const chosen = [...editor.querySelectorAll('input:checked')].map((i) => i.value);
        S.overrides[c.id] = chosen.length ? chosen : ['autres'];
        persist(); render();
      } }, 'Enregistrer'),
      el('button', { onclick: () => { delete S.overrides[c.id]; persist(); render(); } }, 'Automatique'),
    );
  });
  return node;
}

// ---------- onglets ----------
function filterOpts() {
  return {
    search: $('#f-search').value, family: $('#f-family').value, type: $('#f-type').value, end: $('#f-end').value,
    platform: $('#f-platform').value,
    sort: $('#f-sort').value, notPlayed: $('#f-notplayed').checked, dailyTodo: $('#f-dailytodo').checked,
  };
}

function renderList(lp) {
  const opts = filterOpts();
  const ctx = { overrides: S.overrides, lastPlayed: lp, hidden: S.hidden };
  const visible = applyFilters(S.contests, {}, ctx);
  const list = sortContests(applyFilters(S.contests, opts, ctx), opts.sort);
  $('#n-list').textContent = `(${list.length})`;

  const newCount = previousVisit ? visible.filter((c) => c.firstSeen > previousVisit).length : 0;
  $('#new-count').hidden = !newCount;
  $('#new-count').textContent = `${newCount} nouveau${newCount > 1 ? 'x' : ''}`;

  // Rappel : non joués qui finissent dans 24 h
  const soon = endingSoon(visible, lp);
  const soonBox = $('#soon');
  soonBox.innerHTML = '';
  if (soon.length) {
    soonBox.append(el('div', { class: 'card soon-box' }, el('b', {}, `⏰ ${soon.length} concours non joué(s) finissent dans 24 h : `),
      soon.slice(0, 5).map((c) => c.prize || c.title).join(' · ')));
  }

  const box = $('#groups');
  box.innerHTML = '';
  if (!S.contests.length) {
    box.append(el('p', { class: 'muted' }, generated
      ? 'Aucun concours pour l\'instant. La collecte a lieu chaque matin.'
      : 'Pas encore de données : la première collecte a lieu chaque matin vers 6 h (ou lancez-la depuis GitHub, onglet Actions).'));
  } else if (!list.length) box.append(el('p', { class: 'muted' }, 'Aucun concours ne correspond aux filtres.'));

  const groups = groupByFamily(list, S.overrides);
  for (const g of groups) {
    const d = el('details', { class: 'group' });
    d.open = !!opts.family || list.length <= 30;
    d.append(el('summary', {}, `${g.family.emoji} ${g.family.label} `, el('span', { class: 'count' }, `(${g.items.length})`)));
    for (const c of g.items) d.append(card(c, lp));
    box.append(d);
  }
  const counts = Object.fromEntries(groupByFamily(visible, S.overrides).map((g) => [g.family.id, g.items.length]));
  for (const o of $('#f-family').options) {
    if (o.value) o.textContent = `${FAMILY_BY_ID[o.value].emoji} ${FAMILY_BY_ID[o.value].label} (${counts[o.value] || 0})`;
  }
}

function renderDaily(lp) {
  const todo = dailyTodo(S.contests.filter((c) => !S.hidden[c.id]), lp);
  $('#n-daily').textContent = todo.length ? `(${todo.length})` : '';
  const box = $('#daily-list');
  box.innerHTML = '';
  if (!todo.length) box.append(el('p', { class: 'muted' }, 'Rien à refaire pour l\'instant 🎉'));
  for (const c of todo) box.append(card(c, lp));
}

function renderHistory() {
  const box = $('#history-list');
  box.innerHTML = '';
  const items = [...S.history].sort((a, b) => b.at - a.at);
  if (!items.length) box.append(el('p', { class: 'muted' }, 'Aucune participation enregistrée.'));
  for (const h of items.slice(0, 300)) {
    box.append(el('div', { class: 'card item' },
      el('div', { class: 'grow' }, el('b', {}, h.title), el('br'),
        el('span', { class: 'muted' }, `${h.organizer ? h.organizer + ' · ' : ''}${new Date(h.at).toLocaleString('fr-FR')}`)),
      el('button', { title: 'J\'ai gagné !', onclick: () => {
        S.wins.push({ id: h.id, prize: h.title, organizer: h.organizer, date: dateKey(), received: false });
        persist(); render(); switchTab('wins');
      } }, '🏆'),
      el('button', { title: 'Annuler', onclick: () => {
        S.history = S.history.filter((x) => x !== h);
        persist(); render();
      } }, '✕')));
  }
}

function renderWins() {
  const box = $('#wins-list');
  box.innerHTML = '';
  if (!S.wins.length) box.append(el('p', { class: 'muted' }, 'Pas encore de gain. Bonne chance !'));
  S.wins.forEach((w, i) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!w.received;
    cb.addEventListener('change', () => { S.wins[i].received = cb.checked; persist(); });
    box.append(el('div', { class: 'card item' },
      el('div', { class: 'grow' }, el('b', {}, w.prize), el('br'),
        el('span', { class: 'muted' }, `${w.organizer || 'organisateur ?'} · gagné le ${formatFr(w.date)}`)),
      el('label', { class: 'row' }, cb, ' reçu'),
      el('button', { title: 'Supprimer', onclick: () => { S.wins.splice(i, 1); persist(); renderWins(); } }, '✕')));
  });
}

function renderSources() {
  const box = $('#sources');
  box.innerHTML = '';
  box.append(el('p', { class: 'muted' }, generated ? `Dernière collecte : ${new Date(generated).toLocaleString('fr-FR')}` : 'Aucune collecte pour l\'instant.'));
  for (const [id, s] of Object.entries(sourceState)) {
    box.append(el('div', {}, el('span', { class: s.ok ? 'ok' : 'warn' }, s.ok ? '✓ ' : '✗ '), `${id} : ${s.note || ''}${s.count != null ? ` (${s.count})` : ''}`));
  }
}

function render() {
  const lp = lastPlayedMap(S.history);
  renderList(lp);
  renderDaily(lp);
  renderHistory();
  renderWins();
  renderSources();
  if (!storageOk) toast('⚠️ Le navigateur refuse d\'enregistrer les données (navigation privée ?)');
}

function switchTab(name) {
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `tab-${name}`;
  window.scrollTo(0, 0);
}

// ---------- profil (avec boutons « copier ») ----------
const FIELDS = [
  ['firstName', 'Prénom', 'text', 'given-name'], ['lastName', 'Nom', 'text', 'family-name'],
  ['address', 'Adresse (n° et rue)', 'text', 'address-line1'], ['address2', 'Complément d\'adresse', 'text', 'address-line2'],
  ['zip', 'Code postal', 'text', 'postal-code'], ['city', 'Ville', 'text', 'address-level2'],
  ['email', 'E-mail', 'email', 'email'], ['phone', 'Téléphone', 'tel', 'tel'], ['birthDate', 'Date de naissance', 'date', 'bday'],
];
function initProfile() {
  const form = $('#profile');
  const box = $('#profile-fields');
  for (const [name, label, type, ac] of FIELDS) {
    const input = el('input', { name, type, autocomplete: ac });
    const copy = el('button', { type: 'button', title: 'Copier', onclick: async () => {
      let v = input.value;
      if (name === 'birthDate' && v) v = formatFr(v);
      if (!v) return;
      try { await navigator.clipboard.writeText(v); toast(`${label} copié`); } catch { toast('Copie impossible'); }
    } }, '📋');
    box.append(el('div', { class: 'field' }, el('label', {}, label, input), copy));
  }
  for (const [k, v] of Object.entries(S.profile)) if (form.elements[k]) form.elements[k].value = v;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    S.profile = Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v).trim()]));
    persist();
    $('#profile-saved').textContent = 'Enregistré ✓';
    setTimeout(() => { $('#profile-saved').textContent = ''; }, 2500);
  });
  $('#export').addEventListener('click', () => {
    const a = el('a', { download: `jeux-concours-sauvegarde-${dateKey()}.json` });
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    a.click();
  });
  $('#restore').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      S = { ...structuredClone(DEFAULT), ...JSON.parse(await f.text()) };
      persist();
      location.reload();
    } catch { toast('Fichier invalide'); }
  });
}

// ---------- filtres ----------
for (const f of FAMILIES) $('#f-family').append(el('option', { value: f.id }, `${f.emoji} ${f.label}`));
for (const [k, v] of Object.entries(TYPES)) $('#f-type').append(el('option', { value: k }, v));
for (const [k, v] of Object.entries(PLATFORMS)) $('#f-platform').append(el('option', { value: k }, v));
try {
  const f = JSON.parse(localStorage.getItem(FILTER_KEY) || '{}');
  for (const [k, id] of [['family', '#f-family'], ['type', '#f-type'], ['platform', '#f-platform'], ['end', '#f-end'], ['sort', '#f-sort']]) if (f[k]) $(id).value = f[k];
  $('#f-notplayed').checked = !!f.notPlayed;
  $('#f-dailytodo').checked = !!f.dailyTodo;
} catch { /* rien */ }
for (const id of ['#f-search', '#f-family', '#f-type', '#f-platform', '#f-end', '#f-sort', '#f-notplayed', '#f-dailytodo']) {
  $(id).addEventListener('input', () => {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filterOpts())); } catch { /* rien */ }
    renderList(lastPlayedMap(S.history));
  });
}
for (const b of document.querySelectorAll('nav button')) b.addEventListener('click', () => switchTab(b.dataset.tab));

$('#win-form').date.value = dateKey();
$('#win-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  S.wins.push({ id: null, prize: f.prize.value, organizer: f.organizer.value, date: f.date.value, received: false });
  persist();
  f.reset();
  f.date.value = dateKey();
  renderWins();
});

// ---------- ajout manuel (Facebook, Instagram…) ----------
function initAdd() {
  const form = $('#add-form');
  for (const [k, v] of Object.entries(PLATFORMS)) form.platform.append(el('option', { value: k }, v));
  for (const [k, v] of Object.entries(TYPES)) form.type.append(el('option', { value: k }, v));
  // Deviner la plateforme et le type dès que le lien est collé.
  form.link.addEventListener('input', () => {
    const p = detectPlatform('', form.link.value);
    form.platform.value = p;
    if (p !== 'web') form.type.value = 'social';
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const link = form.link.value.trim();
    const prize = form.prize.value.trim();
    const contest = {
      id: 'm' + hash(canonicalUrl(link)), title: prize, prize, organizer: form.organizer.value.trim(),
      value: null, link, formUrl: link, rulesUrl: null, endDate: form.endDate.value || null,
      type: form.type.value, daily: form.daily.checked, platform: form.platform.value,
      families: classify(prize), description: '', sources: ['ajout manuel'], manual: true,
      firstSeen: Date.now(), updated: Date.now(),
    };
    S.contests = S.contests.filter((c) => c.id !== contest.id);
    S.contests.push(contest);
    persist();
    form.reset();
    toast('Concours ajouté à votre liste ✓');
    render();
    switchTab('list');
  });
}

/** Partage depuis Facebook/Instagram (« Partager → Jeux-Concours ») : on pré-remplit le formulaire d'ajout. */
function handleShare() {
  const q = new URLSearchParams(location.search);
  if (!['partage_url', 'partage_texte', 'partage_titre'].some((k) => q.has(k))) return;
  const text = `${q.get('partage_titre') || ''} ${q.get('partage_texte') || ''}`.trim();
  const link = q.get('partage_url') || (text.match(/https?:\/\/\S+/) || [''])[0];
  const rest = text.replace(link, '').replace(/\s+/g, ' ').trim();
  const form = $('#add-form');
  form.link.value = link;
  form.link.dispatchEvent(new Event('input'));
  form.prize.value = rest.slice(0, 120);
  const end = extractEndDate(rest);
  if (end) form.endDate.value = end;
  const t = detectType(rest);
  if (t.daily) form.daily.checked = true;
  if (t.type !== 'tirage' && t.type !== 'quotidien') form.type.value = t.type;
  history.replaceState(null, '', location.pathname);
  switchTab('add');
  toast('Vérifiez puis touchez « Ajouter à ma liste »');
}

initProfile();
initAdd();
await loadData();
render();
handleShare();
askIfPlayed();
