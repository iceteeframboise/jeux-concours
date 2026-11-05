// Interface (fenêtre de l'icône, panneau latéral ou onglet complet).
import { api } from '../lib/api.js';
import { load, save } from '../lib/store.js';
import { FAMILIES, FAMILY_BY_ID } from '../lib/categories.js';
import { TYPES } from '../lib/analyze.js';
import { applyFilters, sortContests, groupByFamily, lastPlayedMap, dailyTodo, familiesOf } from '../lib/filters.js';
import { dateKey, formatFr, addDays } from '../lib/dates.js';

const $ = (s) => document.querySelector(s);
const PREF_KEY = 'jc-panel-filters';
const OPEN_KEY = 'jc-panel-open-groups';
let openGroups = {};
try { openGroups = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); } catch { /* pas grave */ }
let state = null;
let previousOpen = 0;

if (new URLSearchParams(location.search).has('full')) document.body.classList.add('full');

function send(msg) {
  return api.runtime.sendMessage(msg).then((r) => {
    if (r && !r.ok) throw new Error(r.error);
    return r?.result;
  });
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

async function refreshState() {
  state = await load(['contests', 'overrides', 'hidden', 'history', 'wins', 'sourceStatus', 'sources', 'profile']);
  state.lastPlayed = lastPlayedMap(state.history);
}

function filterOpts() {
  return {
    search: $('#f-search').value,
    family: $('#f-family').value,
    type: $('#f-type').value,
    end: $('#f-end').value,
    sort: $('#f-sort').value,
    notPlayed: $('#f-notplayed').checked,
    dailyTodo: $('#f-dailytodo').checked,
  };
}

function saveFilters() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(filterOpts())); } catch { /* pas grave */ }
}
function restoreFilters() {
  try {
    const f = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    for (const [k, id] of [['family', '#f-family'], ['type', '#f-type'], ['end', '#f-end'], ['sort', '#f-sort']]) if (f[k] != null) $(id).value = f[k];
    $('#f-notplayed').checked = !!f.notPlayed;
    $('#f-dailytodo').checked = !!f.dailyTodo;
  } catch { /* pas grave */ }
}

// ---------- carte d'un concours ----------
function card(c) {
  const node = $('#tpl-card').content.firstElementChild.cloneNode(true);
  const today = dateKey();
  const played = state.lastPlayed[c.id];
  if (played === today) node.classList.add('played');
  node.querySelector('.new').hidden = !(c.firstSeen > previousOpen);
  node.querySelector('.prize').textContent = c.prize || c.title;
  node.querySelector('.prize').title = c.title;

  const meta = node.querySelector('.meta');
  const parts = [];
  if (c.organizer) parts.push(el('span', {}, `🏷 ${c.organizer}`));
  if (c.endDate) {
    const soon = c.endDate <= addDays(today, 1);
    parts.push(el('span', { class: soon ? 'soon' : '' }, `⏳ fin ${c.endDate === today ? "aujourd'hui" : formatFr(c.endDate)}`));
  } else parts.push(el('span', {}, '⏳ fin non indiquée'));
  parts.push(el('span', {}, `🎲 ${TYPES[c.type] || c.type}${c.daily && c.type !== 'quotidien' ? ' · quotidien' : ''}`));
  if (c.value) parts.push(el('span', {}, `💶 ${Math.round(c.value).toLocaleString('fr-FR')} €`));
  if (played) parts.push(el('span', {}, `✓ joué le ${formatFr(played)}`));
  parts.forEach((p, i) => { if (i) meta.append(' · '); meta.append(p); });

  const fams = node.querySelector('.fams');
  const current = familiesOf(c, state.overrides);
  for (const f of current) fams.append(el('span', { class: 'chip' }, `${FAMILY_BY_ID[f]?.emoji || ''} ${FAMILY_BY_ID[f]?.label || f}`));
  if (state.overrides[c.id]) fams.append(el('span', { class: 'chip', title: 'Corrigé à la main' }, '✎'));

  const rules = node.querySelector('.rules');
  if (c.rulesUrl) rules.href = c.rulesUrl; else rules.remove();

  node.querySelector('.go').addEventListener('click', () => participate(c));
  node.querySelector('.done').addEventListener('click', async () => {
    await send({ type: 'markPlayed', id: c.id, how: 'manuel' });
    await render();
  });
  node.querySelector('.hide').addEventListener('click', async () => {
    state.hidden[c.id] = true;
    await save({ hidden: state.hidden });
    await send({ type: 'updateBadge' });
    render();
  });

  const editor = node.querySelector('.fam-editor');
  node.querySelector('.edit').addEventListener('click', () => {
    editor.hidden = !editor.hidden;
    if (editor.hidden || editor.childElementCount) return;
    for (const f of FAMILIES) {
      const cb = el('input', { type: 'checkbox', value: f.id });
      cb.checked = current.includes(f.id);
      editor.append(el('label', {}, cb, `${f.emoji} ${f.label}`));
    }
    const reset = el('button', { onclick: async () => {
      delete state.overrides[c.id];
      await save({ overrides: state.overrides });
      render();
    } }, 'Rétablir l\'automatique');
    const ok = el('button', { class: 'primary', onclick: async () => {
      const chosen = [...editor.querySelectorAll('input:checked')].map((i) => i.value);
      state.overrides[c.id] = chosen.length ? chosen : ['autres'];
      await save({ overrides: state.overrides });
      render();
    } }, 'Enregistrer');
    editor.append(ok, reset);
  });
  return node;
}

