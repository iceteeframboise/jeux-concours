# Sources de concours : propositions et vérification

## Vérification du 05/11/2026

Faite depuis GitHub (tâche « Vérifier des sources », fichier `site/candidats.json`, 58 sites) :
robots.txt, flux RSS, lecture des CGU à la recherche des clauses sur l'extraction automatique.

| Source | Résultat | Décision |
|---|---|---|
| Toutgagner | robots.txt OK · 97 concours · CGU sans interdiction | ✅ activée |
| Concours.fr | robots.txt OK · **flux RSS** · CGU sans interdiction | ✅ activée (RSS) |
| Concours du Net (+ rubrique Instagram) | robots.txt OK · 46 concours · CGU sans interdiction | ✅ activée |
| Lidl – jeux-concours Lidl Plus | robots.txt OK · CGU sans interdiction | ✅ activée |
| **Jeu-Concours.biz** | robots.txt OK mais **CGU : « interdiction de l'extraction automatisée »** | ❌ désactivée |
| Coca-Cola | CGU : interdit robots / « web scraping » | ❌ |
| Michel et Augustin | CGU : interdit l'extraction | ❌ |
| ici Alsace (France Bleu) | CGU restrictives sur les robots | ❌ |
| DNA, L'Est Républicain, Le Républicain Lorrain, Vosges Matin (groupe EBRA) | robots.txt OK mais **CGU (`/espace-client/cgu`) : interdisent l'extraction et la mise à disposition du public** ; usage personnel seulement | ❌ pas de collecte ; **lien direct** dans le site (« 📰 Jeux des journaux ») |
| L'Alsace | ne répond pas aux robots | ❌ lien direct dans le site |
| Marques alimentaires (Oasis, Milka, LU, Haribo, Panzani, Herta, Président…) | pas de page listant leurs jeux | ⏸ leurs jeux arrivent via les annuaires |
| Concoursmania | page vide (construite en JavaScript) | ⏸ |
| Autres candidats (Pringles, Carrefour, Intermarché…) | pas de réponse exploitable lors du test | ⏸ |

Pour relancer une vérification : GitHub → onglet **Actions** → **Vérifier des sources** → **Run workflow**.
Pour activer une source : `site/sources.json`, `"enabled": true`.

## Comment décider si une source est utilisable

1. **robots.txt** : le bouton « Tester » doit afficher « ✓ autorisé par robots.txt ».
2. **CGU / mentions légales** : ouvrez le lien affiché par « Tester » (ou en bas de page du site)
   et cherchez les mots *extraction*, *aspiration*, *robot*, *reproduction*. Si le site interdit
   l'extraction automatisée, ne cochez pas la source, même pour un usage personnel.
3. **RSS d'abord** : si « Tester » trouve un flux RSS, l'extension l'utilise automatiquement
   (c'est le format prévu pour être lu par des programmes).
4. **Sinon, lecture légère** : une seule page, une fois par jour, sans suivre les liens. Le lien
   direct vers le formulaire n'est recherché qu'au moment où **vous** cliquez sur « Participer ».

## Rythme de collecte

* 1 passage par jour et par source au maximum (20 h minimum entre deux passages), y compris
  quand vous cliquez sur ⟳ ;
* nouvel essai au bout d'1 h seulement en cas d'erreur ;
* aucun cookie envoyé (`credentials: 'omit'`).
