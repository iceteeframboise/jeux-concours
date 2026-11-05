// Interprétation simple d'un fichier robots.txt (norme RFC 9309).

export function parseRobots(text = '') {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if (key === 'allow' || key === 'disallow') {
        if (value === '' && key === 'disallow') continue; // "Disallow:" vide = tout autorisé
        current.rules.push({ allow: key === 'allow', path: value });
      } else if (key === 'crawl-delay') {
        current.crawlDelay = Number(value) || null;
      }
    }
  }
  return groups;
}

function patternToRegex(p) {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

function pickGroup(groups, userAgent) {
  const ua = userAgent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  if (specific.length) return specific;
  return groups.filter((g) => g.agents.includes('*'));
}

/** true si l'URL peut être visitée par un robot portant ce nom. */
export function isAllowed(robotsText, url, userAgent = 'JeuxConcoursPerso') {
  const groups = pickGroup(parseRobots(robotsText), userAgent);
  if (!groups.length) return true;
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname) + u.search;
  let best = null;
  for (const g of groups) {
    for (const r of g.rules) {
      if (patternToRegex(r.path).test(path)) {
        const len = r.path.length;
        if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
      }
    }
  }
  return best ? best.allow : true;
}
