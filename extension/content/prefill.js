// Script injecté dans la page du concours, UNIQUEMENT après un clic sur
// « Participer ». Il :
//   - remplit les champs vides avec votre profil (surlignés en vert) ;
//   - signale les cases obligatoires à cocher VOUS-MÊME (surlignées en orange) ;
//   - suggère des réponses aux questions faciles (surlignées en jaune, NON cochées) ;
//   - détecte la page de confirmation ;
// Il ne clique JAMAIS sur le bouton de validation, ne coche aucune case de
// règlement et ne touche à aucun CAPTCHA.
(() => {
  if (globalThis.__jcRun) return; // déjà chargé dans ce cadre
  const api = globalThis.browser ?? globalThis.chrome;
  const IS_TOP = window.top === window;

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  // ---------- description d'un champ ----------
  function labelText(el) {
    const parts = [];
    if (el.id) {
      try {
        for (const l of document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`)) parts.push(l.textContent);
      } catch { /* id exotique */ }
    }
    const wrap = el.closest('label');
    if (wrap) parts.push(wrap.textContent);
    const by = el.getAttribute('aria-labelledby');
    if (by) for (const id of by.split(/\s+/)) parts.push(document.getElementById(id)?.textContent || '');
    if (!parts.length) {
      // texte juste avant le champ (formulaires sans <label>)
      let prev = el.previousElementSibling;
      if (prev && prev.textContent.length < 80) parts.push(prev.textContent);
      const parent = el.parentElement;
      if (parent && parent.textContent.length < 80) parts.push(parent.textContent);
    }
    return parts.join(' ');
  }

  function describe(el) {
    return norm([
      el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'),
      el.getAttribute('aria-label'), el.getAttribute('data-name'), labelText(el),
    ].join(' | '));
  }

  // ---------- reconnaissance des champs du profil ----------
  // Ordre important : le premier qui correspond gagne.
  const RULES = [
    ['skip', /captcha|recaptcha|hcaptcha|turnstile|password|mot de passe|parrain|code promo|coupon|honeypot|leave.?blank/],
    ['email', /e-?mail|courriel|adresse (electronique|mail)/],
    ['phone', /\btel\b|telephone|phone|mobile|portable|gsm|cellulaire/],
    ['birthDay', /(naiss|birth|dob|bday).*(jour|day|\bjj\b|\bdd\b)|(jour|day)[ _-]?(de )?(naiss|birth)/],
    ['birthMonth', /(naiss|birth|dob|bday).*(mois|month|\bmm\b)|(mois|month)[ _-]?(de )?(naiss|birth)/],
    ['birthYear', /(naiss|birth|dob|bday).*(annee|year|aaaa|yyyy)|(annee|year)[ _-]?(de )?(naiss|birth)/],
    ['birthDate', /naissance|birth|\bdob\b|bday|date de naiss|ne\(e\) le|nee? le/],
    ['zip', /code ?postal|\bcp\b|zip|postcode|postal|postal-code/],
    ['city', /\bville\b|\bcity\b|commune|localite|\btown\b|address-level2/],
    ['country', /\bpays\b|country/],
    ['address2', /complement|adresse ?2|address ?2|address-line2|batiment|appartement|lieu-dit/],
    ['address', /adresse|address|\brue\b|street|voie|address-line1/],
    ['civility', /civilite|civility|gender|genre|\bsexe\b|salutation|honorific|\btitle\b|\btitre\b/],
    ['firstName', /prenom|first.?name|given.?name|fname/],
    ['lastName', /\bnom\b|last.?name|family.?name|surname|lname|\bname\b/],
  ];

  function fieldKind(el) {
    const d = describe(el);
    const type = (el.type || '').toLowerCase();
    if (type === 'email') return 'email';
    if (type === 'tel') return 'phone';
    for (const [kind, re] of RULES) if (re.test(d)) {
      if (kind === 'lastName' && /utilisateur|user|pseudo|societe|entreprise|company|ville|city|rue/.test(d)) return null;
      return kind;
    }
    return null;
  }

  function toFrDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function valueFor(kind, el, p) {
    const birth = p.birthDate || '';
    const [by, bm, bd] = birth ? birth.split('-') : [];
    switch (kind) {
      case 'email': return p.email;
      case 'phone': return p.phone;
      case 'firstName': return p.firstName;
      case 'lastName': return p.lastName;
      case 'address': return p.address;
      case 'address2': return p.address2;
      case 'zip': return p.zip;
      case 'city': return p.city;
      case 'country': return p.country || 'France';
      case 'birthDate': return el.type === 'date' ? birth : toFrDate(birth);
      case 'birthDay': return bd;
      case 'birthMonth': return bm;
      case 'birthYear': return by;
      default: return '';
    }
  }

  // ---------- écriture compatible React/Vue/Angular ----------
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function chooseOption(select, wanted) {
    const w = norm(wanted);
    if (!w) return false;
    const opts = [...select.options];
    const num = String(Number(w));
    const match =
      opts.find((o) => norm(o.value) === w || norm(o.text) === w) ||
      opts.find((o) => /^\d+$/.test(w) && (String(Number(o.value)) === num || String(Number(o.text)) === num)) ||
      opts.find((o) => norm(o.text).startsWith(w));
    if (!match) return false;
    setNativeValue(select, match.value);
    return true;
  }

  const CIVILITY = {
    Mme: /^(mme|madame|mrs|ms|femme|f|feminin|female|mademoiselle|mlle)$/,
    M: /^(m|mr|m\.|monsieur|homme|h|masculin|male)$/,
  };

  function civilityMatches(text, civ) {
    const t = norm(text).replace(/\.$/, '');
    return civ && CIVILITY[civ]?.test(t);
  }

  function mark(el, color) {
    el.style.setProperty('outline', `3px solid ${color}`, 'important');
    el.style.setProperty('outline-offset', '1px', 'important');
  }

  // ---------- remplissage ----------
  function fill(profile) {
    let filled = 0;
    const handledRadioGroups = new Set();
    const inputs = document.querySelectorAll('input, select, textarea');
    for (const el of inputs) {
      if (el.disabled || el.readOnly) continue;
      const type = (el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password', 'checkbox', 'range', 'color'].includes(type)) continue;
      if (el.offsetParent === null && type !== 'radio') continue; // invisible : souvent un piège anti-robot
      if (type === 'radio') {
        if (!el.name || handledRadioGroups.has(el.name)) continue;
        handledRadioGroups.add(el.name);
        const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
        const groupDesc = norm(el.name + ' ' + (el.closest('fieldset')?.querySelector('legend')?.textContent || ''));
        const isCiv = /civilit|gender|genre|sexe|title|titre|salutation/.test(groupDesc) ||
          group.some((r) => civilityMatches(labelText(r) || r.value, 'Mme')) && group.some((r) => civilityMatches(labelText(r) || r.value, 'M'));
        if (isCiv && profile.civility && !group.some((r) => r.checked)) {
          const target = group.find((r) => civilityMatches(labelText(r), profile.civility) || civilityMatches(r.value, profile.civility));
          if (target) { target.click(); mark(target, '#1e8e3e'); filled++; }
        }
        continue;
      }
      const kind = fieldKind(el);
      if (!kind || kind === 'skip') continue;
      if (el.tagName === 'SELECT') {
        if (el.selectedIndex > 0 && el.value) continue;
        let ok = false;
        if (kind === 'civility') {
          const opt = [...el.options].find((o) => civilityMatches(o.text, profile.civility) || civilityMatches(o.value, profile.civility));
          if (opt) { setNativeValue(el, opt.value); ok = true; }
        } else {
          ok = chooseOption(el, valueFor(kind, el, profile));
        }
        if (ok) { mark(el, '#1e8e3e'); filled++; }
        continue;
      }
      if (el.value) continue; // on n'écrase jamais ce qui est déjà saisi
      if (kind === 'civility') continue;
      const v = valueFor(kind, el, profile);
      if (v) { setNativeValue(el, v); mark(el, '#1e8e3e'); filled++; }
    }
    return filled;
  }

  // Cases à cocher obligatoires : on les signale, on ne les coche pas.
  function flagCheckboxes() {
    let n = 0;
    for (const cb of document.querySelectorAll('input[type=checkbox]')) {
      if (cb.checked || cb.offsetParent === null) continue;
      const d = describe(cb);
      if (cb.required || /reglement|condition|cgu|accepte|certifie|majeur|obligatoire|\*/.test(d)) {
        mark(cb.closest('label') || cb, '#f29900');
        n++;
      }
    }
    return n;
  }

  // Questions faciles : on surligne l'option qui contient le nom de la marque
  // ou un mot du lot. On NE la sélectionne PAS.
  function suggestAnswers(contest) {
    const keys = [contest.organizer, ...(String(contest.prize || '').split(/\s+/))]
      .map(norm).filter((k) => k && k.length >= 4);
    if (!keys.length) return 0;
    let n = 0;
    const seen = new Set();
    for (const r of document.querySelectorAll('input[type=radio]')) {
      if (seen.has(r.name)) continue;
      const group = r.name ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(r.name)}"]`)] : [r];
      seen.add(r.name);
      if (group.some((x) => x.checked)) continue;
      const hit = group.find((x) => keys.some((k) => norm(labelText(x) + ' ' + x.value).includes(k)));
      if (hit) {
        const target = hit.closest('label') || hit;
        mark(target, '#fbbc04');
        target.title = 'Suggestion de Jeux-Concours (à vérifier et cocher vous-même)';
        n++;
      }
    }
    for (const s of document.querySelectorAll('select')) {
      if (s.selectedIndex > 0 || fieldKind(s)) continue;
      const opt = [...s.options].find((o) => keys.some((k) => norm(o.text).includes(k)));
      if (opt) {
        mark(s, '#fbbc04');
        s.title = `Suggestion : « ${opt.text.trim()} » (à choisir vous-même)`;
        n++;
      }
    }
    return n;
  }

  // ---------- détection de la confirmation ----------
  const CONFIRM_RE = /merci (pour|de) (votre|ta) participation|(votre|ta) participation (a bien ete|a ete|est bien|est) (enregistree|prise en compte|validee|confirmee)|participation (bien )?(enregistree|validee|confirmee)|vous etes (bien )?inscrit(e)? au (jeu|concours|tirage)|vous participez (desormais|maintenant) au tirage|deja participe aujourd'hui|vous avez deja (joue|participe)|c'est perdu|vous avez perdu|pas gagne cette fois|perdu !|vous avez gagne|felicitations,? vous (avez gagne|remportez)/;
  const WIN_RE = /vous avez gagne|felicitations,? vous (avez gagne|remportez)|vous remportez/;

  function pageText() {
    return norm(document.body ? document.body.innerText : '');
  }

  // ---------- barre d'information (Shadow DOM pour ne pas casser la page) ----------
  let bar = null;
  function showBar(state) {
    if (!bar) {
      const host = document.createElement('div');
      host.id = 'jeux-concours-helper';
      const narrow = window.innerWidth <= 520;
      host.style.cssText = `position:fixed;z-index:2147483647;bottom:${narrow ? 8 : 16}px;right:${narrow ? 8 : 16}px;${narrow ? 'left:8px;' : ''}`;
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        .b{font:14px/1.4 system-ui,sans-serif;background:#fff;color:#202124;border:2px solid #1a73e8;border-radius:10px;
           box-shadow:0 4px 18px rgba(0,0,0,.25);padding:10px 12px;max-width:340px}
        .t{font-weight:700;margin-bottom:4px} .m{margin:4px 0 8px} .r{display:flex;gap:6px;flex-wrap:wrap}
        button{font:inherit;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;background:#e8f0fe;color:#1a73e8}
        button.p{background:#1a73e8;color:#fff} .x{position:absolute;top:2px;right:6px;background:none;padding:2px 4px;color:#5f6368}
        .ok{border-color:#1e8e3e} .win{border-color:#f29900}
        .k{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:middle}
        @media (pointer:coarse){button{padding:10px 14px;font-size:15px} .x{padding:6px 10px}}
        @media (max-width:520px){.b{max-width:none}}
      </style><div class="b" part="box"><button class="x" title="Fermer">✕</button><div class="t"></div><div class="m"></div><div class="r"></div></div>`;
      document.documentElement.appendChild(host);
      bar = root;
      root.querySelector('.x').onclick = () => host.remove();
    }
    const box = bar.querySelector('.b');
    box.className = 'b ' + (state.cls || '');
    bar.querySelector('.t').textContent = state.title;
    bar.querySelector('.m').innerHTML = state.html;
    const row = bar.querySelector('.r');
    row.innerHTML = '';
    for (const btn of state.buttons || []) {
      const b = document.createElement('button');
      b.textContent = btn.label;
      if (btn.primary) b.className = 'p';
      b.onclick = btn.onClick;
      row.appendChild(b);
    }
  }

  let current = null;
  let confirmed = false;

  function send(msg) {
    try { return api.runtime.sendMessage(msg); } catch { return Promise.resolve(); }
  }

  function onConfirmed(text) {
    if (confirmed) return;
    confirmed = true;
    send({ type: 'confirmationDetected', id: current.contest.id });
    const won = WIN_RE.test(text);
    if (!IS_TOP) return;
    showBar({
      cls: won ? 'win' : 'ok',
      title: won ? '🎉 Il semble que vous ayez gagné !' : '✓ Participation enregistrée',
      html: won ? 'Ajoutez ce gain à votre journal pour suivre sa réception.' : 'Le concours est marqué comme joué aujourd\'hui dans l\'extension.',
      buttons: won ? [{ label: 'Ajouter au journal des gains', primary: true, onClick: () => {
        send({ type: 'addWin', id: current.contest.id, prize: current.contest.prize || current.contest.title, organizer: current.contest.organizer });
        showBar({ cls: 'ok', title: 'Gain ajouté au journal ✓', html: '', buttons: [] });
      } }] : [],
    });
  }

  function watchConfirmation(baseline) {
    const check = () => {
      const t = pageText();
      const m = t.match(CONFIRM_RE);
      if (m && !baseline.has(m[0])) onConfirmed(t);
    };
    check();
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(check, 400);
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  globalThis.__jcRun = (data) => {
    current = data;
    const profile = data.profile || {};
    const hasProfile = Object.values(profile).some(Boolean);
    const filled = hasProfile ? fill(profile) : 0;
    const boxes = flagCheckboxes();
    const hints = suggestAnswers(data.contest || {});

    // Texte de confirmation déjà présent au 1er chargement = pas une preuve.
    const baseline = new Set();
    if (!data.afterNavigation) {
      const m = pageText().match(CONFIRM_RE);
      if (m) baseline.add(m[0]);
    }
    watchConfirmation(baseline);

    if (!IS_TOP && filled === 0) return { filled };
    if (confirmed) return { filled };
    const lines = [];
    if (!hasProfile) lines.push('⚠️ Profil vide : remplissez-le dans les options de l\'extension.');
    if (filled) lines.push(`<span class="k" style="background:#1e8e3e"></span>${filled} champ(s) pré-rempli(s) : relisez-les.`);
    else if (hasProfile) lines.push('Aucun champ reconnu sur cette page (le formulaire est peut-être plus loin).');
    if (boxes) lines.push(`<span class="k" style="background:#f29900"></span>${boxes} case(s) à cocher vous-même (règlement…).`);
    if (hints) lines.push(`<span class="k" style="background:#fbbc04"></span>${hints} réponse(s) suggérée(s), non cochée(s).`);
    lines.push('<b>Validez vous-même</b> avec le bouton du site.');
    if (data.alreadyPlayedToday) lines.unshift('ℹ️ Déjà joué aujourd\'hui.');
    showBar({
      title: 'Jeux-Concours',
      html: lines.join('<br>'),
      buttons: [
        { label: '✓ Fait, j\'ai participé', primary: true, onClick: () => {
          send({ type: 'markPlayed', id: data.contest.id, how: 'manuel' });
          confirmed = true;
          showBar({ cls: 'ok', title: '✓ Marqué comme joué', html: 'Bonne chance !', buttons: [] });
        } },
        { label: 'Re-remplir', onClick: () => send({ type: 'refill' }) },
      ],
    });
    return { filled };
  };
})();
