// Filtres, tri et regroupement pour l'affichage (fonctions pures, testables).
import { FAMILIES } from './categories.js';
import { dateKey, addDays, endOfDay } from './dates.js';
import { normalize } from './text.js';

export function familiesOf(c, overrides = {}) {
  return overrides[c.id] || c.families || ['autres'];
}

/** Map id -> dernière date (AAAA-MM-JJ) de participation, d'après l'historique. */
export function lastPlayedMap(history = []) {
  const map = {};
  for (const h of history) if (!map[h.id] || h.day > map[h.id]) map[h.id] = h.day;
  return map;
}

/** Concours quotidiens déjà joués au moins une fois mais pas aujourd'hui. */
export function dailyTodo(contests, lastPlayed, today = dateKey()) {
  return contests.filter((c) => c.daily && lastPlayed[c.id] && lastPlayed[c.id] < today && (!c.endDate || c.endDate >= today));
}

export function applyFilters(contests, opts = {}, ctx = {}) {
  const { overrides = {}, lastPlayed = {}, hidden = {}, today = dateKey() } = ctx;
  const week = addDays(today, 7);
  const q = normalize(opts.search || '');
  return contests.filter((c) => {
    if (hidden[c.id] && !opts.showHidden) return false;
    if (c.endDate && c.endDate < today) return false;
    if (opts.family && !familiesOf(c, overrides).includes(opts.family)) return false;
    if (opts.type && c.type !== opts.type && !(opts.type === 'quotidien' && c.daily)) return false;
    if (opts.platform && (c.platform || 'web') !== opts.platform) return false;
    if (opts.end === 'today' && c.endDate !== today) return false;
    if (opts.end === 'week' && !(c.endDate && c.endDate <= week)) return false;
    if (opts.notPlayed && lastPlayed[c.id]) return false;
    if (opts.dailyTodo && !(c.daily && lastPlayed[c.id] !== today)) return false;
    if (q && !normalize(`${c.title} ${c.organizer} ${c.prize}`).includes(q)) return false;
    return true;
  });
}

export function sortContests(list, sort = 'end') {
  const arr = [...list];
  if (sort === 'end') arr.sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999') || b.firstSeen - a.firstSeen);
  else if (sort === 'value') arr.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  else if (sort === 'new') arr.sort((a, b) => b.firstSeen - a.firstSeen);
  return arr;
}

/** [{ family, items }] dans l'ordre des familles ; un concours peut apparaître dans plusieurs groupes. */
export function groupByFamily(list, overrides = {}) {
  const groups = FAMILIES.map((f) => ({ family: f, items: [] }));
  const byId = Object.fromEntries(groups.map((g) => [g.family.id, g]));
  for (const c of list) for (const f of familiesOf(c, overrides)) (byId[f] || byId.autres).items.push(c);
  return groups.filter((g) => g.items.length);
}

/** Concours non joués qui se terminent dans les `hours` prochaines heures. */
export function endingSoon(contests, lastPlayed, now = new Date(), hours = 24) {
  return contests.filter((c) => {
    if (!c.endDate || lastPlayed[c.id]) return false;
    const diff = endOfDay(c.endDate) - now;
    return diff > 0 && diff <= hours * 3600 * 1000;
  });
}
