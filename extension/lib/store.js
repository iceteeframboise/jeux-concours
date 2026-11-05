// Accès au stockage local de l'extension (rien n'est envoyé sur Internet).
import { api } from './api.js';
import { DEFAULT_SOURCES } from './sources.js';

export const DEFAULTS = {
  profile: {},          // civilité, nom, prénom, adresse...
  contests: [],         // fiches concours
  overrides: {},        // id -> familles corrigées à la main
  hidden: {},           // id -> true (concours masqués)
  history: [],          // [{ id, title, organizer, at, day, how }]
  wins: [],             // [{ id, prize, organizer, date, received }]
  sources: DEFAULT_SOURCES,
  sourceStatus: {},     // id -> { lastRun, ok, message, count }
  lastOpened: 0,        // dernière ouverture du panneau (pour "nouveaux")
  notified: {},         // id -> date de la notification "fin dans 24 h"
  settings: { notifyEnding: true, notifyDaily: true, lastDailyNotif: '' },
};

export async function load(keys = Object.keys(DEFAULTS)) {
  const data = await api.storage.local.get(keys);
  const out = {};
  for (const k of keys) out[k] = data[k] ?? structuredClone(DEFAULTS[k]);
  if (out.sources) {
    // Ajoute les nouvelles sources par défaut apparues dans une mise à jour.
    const ids = new Set(out.sources.map((s) => s.id));
    // Elles arrivent décochées : c'est à vous de lire leurs CGU avant de les activer.
    if (data.sources) for (const s of DEFAULT_SOURCES) if (!ids.has(s.id)) out.sources.push({ ...s, enabled: false });
  }
  return out;
}

export function save(obj) {
  return api.storage.local.set(obj);
}
