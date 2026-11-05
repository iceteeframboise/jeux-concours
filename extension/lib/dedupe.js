// Détection des doublons : un même concours listé sur plusieurs sites.
import { normalize } from './text.js';

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|source$|xtor|at_)/i;

/** URL "canonique" : sans paramètres de suivi, sans www, sans / final. */
export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.hostname.replace(/^www\./, '')}${path}${u.search}`.toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

const STOP = new Set(('jeu jeux concours gagnez gagner gagne gratuit gratuits a au aux de des du d la le les l un une ' +
  'et ou en pour par avec sur votre vos vous ton tes nos notre ce cette ces tentez chance remportez remporter ' +
  'instant instants gagnant gagnants tirage sort participez participer grand special offert offerts offre').split(' '));

export function tokens(text) {
  return new Set(
    normalize(text).replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w))
  );
}

export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Deux concours sont-ils le même ? */
export function isSameContest(a, b) {
  const ua = canonicalUrl(a.formUrl || a.link);
  const ub = canonicalUrl(b.formUrl || b.link);
  if (ua === ub) return true;
  if (a.formUrl && b.formUrl && canonicalUrl(a.formUrl) === canonicalUrl(b.formUrl)) return true;
  if (a.endDate && b.endDate && a.endDate !== b.endDate) return false;
  const sim = similarity(tokens(`${a.title} ${a.organizer}`), tokens(`${b.title} ${b.organizer}`));
  const sameOrg = a.organizer && b.organizer && normalize(a.organizer) === normalize(b.organizer);
  return sim >= 0.75 || (sameOrg && sim >= 0.5);
}

/**
 * Ajoute les nouveaux concours à la liste existante en fusionnant les doublons.
 * @returns {{ list: object[], added: object[] }}
 */
export function mergeContests(existing, incoming) {
  const list = existing.map((c) => ({ ...c }));
  const added = [];
  for (const c of incoming) {
    const dup = list.find((e) => isSameContest(e, c));
    if (dup) {
      dup.sources = [...new Set([...(dup.sources || []), ...(c.sources || [])])];
      dup.endDate ||= c.endDate;
      dup.value ??= c.value;
      dup.formUrl ||= c.formUrl;
      dup.rulesUrl ||= c.rulesUrl;
      if (!dup.organizer && c.organizer) dup.organizer = c.organizer;
      dup.families = [...new Set([...(dup.families || []).filter((f) => f !== 'autres'), ...(c.families || []).filter((f) => f !== 'autres')])];
      if (!dup.families.length) dup.families = ['autres'];
      dup.updated = c.updated;
    } else {
      list.push(c);
      added.push(c);
    }
  }
  return { list, added };
}
