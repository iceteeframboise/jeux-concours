// Sources proposées. "kind" :
//   auto  = on lit la page ; si elle annonce un flux RSS on l'utilise, sinon scraping léger des liens
//   rss   = l'URL est directement un flux RSS/Atom
//   page  = scraping léger des liens de la page (1 fois par jour maximum)
//   local = fichier JSON fourni par le script Python (python/collecteur.py --serve)
// "verified" indique si les conditions d'utilisation ont été lues par VOUS :
// l'extension ne collecte une source que si elle est cochée (enabled) ET que
// son robots.txt l'autorise.
export const DEFAULT_SOURCES = [
  // --- Annuaires de jeux-concours (vérifiés le 05/11/2026 : robots.txt + CGU) ---
  { id: 'toutgagner', name: 'Toutgagner', group: 'Annuaire', kind: 'auto',
    url: 'https://www.toutgagner.com/', enabled: true, note: 'Vérifié : robots.txt OK, CGU sans interdiction de collecte.' },
  { id: 'concours-fr', name: 'Concours.fr', group: 'Annuaire', kind: 'rss',
    url: 'https://www.concours.fr/feed/', enabled: true, note: 'Flux RSS. Vérifié.' },
  { id: 'concours-du-net', name: 'Concours du Net', group: 'Annuaire', kind: 'auto',
    url: 'https://www.concours-du-net.com/', enabled: true, note: 'Vérifié.' },
  { id: 'concours-du-net-instagram', name: 'Concours du Net – Instagram', group: 'Annuaire', kind: 'page',
    url: 'https://www.concours-du-net.com/concours-instagram', enabled: true, note: 'Rubrique Instagram. Vérifié.' },
  { id: 'lidl-plus', name: 'Lidl – jeux-concours Lidl Plus', group: 'Enseigne', kind: 'page',
    url: 'https://www.lidl.fr/c/jeux-concours-lidl-plus/s10072468', enabled: true, note: 'Vérifié.' },
  { id: 'jeu-concours-biz', name: 'Jeu-Concours.biz', group: 'Annuaire', kind: 'auto',
    url: 'https://www.jeu-concours.biz/', enabled: false, cguInterdit: true,
    note: 'Désactivé : ses CGU interdisent l\'extraction automatisée.' },

  // --- Médias régionaux Alsace / Grand Est ---
  { id: 'dna', name: 'DNA – Dernières Nouvelles d\'Alsace', group: 'Média régional', kind: 'auto',
    url: 'https://www.dna.fr/jeux-concours', enabled: false, note: 'robots.txt OK ; CGU à lire avant d\'activer.' },
  { id: 'lalsace', name: 'L\'Alsace', group: 'Média régional', kind: 'auto',
    url: 'https://www.lalsace.fr/jeux-concours', enabled: false, note: 'Adresse de la rubrique à confirmer.' },
  { id: 'estrepublicain', name: 'L\'Est Républicain', group: 'Média régional', kind: 'auto',
    url: 'https://www.estrepublicain.fr/jeux-concours', enabled: false, note: 'Adresse de la rubrique à confirmer.' },
  { id: 'republicain-lorrain', name: 'Le Républicain Lorrain', group: 'Média régional', kind: 'auto',
    url: 'https://www.republicain-lorrain.fr/jeux-concours', enabled: false, note: 'Adresse de la rubrique à confirmer.' },
  { id: 'ici-alsace', name: 'ici Alsace (ex-France Bleu)', group: 'Média régional', kind: 'auto',
    url: 'https://www.francebleu.fr/alsace', enabled: false, note: 'Les jeux sont souvent à l\'antenne : à vérifier.' },

  // --- Script Python local (si une source bloque l'extension) ---
  { id: 'local-python', name: 'Script Python (sur mon PC)', group: 'Local', kind: 'local',
    url: 'http://127.0.0.1:8765/concours.json', enabled: false,
    note: 'Lancez « python collecteur.py --serve » puis cochez cette source.' },
];
