// Classement automatique des concours par famille, à partir de mots-clés.
// Les mots-clés sont écrits SANS accents et en minuscules (le texte est
// normalisé avant comparaison). Un "*" final = n'importe quelle terminaison
// (ex. "parfum*" trouve parfum, parfums, parfumerie).
import { normalize } from './text.js';

export const FAMILIES = [
  { id: 'jeux_video', label: 'Jeux vidéo et consoles', emoji: '🎮', keywords: [
    'jeu video', 'jeux video', 'jeux-video', 'console*', 'ps5', 'ps4', 'playstation', 'xbox', 'nintendo',
    'switch 2', 'switch oled', 'manette*', 'gaming', 'gamer', 'steam deck', 'casque gaming', 'fortnite',
    'minecraft', 'mario', 'pokemon', 'zelda', 'fifa', 'ea sports fc', 'call of duty', 'jeu pc', 'carte cadeau steam',
    'retrogaming', 'meta quest', 'casque vr', 'realite virtuelle'] },
  { id: 'high_tech', label: 'Électronique et high-tech', emoji: '📱', keywords: [
    'smartphone*', 'iphone*', 'samsung galaxy', 'galaxy', 'pixel', 'telephone portable', 'tablette*', 'ipad*',
    'ordinateur*', 'pc portable', 'macbook', 'laptop', 'tv', 'televiseur*', 'television', 'oled', 'qled', 'ecran*',
    'videoprojecteur', 'enceinte*', 'barre de son', 'casque audio', 'casque bluetooth', 'ecouteur*', 'airpods',
    'montre connectee', 'apple watch', 'smartwatch', 'appareil photo', 'gopro', 'drone*', 'imprimante',
    'high-tech', 'high tech', 'bluetooth', 'sonos', 'bose', 'jbl', 'kindle', 'liseuse'] },
  { id: 'alimentation', label: 'Alimentation et boissons', emoji: '🍫', keywords: [
    'chocolat*', 'cafe', 'cafes', 'the vert', 'thes', 'infusion*', 'vin', 'vins', 'champagne*', 'biere*', 'boisson*', 'jus', 'soda*',
    'panier gourmand', 'gourmand*', 'gastronom*', 'epicerie', 'fromage*', 'confiserie*', 'bonbon*', 'biscuit*',
    'gateau*', 'recette*', 'cuisine', 'repas', 'restaurant*', 'diner', 'brunch', 'produits du terroir',
    'coffret degustation', 'degustation', 'foie gras', 'charcuterie', 'miel', 'confiture*', 'cereales',
    'yaourt*', 'glace*', 'pates', 'huile d\'olive', 'courses', 'bon d\'achat alimentaire', 'nespresso', 'dolce gusto',
    'whisky', 'rhum', 'spiritueux', 'cave a vin', 'ble', 'snack*', 'aperitif', 'boulangerie', 'patisserie*'] },
  { id: 'maquillage', label: 'Maquillage', emoji: '💄', keywords: [
    'maquillage', 'make-up', 'make up', 'mascara*', 'rouge a levres', 'gloss', 'fond de teint', 'palette*',
    'fard*', 'vernis', 'eyeliner', 'crayon a levres', 'blush', 'anticernes', 'anti-cernes', 'poudre',
    'highlighter', 'baume a levres teinte', 'sephora', 'kiko', 'maybelline', 'nyx', 'bourjois'] },
  { id: 'beaute_parfums', label: 'Produits de beauté et parfums', emoji: '🌸', keywords: [
    'parfum*', 'eau de toilette', 'eau de parfum', 'fragrance*', 'coffret beaute', 'beaute', 'box beaute',
    'cosmetique*', 'nocibe', 'marionnaud', 'yves rocher', 'l\'occitane', 'institut de beaute', 'spa',
    'manucure', 'lisseur', 'seche-cheveux', 'seche cheveux', 'dyson airwrap', 'boucleur', 'epilat*'] },
  { id: 'soins', label: 'Soins (visage, corps, cheveux)', emoji: '🧴', keywords: [
    'soin*', 'creme*', 'serum*', 'shampo*', 'apres-shampo*', 'masque capillaire', 'masque visage', 'gel douche',
    'savon*', 'lait corps', 'hydratant*', 'anti-age', 'anti-rides', 'nettoyant', 'demaquillant*', 'deodorant*',
    'huile seche', 'huile de soin', 'baume', 'creme solaire', 'protection solaire', 'cheveux', 'capillaire*',
    'visage', 'corps', 'dentifrice', 'brosse a dents', 'rasoir*', 'barbe', 'la roche-posay', 'nuxe',
    'avene', 'vichy', 'caudalie', 'garnier', 'nivea', 'dove', 'cosmetiques bio', 'pharmacie', 'parapharmacie'] },
  { id: 'mode', label: 'Mode et accessoires', emoji: '👗', keywords: [
    'vetement*', 'mode', 'robe*', 'pull*', 'jean', 'jeans', 'chemise*', 'tee-shirt*', 't-shirt*', 'sweat*',
    'manteau*', 'veste*', 'chaussure*', 'basket*', 'sneakers', 'bottes', 'escarpins', 'sac a main', 'sacs',
    'sac', 'maroquinerie', 'bijou*', 'collier*', 'bracelet*', 'bague*', 'boucles d\'oreilles', 'montre', 'montres',
    'lunettes', 'lunettes de soleil', 'echarpe*', 'lingerie', 'maillot de bain', 'pret-a-porter', 'accessoire*',
    'portefeuille', 'ceinture', 'casquette'] },
  { id: 'maison', label: 'Maison, déco et électroménager', emoji: '🏠', keywords: [
    'maison', 'deco', 'decoration', 'meuble*', 'canape*', 'literie', 'matelas', 'oreiller*', 'couette*',
    'linge de maison', 'electromenager', 'aspirateur*', 'robot cuiseur', 'robot patissier', 'thermomix',
    'cookeo', 'airfryer', 'air fryer', 'friteuse*', 'machine a cafe', 'cafetiere', 'expresso', 'bouilloire',
    'blender', 'mixeur', 'four', 'micro-ondes', 'lave-linge', 'lave-vaisselle', 'refrigerateur', 'frigo',
    'cocotte*', 'casserole*', 'poele*', 'ustensile*', 'vaisselle', 'luminaire*', 'lampe*', 'bougie*',
    'jardin', 'jardinage', 'barbecue', 'plancha', 'salon de jardin', 'bricolage', 'outillage', 'perceuse',
    'tondeuse', 'nettoyeur', 'karcher', 'rangement', 'tapis', 'rideaux', 'ikea', 'leroy merlin', 'dyson',
    'seb', 'moulinex', 'tefal', 'kitchenaid', 'le creuset', 'plaid'] },
  { id: 'voyages', label: 'Voyages et séjours', emoji: '✈️', keywords: [
    'voyage*', 'sejour*', 'week-end', 'weekend', 'escapade', 'vacances', 'croisiere*', 'nuit* d\'hotel',
    'nuitee*', 'hotel', 'hotels', 'gite*', 'camping', 'club med', 'billet* d\'avion', 'vol', 'vols', 'thalasso',
    'circuit', 'evasion', 'destination', 'center parcs', 'pierre et vacances', 'cheque* vacances', 'chambre d\'hote*',
    'sejour au ski', 'forfait ski', 'road trip', 'tour du monde', 'new york', 'japon', 'maldives', 'martinique',
    'guadeloupe', 'ile de la reunion', 'polynesie', 'bali', 'grece', 'italie', 'espagne'] },
  { id: 'sorties', label: 'Sorties (cinéma, concerts, spectacles, matchs)', emoji: '🎟️', keywords: [
    'place', 'places', 'billet*', 'invitation*', 'entree*', 'cinema', 'film', 'avant-premiere', 'concert*', 'festival*',
    'spectacle*', 'theatre', 'one man show', 'humour', 'humoriste', 'comedie musicale', 'opera', 'ballet',
    'cirque', 'exposition', 'musee', 'parc d\'attraction*', 'parc d\'attractions', 'europa-park', 'europa park',
    'disneyland', 'parc asterix', 'futuroscope', 'zoo', 'aquarium', 'match*', 'stade', 'tribune', 'loge',
    'zenith', 'salle de spectacle', 'escape game', 'bowling', 'karting', 'laser game', 'pass festival', 'soiree'] },
  { id: 'sport', label: 'Sport et loisirs', emoji: '⚽', keywords: [
    'sport*', 'fitness', 'musculation', 'yoga', 'running', 'course a pied', 'trail', 'randonnee', 'rando',
    'ballon*', 'maillot*', 'raquette*', 'tennis', 'padel', 'golf', 'ski', 'skis', 'snowboard', 'natation',
    'piscine', 'velo d\'appartement', 'tapis de course', 'decathlon', 'nike', 'adidas', 'puma', 'salle de sport',
    'abonnement salle', 'equipement sportif', 'peche', 'chasse', 'kayak', 'paddle', 'escalade', 'parapente',
    'saut en parachute', 'bapteme', 'loisir*', 'jeu de societe', 'jeux de societe', 'puzzle*', 'livre*', 'roman*',
    'bd', 'bande dessinee', 'manga*', 'abonnement magazine', 'loisirs creatifs', 'peinture', 'instrument',
    'guitare', 'piano'] },
  { id: 'enfants', label: 'Enfants et jouets', emoji: '🧸', keywords: [
    'jouet*', 'enfant*', 'bebe*', 'naissance', 'puericulture', 'poussette*', 'siege auto', 'couche*',
    'lego', 'playmobil', 'poupee*', 'peluche*', 'barbie', 'hot wheels', 'jeu educatif', 'jeux educatifs',
    'kids', 'junior', 'ecole', 'cartable', 'fournitures scolaires', 'rentree scolaire',
    'trottinette enfant', 'draisienne', 'vtech', 'fisher-price', 'king jouet', 'la grande recre', 'smoby',
    'tout-petit*', 'maternelle', 'ado', 'adolescent*'] },
  { id: 'animaux', label: 'Animaux', emoji: '🐾', keywords: [
    'animal', 'animaux', 'chien*', 'chiot*', 'chat', 'chats', 'chaton*', 'croquette*', 'patee*', 'litiere',
    'niche', 'griffoir', 'arbre a chat', 'aquarium', 'poisson*', 'oiseau*', 'rongeur*', 'lapin*', 'cheval',
    'equitation', 'animalerie', 'veterinaire', 'friandises pour', 'purina', 'royal canin', 'ultra premium direct',
    'pedigree', 'whiskas', 'felix', 'animalis', 'truffaut', 'zoomalia'] },
  { id: 'bons_argent', label: 'Bons d\'achat et argent', emoji: '💶', keywords: [
    'bon* d\'achat', 'carte* cadeau', 'carte-cadeau', 'cheque* cadeau', 'e-carte', 'ecarte', 'code promo',
    'remboursement', 'rembourse*', 'argent', 'cash', 'virement', 'euros', 'cagnotte', 'paypal',
    'gift card', 'giftcard', 'bon de reduction', 'bons de reduction', 'tickets restaurant',
    'carte illicado', 'wonderbox', 'smartbox', 'coffret cadeau', 'abonnement', 'un an de courses',
    'cheque* kadeos', 'amazon', 'ticket* kadeos'] },
  { id: 'auto_moto_velo', label: 'Auto / moto / vélo', emoji: '🚗', keywords: [
    'voiture*', 'auto', 'automobile*', 'vehicule*', 'citadine', 'suv', 'peugeot', 'renault', 'citroen',
    'toyota', 'tesla', 'dacia', 'fiat', 'volkswagen', 'moto', 'motos', 'scooter*', 'velo', 'velos', 'vtt', 'vae',
    'velo electrique', 'trottinette*', 'gyroroue', 'casque moto', 'carburant', 'essence', 'plein d\'essence',
    'recharge electrique', 'pneu*', 'entretien auto', 'norauto', 'feu vert', 'midas', 'speedy', 'permis de conduire',
    'location de voiture', 'camping-car', 'van amenage'] },
  { id: 'autres', label: 'Autres', emoji: '🎁', keywords: [] },
];

