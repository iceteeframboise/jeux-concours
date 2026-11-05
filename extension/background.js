// Service worker (Chrome) / script d'arrière-plan (Firefox).
// Rôle : collecter les concours 1 fois par jour, gérer le badge, les rappels,
// ouvrir les formulaires et y injecter le pré-remplissage.
// IMPORTANT : rien ici ne clique sur un bouton de validation d'un site.
import { api } from './lib/api.js';
import { load, save } from './lib/store.js';
import { collectSource, canRun, robotsAllows } from './lib/collect.js';
import { buildContest } from './lib/pipeline.js';
import { mergeContests } from './lib/dedupe.js';
import { findOutboundLinks } from './lib/feeds.js';
import { lastPlayedMap, endingSoon, dailyTodo } from './lib/filters.js';
import { dateKey, addDays } from './lib/dates.js';

const TICK_MINUTES = 30;
const TRACK_MAX_MS = 30 * 60 * 1000; // on suit un onglet "Participer" pendant 30 min

// ---------- utilitaires ----------
async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { credentials: 'omit', cache: 'no-cache', signal: ctrl.signal, redirect: 'follow' });
    return { ok: r.ok, status: r.status, text: await r.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function updateBadge() {
  const { contests, lastOpened, hidden } = await load(['contests', 'lastOpened', 'hidden']);
  const n = contests.filter((c) => c.firstSeen > lastOpened && !hidden[c.id]).length;
  await api.action.setBadgeBackgroundColor({ color: '#d93025' });
  await api.action.setBadgeText({ text: n ? String(Math.min(n, 999)) : '' });
}

function prune(contests, now = new Date()) {
  const limit = addDays(dateKey(now), -2);
  const old = now.getTime() - 60 * 24 * 3600 * 1000;
  return contests.filter((c) => (c.endDate ? c.endDate >= limit : c.firstSeen > old));
}

// ---------- collecte ----------
let collecting = null;

async function collectAll() {
  if (collecting) return collecting;
  collecting = (async () => {
    const st = await load(['sources', 'sourceStatus', 'contests']);
    let contests = st.contests;
    const report = [];
    for (const source of st.sources.filter((s) => s.enabled)) {
      const status = st.sourceStatus[source.id];
      if (!canRun(source, status)) {
        report.push({ id: source.id, skipped: true });
        continue;
      }
      const now = new Date();
      try {
        const { items, note, blocked } = await collectSource(source, fetchText);
        let excluded = 0;
        const fresh = [];
        for (const raw of items) {
          const r = buildContest(raw, source, now);
          if (r.contest) fresh.push(r.contest);
          else excluded++;
        }
        const merged = mergeContests(contests, fresh);
        contests = merged.list;
        st.sourceStatus[source.id] = {
          lastRun: now.getTime(), ok: !blocked, blocked: !!blocked, message: note,
          count: fresh.length, added: merged.added.length, excluded,
        };
      } catch (e) {
        st.sourceStatus[source.id] = { lastRun: now.getTime(), ok: false, message: `Erreur : ${e.message}` };
      }
      report.push({ id: source.id, ...st.sourceStatus[source.id] });
    }
    await save({ contests: prune(contests), sourceStatus: st.sourceStatus });
    await updateBadge();
    return report;
  })();
  try {
    return await collecting;
  } finally {
    collecting = null;
  }
}

// ---------- rappels ----------
async function reminders() {
  const { contests, history, notified, settings, hidden } = await load(['contests', 'history', 'notified', 'settings', 'hidden']);
  const lp = lastPlayedMap(history);
  const visible = contests.filter((c) => !hidden[c.id]);
  const today = dateKey();
  if (settings.notifyEnding) {
    const soon = endingSoon(visible, lp).filter((c) => !notified[c.id]);
    if (soon.length) {
      await api.notifications.create('ending-' + Date.now(), {
        type: 'basic',
        iconUrl: api.runtime.getURL('icons/icon128.png'),
        title: soon.length === 1 ? 'Un concours se termine bientôt' : `${soon.length} concours se terminent dans 24 h`,
        message: soon.slice(0, 4).map((c) => `• ${c.prize || c.title}`).join('\n'),
      });
      for (const c of soon) notified[c.id] = today;
      await save({ notified });
    }
  }
  if (settings.notifyDaily && settings.lastDailyNotif !== today && new Date().getHours() >= 9) {
    const todo = dailyTodo(visible, lp, today);
    if (todo.length) {
      await api.notifications.create('daily-' + today, {
        type: 'basic',
        iconUrl: api.runtime.getURL('icons/icon128.png'),
        title: `${todo.length} concours quotidien(s) à refaire aujourd'hui`,
        message: todo.slice(0, 4).map((c) => `• ${c.prize || c.title}`).join('\n'),
      });
    }
    settings.lastDailyNotif = today;
    await save({ settings });
  }
}

async function tick() {
  try { await collectAll(); } catch (e) { console.warn('collecte', e); }
  try { await reminders(); } catch (e) { console.warn('rappels', e); }
}

// ---------- participation ----------
async function getTracked() {
  const { tracked = {} } = await api.storage.session.get('tracked');
  return tracked;
}
async function setTracked(tracked) {
  await api.storage.session.set({ tracked });
}

/** Sur une fiche d'annuaire, cherche le lien direct du formulaire (1 requête, à la demande). */
async function resolveFormUrl(contest, sources) {
  if (contest.formUrl) return contest.formUrl;
  const linkHost = new URL(contest.link).hostname.replace(/^www\./, '');
  const fromDirectory = sources.some((s) => {
    try { return new URL(s.url).hostname.replace(/^www\./, '') === linkHost; } catch { return false; }
  });
  if (!fromDirectory) return contest.link;
  try {
    const ok = await robotsAllows(contest.link, fetchText);
    if (!ok.allowed) return contest.link;
    const r = await fetchText(contest.link);
    if (!r.ok) return contest.link;
    const { formUrl, rulesUrl } = findOutboundLinks(r.text, contest.link);
    const { contests } = await load(['contests']);
    const c = contests.find((x) => x.id === contest.id);
    if (c) {
      c.formUrl = formUrl || null;
      c.rulesUrl ||= rulesUrl;
      await save({ contests });
    }
    return formUrl || contest.link;
  } catch {
    return contest.link;
  }
}

async function participate(id) {
  const { contests, sources } = await load(['contests', 'sources']);
  const contest = contests.find((c) => c.id === id);
  if (!contest) throw new Error('Concours introuvable');
  const url = await resolveFormUrl(contest, sources);
  const tab = await api.tabs.create({ url, active: true });
  const tracked = await getTracked();
  tracked[tab.id] = { id, since: Date.now(), loads: 0 };
  await setTracked(tracked);
  return { url };
}

async function inject(tabId, info) {
  const { profile, contests, history } = await load(['profile', 'contests', 'history']);
  const c = contests.find((x) => x.id === info.id) || { id: info.id, title: '' };
  const data = {
    profile,
    contest: { id: c.id, title: c.title, organizer: c.organizer, prize: c.prize },
    afterNavigation: info.loads > 1,
    alreadyPlayedToday: history.some((h) => h.id === c.id && h.day === dateKey()),
  };
  try {
    await api.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content/prefill.js'] });
    await api.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (d) => globalThis.__jcRun && globalThis.__jcRun(d),
      args: [data],
    });
  } catch (e) {
    console.warn('Injection impossible (permission manquante ?)', e.message);
  }
}

