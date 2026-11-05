// Analyse du texte d'un concours : type, exclusion (payant), valeur, date de fin,
// organisateur, lot. Tout est "best effort" : vous pouvez corriger à la main.
import { normalize } from './text.js';
import { dateKey } from './dates.js';

export const TYPES = {
  tirage: 'Tirage au sort',
  instant: 'Instant gagnant',
  quotidien: 'Quotidien',
  social: 'Réseaux sociaux',
  creatif: 'Photo / créatif',
};

/** Type principal + indicateur "quotidien" (on peut rejouer chaque jour). */
export function detectType(text) {
  const t = normalize(text);
  const daily = /quotidien|chaque jour|tous les jours|1 participation par jour|une participation par jour|jouez chaque jour|rejouez demain|par jour et par|calendrier de l'avent|jeu de l'avent/.test(t);
  let type = 'tirage';
  if (/concours (photo|video|dessin|de dessin|creatif|d'ecriture|de recette)|photo (la plus|originale)|postez (votre|une) photo|envoyez (votre|une) (photo|creation|recette|video)|creation originale|meilleure (photo|recette|creation)|jury|vote du public/.test(t)) type = 'creatif';
  else if (/facebook|instagram|tiktok|twitter|\bx\.com|\bsur x\b|abonne[sz]?-vous|abonne-toi|likez|like ce post|commente[sz]?|identifie[sz]? (un|deux|2|3|tes|vos)|tag(ue)?[sz]? (un|deux|2|3)|partage[sz]? (ce|cette) (post|publication)|en story|repost/.test(t)) type = 'social';
  else if (/instants? gagnants?|resultat immediat|grattez|ticket a gratter|roue de la fortune|tournez la roue|jeu de grattage/.test(t)) type = 'instant';
  else if (daily) type = 'quotidien';
  return { type, daily: daily || type === 'quotidien' };
}

// Phrases qui SIGNALENT la gratuité : on les retire avant de chercher les
// indices de jeu payant (sinon "sans obligation d'achat" serait détecté).
const FREE_PHRASES = [
  /(sans|aucune|pas d') ?obligation d'achat/g, /sans (aucun )?achat/g, /aucun achat (n'est )?(requis|necessaire|obligatoire)/g,
  /gratuit(e|s)? et sans/g, /remboursement des frais (de connexion|d'affranchissement|de participation)[^.]*/g,
  /sans abonnement/g, /abonnement (offert|gratuit)/g, /an d'abonnement|mois d'abonnement|abonnement d'un an|abonnement de \d+/g,
];

const PAID_PATTERNS = [
  [/achat obligatoire|obligation d'achat/, 'achat obligatoire'],
  [/preuve d'achat|ticket de caisse|code[- ]barres?|code produit|code unique (present|figurant|inscrit)|sous (le|l'|les) (bouchon|opercule|etiquette)|pour (tout|1|un) achat|des \d+ ?(€|euros?) d'achat|sur presentation (du|d'un) (ticket|justificatif)|numero de lot|achete[sz]? (un|1|2|deux) produits?|achetez/, 'achat obligatoire'],
  [/abonnement (payant|obligatoire|requis)|souscri(re|ption) (a|d'un) (un )?(abonnement|contrat|offre)|reserve aux abonnes payants/, 'abonnement payant'],
  [/surtaxe|0 ?8 ?9\d|\b089\d|\b0 ?899\b|sms (au|a) (\d|0)|par sms au \d|\d+[.,]\d+ ?€ ?(\/|par) ?(min|appel|sms)|cout d'un sms|prix d'un sms/, 'numéro ou SMS surtaxé'],
  [/frais de (participation|dossier|inscription)|participation payante|mise de \d|droit d'entree/, 'participation payante'],
];

/** Renvoie la raison d'exclusion (jeu payant) ou null si le jeu semble gratuit. */
export function paidReason(text) {
  let t = normalize(text);
  for (const re of FREE_PHRASES) t = t.replace(re, ' ');
  for (const [re, reason] of PAID_PATTERNS) if (re.test(t)) return reason;
  return null;
}

/** Plus grand montant en euros trouvé (valeur du lot), ou null. */
export function extractValue(text) {
  const t = String(text).replace(/ | /g, ' ');
  const re = /(\d{1,3}(?:[ .]\d{3})+|\d+)(?:,(\d{1,2}))?\s?(?:€|eur\b|euros?\b)/gi;
  let max = null;
  let m;
  while ((m = re.exec(t))) {
    const v = Number(m[1].replace(/[ .]/g, '')) + (m[2] ? Number(m[2]) / 100 : 0);
    if (v > 0 && v < 5_000_000 && (max === null || v > max)) max = v;
  }
  return max;
}

const MONTHS = {
  janvier: 1, janv: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, octobre: 10, oct: 10, novembre: 11, nov: 11,
  decembre: 12, dec: 12,
};

function mkKey(y, m, d) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return dateKey(dt);
}

function findDates(t, now) {
  const found = [];
  let m;
  const num = /(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/g;
  while ((m = num.exec(t))) {
    const d = +m[1], mo = +m[2];
    let y = m[3] ? +m[3] : now.getFullYear();
    let k = mkKey(y, mo, d);
    if (k && !m[3] && k < dateKey(now)) k = mkKey(y + 1, mo, d);
    if (k) found.push({ index: m.index, key: k });
  }
  const txt = new RegExp(`(\\d{1,2})(?:er)? (${Object.keys(MONTHS).join('|')})\\.?(?: (\\d{4}))?`, 'g');
  while ((m = txt.exec(t))) {
    const d = +m[1], mo = MONTHS[m[2]];
    const y = m[3] ? +m[3] : now.getFullYear();
    let k = mkKey(y, mo, d);
    if (k && !m[3] && k < dateKey(now)) k = mkKey(y + 1, mo, d);
    if (k) found.push({ index: m.index, key: k });
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Date de fin AAAA-MM-JJ si elle est mentionnée, sinon null. */
export function extractEndDate(text, now = new Date()) {
  const t = normalize(text);
  const dates = findDates(t, now);
  if (!dates.length) return null;
  const marker = /(jusqu'(au|a)|fin (le|du jeu|du concours)?|se termine|termine le|date (de fin|limite)|avant le|cloture|au plus tard|expire|valable jusqu|prend fin)/g;
  let m;
  while ((m = marker.exec(t))) {
    const after = dates.find((d) => d.index >= m.index && d.index - m.index < 60);
    if (after) return after.key;
  }
  // "du 01/11 au 30/11" : la 2e date est la fin
  const range = t.match(/du \d{1,2}[^a]{0,20} au /);
  if (range) {
    const after = dates.find((d) => d.index > range.index + range[0].length - 4);
    if (after) return after.key;
  }
  return null;
}

const ORGA_STOP = /^(nous|vous|notre|votre|la redaction|le journal|l'equipe|nos|ce|cette|jeu|jeux|concours|grand jeu|quiz|instagram|facebook|tiktok|twitter|youtube|noel|instant gagnant|calendrier de l'avent|exclusif|exclu|nouveau|special|bonus)$/i;

/** Tente de deviner l'organisateur (marque, enseigne...). */
export function extractOrganizer(title, description = '', link = '') {
  const tries = [
    /[Jj]eux?[- ][Cc]oncours\s+([A-Z0-9][\w'’&.\- ]{1,40}?)\s*[:\-–|]/,
    /(?:organis[ée]+ par|offert(?:e|s|es)? par|propos[ée]+ par|en partenariat avec|avec la marque|avec l'enseigne)\s+([A-Z0-9][\w'’&.\-]+(?: [A-Z0-9][\w'’&.\-]+){0,3})/,
    /(?:^|\s)([A-Z][\w'’&.\-]+(?: [A-Z][\w'’&.\-]+){0,2}) vous (?:offre|fait gagner|propose)/,
    /\bavec ([A-Z][\w'’&.\-]+(?: [A-Z][\w'’&.\-]+){0,2})/,
    // "Instant gagnant quotidien Milka : ..." → le mot en majuscule juste avant les deux-points
    /([A-Z][\w'’&.\-]+(?: [A-Z][\w'’&.\-]+){0,2})\s*:\s/,
  ];
  for (const src of [title, description]) {
    for (const re of tries) {
      const m = String(src).match(re);
      if (!m) continue;
      const name = m[1].trim().replace(/[.,]$/, '').replace(/^(grand |super )?(jeux?|concours|jeu-concours)( concours)?\s+/i, '');
      if (name && !ORGA_STOP.test(name)) return name;
    }
  }
  try {
    if (link) {
      const host = new URL(link).hostname.replace(/^www\d?\./, '');
      return host.split('.').slice(0, -1).join('.') || host;
    }
  } catch { /* lien invalide */ }
  return '';
}

/** Le lot : ce qui suit "gagnez", "à gagner", etc. */
export function extractPrize(title, description = '') {
  for (const src of [title, description]) {
    const s = String(src);
    let m = s.match(/(?:gagne[zr]?|remporte[zr]?|tentez de gagner|a gagner\s*:?|à gagner\s*:?)\s+(.{3,140}?)(?:\s+[!–|]|\s+-\s+|[.!?]\s|$)/i);
    if (m) return m[1].replace(/^(:|\s)+/, '').trim();
    m = s.match(/^(.{3,140}?)\s+(?:à|a) gagner/i);
    if (m) return m[1].split(/\s:\s/).pop().trim();
  }
  return String(title).replace(/^jeux?[- ]concours\s*[:\-–]?\s*/i, '').trim();
}
