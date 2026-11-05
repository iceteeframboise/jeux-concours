// Lecture des flux RSS/Atom et extraction légère de liens dans une page HTML.
// Écrit sans DOMParser (indisponible dans le service worker de l'extension).
import { stripTags, decodeEntities, getAttr, absoluteUrl, normalize } from './text.js';

function unCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function tagContent(block, name) {
  const esc = name.replace(':', '\\:');
  const m = block.match(new RegExp(`<${esc}\\b[^>]*>([\\s\\S]*?)<\\/${esc}>`, 'i'));
  return m ? unCdata(m[1]).trim() : '';
}

function allTags(block, name) {
  const esc = name.replace(':', '\\:');
  const re = new RegExp(`<${esc}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${esc}>)`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push({ attrs: m[1] || '', text: unCdata(m[2] || '').trim() });
  return out;
}

export function looksLikeFeed(text = '') {
  const head = text.slice(0, 2000).toLowerCase();
  return /<rss\b|<feed\b|<rdf:rdf\b/.test(head);
}

/**
 * Transforme un flux RSS 2.0 / Atom / RDF en liste d'éléments bruts :
 * { title, link, descriptionHtml, description, pubDate, categories }
 */
export function parseFeed(xml, baseUrl) {
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const block of blocks) {
    const title = stripTags(decodeEntities(tagContent(block, 'title')));
    let link = '';
    for (const l of allTags(block, 'link')) {
      const href = getAttr(l.attrs, 'href');
      const rel = getAttr(l.attrs, 'rel');
      if (href && (!rel || rel === 'alternate')) { link = href; break; }
      if (!href && l.text) { link = decodeEntities(l.text); break; }
    }
    if (!link) link = tagContent(block, 'guid');
    link = absoluteUrl(link.trim(), baseUrl);
    const rawDesc =
      tagContent(block, 'content:encoded') || tagContent(block, 'description') ||
      tagContent(block, 'content') || tagContent(block, 'summary');
    // Le contenu RSS est souvent du HTML "échappé" (&lt;p&gt;...) : on le décode une fois.
    const descriptionHtml = /&lt;/.test(rawDesc) ? decodeEntities(rawDesc) : rawDesc;
    const pubDate = tagContent(block, 'pubDate') || tagContent(block, 'published') ||
      tagContent(block, 'updated') || tagContent(block, 'dc:date');
    const categories = allTags(block, 'category')
      .map((c) => stripTags(decodeEntities(c.text || getAttr(c.attrs, 'term') || '')))
      .filter(Boolean);
    if (title && link) {
      items.push({ title, link, descriptionHtml, description: stripTags(descriptionHtml), pubDate, categories });
    }
  }
  return items;
}

/** Cherche <link rel="alternate" type="application/rss+xml" href="..."> dans une page. */
export function discoverFeeds(html, baseUrl) {
  const out = [];
  const re = /<link\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const rel = (getAttr(m[1], 'rel') || '').toLowerCase();
    const type = (getAttr(m[1], 'type') || '').toLowerCase();
    if (rel.includes('alternate') && /(rss|atom)\+xml/.test(type)) {
      const u = absoluteUrl(getAttr(m[1], 'href') || '', baseUrl);
      if (u && !/comments/i.test(u)) out.push(u);
    }
  }
  return [...new Set(out)];
}

/** Tous les liens <a> d'une page : [{ href, text, html }] */
export function extractAnchors(html, baseUrl) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = absoluteUrl(getAttr(m[1], 'href') || '', baseUrl);
    if (!href) continue;
    const text = stripTags(m[2]) || getAttr(m[1], 'title') || '';
    out.push({ href, text, attrs: m[1] });
  }
  return out;
}

const CONTEST_HINT = /concours|gagne|gagner|a gagner|tirage|instant gagnant|remporte|jeu-|\/jeux?\//;
// Liens de rubrique (« Concours Instagram », « Jeux concours gratuits »…) : ce ne sont pas des concours.
const CATEGORY_LINK = /^(les |tous les |toutes les )?(jeux?[- ])?concours( gratuits?)?( (sur )?(facebook|instagram|tiktok|twitter|x|reseaux sociaux|du jour|en cours|qui finissent.*|quotidiens?|instants? gagnants?))?$/;
const NAV_NOISE = /reglement|mentions legales|cgu|confidentialite|cookies|connexion|inscription|newsletter|contact|^jeux?(-| )concours$|toutes les|voir plus|page suivante|^\d+$/;

/**
 * Scraping léger d'une page "jeux-concours" : garde les liens dont le texte
 * ressemble à un concours. Renvoie des éléments bruts comme parseFeed.
 */
export function contestLinksFromPage(html, baseUrl) {
  const seen = new Set();
  const items = [];
  for (const a of extractAnchors(html, baseUrl)) {
    const t = normalize(a.text);
    const h = normalize(a.href);
    if (t.length < 15 || t.length > 250) continue;
    if (NAV_NOISE.test(t) || CATEGORY_LINK.test(t)) continue;
    if (!CONTEST_HINT.test(t) && !CONTEST_HINT.test(h)) continue;
    if (h.split('#')[0] === normalize(baseUrl).split('#')[0]) continue;
    if (seen.has(a.href)) continue;
    seen.add(a.href);
    items.push({ title: a.text, link: a.href, descriptionHtml: '', description: '', pubDate: '', categories: [] });
  }
  return items;
}

/**
 * Sur une fiche d'annuaire, trouve le lien sortant vers le formulaire de
 * l'organisateur et le lien du règlement.
 */
export function findOutboundLinks(html, pageUrl) {
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  let formUrl = null;
  let rulesUrl = null;
  const anchors = extractAnchors(html, pageUrl);
  for (const a of anchors) {
    const t = normalize(a.text);
    const ah = new URL(a.href).hostname.replace(/^www\./, '');
    if (!rulesUrl && /reglement/.test(t) && !/^reglement (du site|general)/.test(t)) rulesUrl = a.href;
    if (!formUrl && ah !== host && /particip|jouer|je joue|acceder au (jeu|concours)|tenter ma chance|lien du jeu|aller sur le (jeu|site)/.test(t)) {
      formUrl = a.href;
    }
  }
  return { formUrl, rulesUrl };
}