async function markPlayed(id, how) {
  const { history, contests } = await load(['history', 'contests']);
  const day = dateKey();
  if (history.some((h) => h.id === id && h.day === day)) return { already: true };
  const c = contests.find((x) => x.id === id) || {};
  history.push({ id, title: c.prize || c.title || '(concours)', organizer: c.organizer || '', at: Date.now(), day, how, daily: !!c.daily });
  await save({ history });
  return { ok: true };
}

// ---------- écouteurs (enregistrés au démarrage, comme l'exige Manifest V3) ----------
api.runtime.onInstalled.addListener(() => {
  api.alarms.create('tick', { periodInMinutes: TICK_MINUTES, delayInMinutes: 1 });
});
api.runtime.onStartup.addListener(() => {
  api.alarms.create('tick', { periodInMinutes: TICK_MINUTES, delayInMinutes: 1 });
});
api.alarms.onAlarm.addListener((a) => { if (a.name === 'tick') tick(); });

api.tabs.onUpdated.addListener(async (tabId, change) => {
  if (change.status !== 'complete') return;
  const tracked = await getTracked();
  const info = tracked[tabId];
  if (!info) return;
  if (Date.now() - info.since > TRACK_MAX_MS) {
    delete tracked[tabId];
    await setTracked(tracked);
    return;
  }
  info.loads += 1;
  await setTracked(tracked);
  await inject(tabId, info);
});

api.tabs.onRemoved.addListener(async (tabId) => {
  const tracked = await getTracked();
  if (tracked[tabId]) {
    delete tracked[tabId];
    await setTracked(tracked);
  }
});

api.notifications.onClicked.addListener(() => {
  api.tabs.create({ url: api.runtime.getURL('ui/panel.html?full=1') });
});

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    refresh: () => collectAll(),
    participate: () => participate(msg.id),
    markPlayed: () => markPlayed(msg.id, msg.how || 'manuel'),
    confirmationDetected: () => markPlayed(msg.id, 'confirmation'),
    unmarkPlayed: async () => {
      const { history } = await load(['history']);
      await save({ history: history.filter((h) => !(h.id === msg.id && h.day === msg.day)) });
      return { ok: true };
    },
    addWin: async () => {
      const { wins } = await load(['wins']);
      wins.push({ id: msg.id || null, prize: msg.prize || '', organizer: msg.organizer || '', date: msg.date || dateKey(), received: false });
      await save({ wins });
      return { ok: true };
    },
    refill: async () => {
      const tracked = await getTracked();
      const tabId = msg.tabId ?? sender.tab?.id;
      if (tracked[tabId]) await inject(tabId, { ...tracked[tabId], loads: 1 });
      return { ok: true };
    },
    panelOpened: async () => {
      const { lastOpened } = await load(['lastOpened']);
      await save({ lastOpened: Date.now() });
      await updateBadge();
      return { previous: lastOpened };
    },
    updateBadge: () => updateBadge(),
  };
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve(h())
    .then((r) => sendResponse({ ok: true, result: r }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // réponse asynchrone
});
