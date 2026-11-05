// Collecte d'une source, en respectant robots.txt et le rythme d'1 passage par jour.
import { isAllowed } from './robots.js';
import { looksLikeFeed, parseFeed, discoverFeeds, contestLinksFromPage } from './feeds.js';

export const MIN_INTERVAL_MS = 20 * 3600 * 1000; // ~1 passage par jour
export const ROBOT_NAME = 'JeuxConcoursPerso';

/** Peut-on interroger cette source maintenant ? */
export function canRun(source, status, now = Date.now()) {
  if (source.kind === 'local') return true; // le script Python gère lui-même le rythme
  if (!status || !status.lastRun) return true;
  if (!status.ok && !status.blocked) return now - status.lastRun > 3600 * 1000; // nouvel essai 1 h après une erreur
  return now - status.lastRun >= MIN_INTERVAL_MS;
}

/**
 * Vérifie robots.txt. Règle de la RFC 9309 : 4xx = pas de restriction,
 * erreur serveur ou réseau = on s'abstient.
 */
export async function robotsAllows(url, fetchText) {
  const u = new URL(url);
  const robotsUrl = `${u.origin}/robots.txt`;
  try {
    const r = await fetchText(robotsUrl);
    if (r.status >= 400 && r.status < 500) return { allowed: true, note: 'pas de robots.txt' };
    if (!r.ok) return { allowed: false, note: `robots.txt inaccessible (${r.status})` };
    const allowed = isAllowed(r.text, url, ROBOT_NAME);
    return { allowed, note: allowed ? 'autorisé par robots.txt' : 'interdit par robots.txt' };
  } catch (e) {
    return { allowed: false, note: `robots.txt inaccessible (${e.message})` };
  }
}

/**
 * @param {object} source
 * @param {(url:string)=>Promise<{ok:boolean,status:number,text:string}>} fetchText
 * @returns {Promise<{items: object[], note: string, blocked?: boolean}>}
 */
export async function collectSource(source, fetchText) {
  if (source.kind === 'local') {
    const r = await fetchText(source.url);
    if (!r.ok) throw new Error(`script Python injoignable (${r.status})`);
    const data = JSON.parse(r.text);
    const items = Array.isArray(data) ? data : data.items || [];
    return { items, note: `fichier local (${data.generated || 'date inconnue'})` };
  }

  const check = await robotsAllows(source.url, fetchText);
  if (!check.allowed) return { items: [], note: check.note, blocked: true };

  const page = await fetchText(source.url);
  if (!page.ok) throw new Error(`HTTP ${page.status}`);

  if (source.kind === 'rss' || looksLikeFeed(page.text)) {
    return { items: parseFeed(page.text, source.url), note: `flux RSS – ${check.note}` };
  }
  if (source.kind === 'auto') {
    const feeds = discoverFeeds(page.text, source.url);
    for (const feedUrl of feeds) {
      const fcheck = await robotsAllows(feedUrl, fetchText);
      if (!fcheck.allowed) continue;
      const f = await fetchText(feedUrl);
      if (f.ok && looksLikeFeed(f.text)) {
        const items = parseFeed(f.text, feedUrl);
        if (items.length) return { items, note: `flux RSS trouvé : ${feedUrl}`, feedUrl };
      }
    }
  }
  return { items: contestLinksFromPage(page.text, source.url), note: `lecture légère de la page – ${check.note}` };
}
