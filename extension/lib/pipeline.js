// Transforme un élément brut (issu d'un flux RSS, d'une page ou du script
// Python) en fiche "concours" complète.
import { hash, truncate, stripTags } from './text.js';
import { classify } from './categories.js';
import { detectPlatform, detectType, paidReason, extractValue, extractEndDate, extractOrganizer, extractPrize } from './analyze.js';
import { canonicalUrl } from './dedupe.js';
import { extractAnchors } from './feeds.js';
import { normalize } from './text.js';
import { dateKey } from './dates.js';

/**
 * @param {{title:string, link:string, description?:string, descriptionHtml?:string, categories?:string[]}} raw
 * @param {{id:string}} source
 * @returns {{contest?: object, excluded?: string}}
 */
export function buildContest(raw, source, now = new Date()) {
  const description = raw.description || stripTags(raw.descriptionHtml || '');
  const full = `${raw.title}. ${description} ${(raw.categories || []).join(' ')}`;
  const reason = paidReason(full);
  if (reason) return { excluded: reason, title: raw.title };

  let rulesUrl = raw.rulesUrl || null;
  let formUrl = raw.formUrl || null;
  if (raw.descriptionHtml) {
    for (const a of extractAnchors(raw.descriptionHtml, raw.link)) {
      const t = normalize(a.text);
      if (!rulesUrl && /reglement/.test(t)) rulesUrl = a.href;
      if (!formUrl && /particip|jouer|je joue|acceder au jeu|tenter ma chance/.test(t)) formUrl = a.href;
    }
  }

  const endDate = raw.endDate || extractEndDate(`${raw.title}. ${description}`, now);
  if (endDate && endDate < dateKey(now)) return { excluded: 'déjà terminé', title: raw.title };

  const detected = detectType(full);
  const platform = detectPlatform(full, formUrl || raw.link);
  const daily = detected.daily;
  // Un concours qui se joue sur Facebook/Instagram/TikTok est de type « Réseaux sociaux ».
  const type = platform !== 'web' && detected.type === 'tirage' ? 'social' : detected.type;
  const prize = extractPrize(raw.title, description);
  const ts = now.getTime();
  return {
    contest: {
      id: hash(canonicalUrl(raw.link)),
      title: raw.title,
      prize,
      organizer: raw.organizer || extractOrganizer(raw.title, description, formUrl || ''),
      value: raw.value ?? extractValue(full),
      link: raw.link,
      formUrl,
      rulesUrl,
      endDate,
      type,
      daily,
      platform,
      families: classify(`${raw.title} ${prize} ${description} ${(raw.categories || []).join(' ')}`),
      description: truncate(description, 400),
      sources: [source.id],
      firstSeen: ts,
      updated: ts,
    },
  };
}