async function participate(c) {
  // Firefox demande l'autorisation d'accès aux sites au premier usage.
  try {
    const perm = { origins: ['<all_urls>'] };
    if (!(await api.permissions.contains(perm))) {
      const granted = await api.permissions.request(perm);
      if (!granted) notice("Sans l'accès aux sites, l'extension ouvre le concours mais ne peut pas pré-remplir le formulaire.");
    }
  } catch { /* Chrome : déjà accordé à l'installation */ }
  if (!Object.values(state.profile).some(Boolean)) {
    notice('Votre profil est vide : le formulaire ne sera pas pré-rempli.', 'Remplir mon profil', () => api.runtime.openOptionsPage());
  }
  try {
    await send({ type: 'participate', id: c.id });
  } catch (e) {
    notice('Impossible d\'ouvrir le concours : ' + e.message);
  }
}

// Message dans la fenêtre (les boîtes d'alerte ne fonctionnent pas dans les fenêtres d'extension de Firefox).
function notice(text, actionLabel, action) {
  const box = $('#notice');
  box.innerHTML = '';
  box.append(text);
  if (actionLabel) box.append(' ', el('button', { onclick: action }, actionLabel));
  box.append(' ', el('button', { onclick: () => { box.hidden = true; } }, '✕'));
  box.hidden = false;
}

// ---------- onglets ----------
function renderList() {
  const opts = filterOpts();
  const ctx = { overrides: state.overrides, lastPlayed: state.lastPlayed, hidden: state.hidden };
  const list = sortContests(applyFilters(state.contests, opts, ctx), opts.sort);
  const groups = groupByFamily(list, state.overrides);
  const box = $('#groups');
  box.innerHTML = '';
  $('#n-list').textContent = `(${list.length})`;
  if (!state.contests.length) {
    box.append(el('p', { class: 'muted' }, 'Aucun concours pour l\'instant. Cliquez sur ⟳ pour lancer la collecte, ou vérifiez les sources dans ⚙.'));
  } else if (!list.length) {
    box.append(el('p', { class: 'muted' }, 'Aucun concours ne correspond aux filtres.'));
  }
  for (const g of groups) {
    const d = el('details', { class: 'group' });
    const remembered = openGroups[g.family.id];
    d.open = opts.family ? true : remembered ?? list.length <= 30;
    d.addEventListener('toggle', () => {
      openGroups[g.family.id] = d.open;
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(openGroups)); } catch { /* pas grave */ }
    });
    d.append(el('summary', {}, `${g.family.emoji} ${g.family.label} `, el('span', { class: 'count' }, `(${g.items.length})`)));
    for (const c of g.items) d.append(card(c));
    box.append(d);
  }
  // Compteurs par famille dans le menu déroulant
  const counts = Object.fromEntries(groupByFamily(applyFilters(state.contests, {}, ctx), state.overrides).map((g) => [g.family.id, g.items.length]));
  for (const o of $('#f-family').options) {
    if (!o.value) continue;
    const f = FAMILY_BY_ID[o.value];
    o.textContent = `${f.emoji} ${f.label} (${counts[o.value] || 0})`;
  }
  // Statut des sources
  const st = Object.entries(state.sourceStatus);
  const last = st.reduce((m, [, s]) => Math.max(m, s.lastRun || 0), 0);
  $('#status').textContent = last
    ? `Dernière collecte : ${new Date(last).toLocaleString('fr-FR')} · ${state.contests.length} concours en mémoire`
    : 'Jamais collecté.';
}

function renderDaily() {
  const todo = dailyTodo(state.contests.filter((c) => !state.hidden[c.id]), state.lastPlayed);
  $('#n-daily').textContent = todo.length ? `(${todo.length})` : '';
  const box = $('#daily-list');
  box.innerHTML = '';
  if (!todo.length) box.append(el('p', { class: 'muted' }, 'Rien à refaire pour l\'instant 🎉'));
  for (const c of todo) box.append(card(c));
}

