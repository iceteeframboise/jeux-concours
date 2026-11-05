// Sources proposées. "kind" :
//   auto  = on lit la page ; si elle annonce un flux RSS on l'utilise, sinon scraping léger des liens
//   rss   = l'URL est directement un flux RSS/Atom
//   page  = scraping léger des liens de la page (1 fois par jour maximum)
//   local = fichier JSON fourni par le script Python (python/collecteur.py --serve)
// "verified" indique si les conditions d'utilisation ont été lues par VOUS :
// l'extension ne collecte une source que si elle est cochée (enabled) ET que
// son robots.txt l'autorise.
export const DEFAULT_SOURCES = [
  // --- Annuaires de jeux-concours ---
  { id: 'jeu-concours-biz', name: 'Jeu-Concours.biz', group: 'Annuaire', kind: 'auto',
    url: 'https://www.jeu-concours.biz/', enabled: true,
    note: 'Source de la version 1. Lisez ses CGU (lien en bas de page du site) avant usage.' },
  { id: 'toutgagner', name: 'Toutgagner', group: 'Annuaire', kind: 'auto',
    url: 'https://www.toutgagner.com/', enabled: false, note: 'À vérifier (CGU + robots.txt).' },
  { id: 'concoursmania', name: 'Concoursmania', group: 'Annuaire', kind: 'auto',
    url: 'https://www.concoursmania.com/', enabled: false, note: 'À vérifier (CGU + robots.txt).' },
  { id: 'jeux-concours-fr', name: 'Jeuxconcours.fr', group: 'Annuaire', kind: 'auto',
    url: 'https://www.jeuxconcours.fr/', enabled: false, note: 'À vérifier (CGU + robots.txt).' },

  // --- Médias régionaux Alsace / Grand Est ---
  { id: 'dna', name: 'DNA – Dernières Nouvelles d\'Alsace', group: 'Média régional', kind: 'auto',
    url: 'https://www.dna.fr/jeux-concours', enabled: false, note: 'Adresse de la rubrique à confirmer.' },
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