export const FAMILY_BY_ID = Object.fromEntries(FAMILIES.map((f) => [f.id, f]));

function escapeRe(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

// Pré-compile une expression régulière par famille.
const COMPILED = FAMILIES.filter((f) => f.keywords.length).map((f) => {
  const parts = f.keywords.map((k) => {
    const n = normalize(k);
    if (n.endsWith('*')) return escapeRe(n.slice(0, -1)).replace(/\*/g, '[a-z0-9]*') + '[a-z0-9]*';
    return escapeRe(n).replace(/\*/g, '[a-z0-9]*');
  });
  // Bord gauche/droit : pas de lettre ni chiffre collé (sauf pour "€").
  return { id: f.id, re: new RegExp(`(?:^|[^a-z0-9])(?:${parts.join('|')})(?=$|[^a-z0-9])`, 'g') };
});

// Expressions trompeuses à retirer avant le classement
// (ex. "jeu-concours" ne doit pas compter comme "jeu vidéo", "sans obligation d'achat" n'est pas un bon d'achat).
const NOISE = [
  /jeux?[- ]concours/g, /sans obligation d'achat/g, /instants? gagnants?/g, /tirage au sort/g,
  /\d+ gagnants?/g, /a gagner/g, /places? limitees?/g, /entree en vigueur/g, /en place/g, /mise en place/g,
  /(?:d'une )?valeur (?:totale |unitaire |commerciale )?(?:de )?[\d\s.,]+ ?(?:€|euros?)/g,
];

/**
 * Renvoie la liste des familles (identifiants) d'un concours.
 * @param {string} text titre + description du lot
 */
export function classify(text) {
  let t = normalize(text);
  for (const re of NOISE) t = t.replace(re, ' ');
  // "tablette de chocolat" n'est pas une tablette numérique
  t = t.replace(/tablettes? de chocolat/g, ' chocolat ');
  const scores = [];
  for (const { id, re } of COMPILED) {
    re.lastIndex = 0;
    const hits = t.match(re);
    if (hits) scores.push({ id, n: hits.length });
  }
  // "argent" ne doit pas l'emporter quand le lot est clairement autre chose et
  // que le seul indice est un montant en euros.
  let ids = scores.map((s) => s.id);
  if (ids.length > 1 && ids.includes('bons_argent')) {
    const strong = /bons? d'achat|cartes? cadeau|carte-cadeau|cheques? cadeau|e-carte|argent|cash|virement|cagnotte|paypal|remboursement/.test(t);
    if (!strong) ids = ids.filter((i) => i !== 'bons_argent');
  }
  if (!ids.length && /\d\s?(?:€|euros?)(?![a-z])/.test(t)) ids = ['bons_argent'];
  return ids.length ? ids : ['autres'];
}