function renderHistory() {
  const box = $('#history-list');
  box.innerHTML = '';
  const items = [...state.history].sort((a, b) => b.at - a.at);
  if (!items.length) box.append(el('p', { class: 'muted' }, 'Aucune participation enregistrée.'));
  for (const h of items.slice(0, 300)) {
    box.append(el('div', { class: 'card item' },
      el('div', { class: 'grow' },
        el('strong', {}, h.title), el('br'),
        el('span', { class: 'muted' }, `${h.organizer ? h.organizer + ' · ' : ''}${new Date(h.at).toLocaleString('fr-FR')} · ${h.how === 'confirmation' ? 'détecté automatiquement' : 'marqué à la main'}`)),
      el('button', { title: 'J\'ai gagné !', onclick: async () => {
        await send({ type: 'addWin', id: h.id, prize: h.title, organizer: h.organizer });
        await render();
        switchTab('wins');
      } }, '🏆'),
      el('button', { title: 'Annuler cette participation', onclick: async () => {
        await send({ type: 'unmarkPlayed', id: h.id, day: h.day });
        render();
      } }, '✕')));
  }
}

function renderWins() {
  const box = $('#wins-list');
  box.innerHTML = '';
  if (!state.wins.length) box.append(el('p', { class: 'muted' }, 'Pas encore de gain enregistré. Bonne chance !'));
  state.wins.forEach((w, i) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!w.received;
    cb.addEventListener('change', async () => {
      state.wins[i].received = cb.checked;
      await save({ wins: state.wins });
    });
    box.append(el('div', { class: 'card item' },
      el('div', { class: 'grow' }, el('strong', {}, w.prize), el('br'),
        el('span', { class: 'muted' }, `${w.organizer || 'organisateur ?'} · gagné le ${formatFr(w.date)}`)),
      el('label', {}, cb, ' reçu'),
      el('button', { title: 'Supprimer', onclick: async () => {
        state.wins.splice(i, 1);
        await save({ wins: state.wins });
        renderWins();
      } }, '✕')));
  });
}

async function render() {
  await refreshState();
  renderList();
  renderDaily();
  renderHistory();
  renderWins();
}

function switchTab(name) {
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `tab-${name}`;
}

// ---------- initialisation ----------
for (const f of FAMILIES) $('#f-family').append(el('option', { value: f.id }, `${f.emoji} ${f.label}`));
for (const [k, v] of Object.entries(TYPES)) $('#f-type').append(el('option', { value: k }, v));
restoreFilters();

for (const b of document.querySelectorAll('nav button')) b.addEventListener('click', () => switchTab(b.dataset.tab));
for (const id of ['#f-search', '#f-family', '#f-type', '#f-end', '#f-sort', '#f-notplayed', '#f-dailytodo']) {
  $(id).addEventListener('input', () => { saveFilters(); renderList(); });
}
$('#btn-options').addEventListener('click', () => api.runtime.openOptionsPage());
$('#btn-refresh').addEventListener('click', async () => {
  $('#status').textContent = 'Collecte en cours…';
  try {
    const report = await send({ type: 'refresh' });
    await send({ type: 'panelOpened' }); // les concours affichés sont "vus" : le badge repart à zéro
    await render();
    const skipped = report.filter((r) => r.skipped).length;
    const errors = report.filter((r) => !r.skipped && !r.ok);
    let msg = $('#status').textContent;
    if (skipped) msg += ` · ${skipped} source(s) déjà collectée(s) aujourd'hui (1 passage par jour)`;
    if (errors.length) msg += ` · problème : ${errors.map((e) => e.message).join(' ; ')}`;
    $('#status').textContent = msg;
  } catch (e) {
    $('#status').textContent = 'Erreur : ' + e.message;
  }
});
// L'ouverture du panneau latéral doit se faire immédiatement dans le clic
// (exigence des navigateurs), d'où la récupération de la fenêtre à l'avance.
let windowId = null;
api.windows?.getCurrent().then((w) => { windowId = w.id; }).catch(() => {});
$('#btn-sidepanel').addEventListener('click', () => {
  const fallback = () => api.tabs.create({ url: api.runtime.getURL('ui/panel.html?full=1') });
  try {
    if (api.sidePanel?.open && windowId != null) {
      api.sidePanel.open({ windowId }).then(() => window.close(), fallback);
    } else if (api.sidebarAction?.open) {
      api.sidebarAction.open().then(() => window.close(), fallback);
    } else fallback();
  } catch {
    fallback();
  }
});
$('#win-form').date.value = dateKey();
$('#win-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  await send({ type: 'addWin', prize: f.prize.value, organizer: f.organizer.value, date: f.date.value });
  f.reset();
  f.date.value = dateKey();
  render();
});

// Mise à jour en direct quand l'arrière-plan modifie les données.
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.contests || changes.history || changes.wins)) render();
});

(async () => {
  const r = await send({ type: 'panelOpened' }).catch(() => ({ previous: 0 }));
  previousOpen = r?.previous || 0;
  await render();
})();
