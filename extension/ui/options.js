import { api } from '../lib/api.js';
import { load, save, DEFAULTS } from '../lib/store.js';
import { robotsAllows, MIN_INTERVAL_MS } from '../lib/collect.js';
import { discoverFeeds, looksLikeFeed } from '../lib/feeds.js';
import { buildContest } from '../lib/pipeline.js';
import { mergeContests } from '../lib/dedupe.js';

const $ = (s) => document.querySelector(s);

async function fetchText(url) {
  const r = await fetch(url, { credentials: 'omit', cache: 'no-cache' });
  return { ok: r.ok, status: r.status, text: await r.text() };
}

// ---------- profil ----------
async function initProfile() {
  const { profile } = await load(['profile']);
  const form = $('#profile');
  for (const [k, v] of Object.entries(profile)) if (form.elements[k]) form.elements[k].value = v;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = Object.fromEntries(new FormData(form).entries());
    for (const k of Object.keys(p)) p[k] = String(p[k]).trim();
    await save({ profile: p });
    $('#profile-saved').textContent = 'Enregistré ✓';
    setTimeout(() => { $('#profile-saved').textContent = ''; }, 2500);
  });
}

// ---------- permission ----------
async function initGrant() {
  const perm = { origins: ['<all_urls>'] };
  const show = async () => {
    const ok = await api.permissions.contains(perm);
    $('#grant-state').textContent = ok ? '✓ accordé' : '✗ non accordé';
    $('#grant-state').className = ok ? 'ok' : 'ko';
  };
  $('#grant').addEventListener('click', async () => { await api.permissions.request(perm); show(); });
  show();
}

// ---------- sources ----------
async function renderSources() {
  const { sources, sourceStatus } = await load(['sources', 'sourceStatus']);
  const tbody = $('#sources');
  tbody.innerHTML = '';
  sources.forEach((s, i) => {
    const st = sourceStatus[s.id];
    const tr = document.createElement('tr');
    const next = st?.lastRun ? new Date(st.lastRun + MIN_INTERVAL_MS) : null;
    tr.innerHTML = `
      <td><input type="checkbox" ${s.enabled ? 'checked' : ''} ${s.cguInterdit ? 'disabled title="CGU : collecte interdite"' : ''}></td>
      <td><b></b> <span class="muted"></span><br><a target="_blank" rel="noopener"></a><br><small class="muted note"></small><div class="test"></div></td>
      <td>${st ? `<span class="${st.ok ? 'ok' : 'ko'}">${st.ok ? '✓' : '✗'}</span> ${new Date(st.lastRun).toLocaleString('fr-FR')}<br><small></small>` : '<span class="muted">jamais</span>'}</td>
      <td><button class="t">Tester</button> ${s.custom ? '<button class="d">Supprimer</button>' : ''}</td>`;
    tr.querySelector('b').textContent = s.name;
    tr.querySelector('span.muted').textContent = `(${s.group || 'perso'} · ${s.kind})`;
    tr.querySelector('a').href = s.url;
    tr.querySelector('a').textContent = s.url;
    tr.querySelector('.note').textContent = s.note || '';
    if (st) {
      tr.querySelector('td:nth-child(3) small').textContent =
        `${st.message || ''}${st.count != null ? ` · ${st.count} concours (${st.added || 0} nouveaux, ${st.excluded || 0} écartés)` : ''}` +
        (next && s.kind !== 'local' ? ` · prochain passage après ${next.toLocaleString('fr-FR')}` : '');
    }
    tr.querySelector('input').addEventListener('change', async (e) => {
      sources[i].enabled = e.target.checked;
      await save({ sources });
    });
    tr.querySelector('.t').addEventListener('click', () => testSource(s, tr.querySelector('.test')));
    tr.querySelector('.d')?.addEventListener('click', async () => {
      sources.splice(i, 1);
      await save({ sources });
      renderSources();
    });
    tbody.append(tr);
  });
}

async function testSource(s, box) {
  box.textContent = 'Test en cours…';
  try {
    if (s.kind === 'local') {
      const r = await fetchText(s.url);
      box.textContent = r.ok ? '✓ Script Python joignable.' : `✗ Réponse ${r.status}`;
      return;
    }
    const rb = await robotsAllows(s.url, fetchText);
    const lines = [`${rb.allowed ? '✓' : '✗'} robots.txt : ${rb.note}`];
    if (rb.allowed) {
      const r = await fetchText(s.url);
      if (!r.ok) lines.push(`✗ La page répond ${r.status}`);
      else if (looksLikeFeed(r.text)) lines.push('✓ L\'adresse est un flux RSS.');
      else {
        const feeds = discoverFeeds(r.text, s.url);
        lines.push(feeds.length ? `✓ Flux RSS trouvé(s) : ${feeds.join(', ')}` : 'ℹ️ Pas de flux RSS annoncé : lecture légère de la page.');
        const cgu = [...r.text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([^<]*(?:CGU|conditions|mentions l[ée]gales)[^<]*)<\/a>/gi)][0];
        if (cgu) lines.push(`📄 Conditions d'utilisation : ${new URL(cgu[1], s.url).href}`);
      }
    }
    box.innerHTML = '';
    for (const l of lines) { const d = document.createElement('div'); d.textContent = l; box.append(d); }
  } catch (e) {
    box.textContent = `✗ ${e.message} (accès aux sites accordé ?)`;
  }
}

$('#add-source').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const { sources } = await load(['sources']);
  sources.push({ id: 'perso-' + Date.now(), name: f.name.value, url: f.url.value, kind: f.kind.value, group: 'Perso', enabled: true, custom: true, note: '' });
  await save({ sources });
  f.reset();
  renderSources();
});

// ---------- rappels ----------
async function initSettings() {
  const { settings } = await load(['settings']);
  for (const k of ['notifyEnding', 'notifyDaily']) {
    $('#' + k).checked = !!settings[k];
    $('#' + k).addEventListener('change', async (e) => {
      const cur = (await load(['settings'])).settings;
      cur[k] = e.target.checked;
      await save({ settings: cur });
    });
  }
}

// ---------- import / export ----------
$('#import-json').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const items = Array.isArray(data) ? data : data.items || [];
    const { contests } = await load(['contests']);
    const fresh = [];
    let excluded = 0;
    for (const raw of items) {
      const r = buildContest(raw, { id: raw.sourceId || 'import' });
      if (r.contest) fresh.push(r.contest); else excluded++;
    }
    const merged = mergeContests(contests, fresh);
    await save({ contests: merged.list });
    await api.runtime.sendMessage({ type: 'updateBadge' });
    $('#import-state').textContent = `✓ ${merged.added.length} nouveaux concours, ${excluded} écartés (payants ou terminés).`;
  } catch (err) {
    $('#import-state').textContent = '✗ Fichier invalide : ' + err.message;
  }
});

$('#export').addEventListener('click', async () => {
  const all = await load();
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jeux-concours-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});

$('#restore').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => k in DEFAULTS));
  await save(clean);
  location.reload();
});

$('#wipe').addEventListener('click', async () => {
  if (!window.confirm('Effacer profil, historique, gains et concours ?')) return;
  await api.storage.local.clear();
  location.reload();
});

initProfile();
initGrant();
initSettings();
renderSources();
