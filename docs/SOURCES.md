# Sources de concours : propositions et vérification

## Statut honnête

Les sites ci-dessous **n'ont pas pu être vérifiés** pendant le développement :
l'environnement où le code a été écrit n'a pas accès à ces sites. La vérification se fait donc
**chez vous**, avec deux outils intégrés :

* dans l'extension : **⚙ Options → Sources → bouton « Tester »** (lit le `robots.txt`,
  cherche un flux RSS et le lien des CGU, sans rien collecter) ;
* avec le script Python : `python collecteur.py --verifier`.

Et quoi qu'il arrive, l'extension **relit le `robots.txt` avant chaque collecte** : si une source
l'interdit, elle n'est pas téléchargée (statut « interdit par robots.txt » dans les options).

## Liste proposée

| Source | Type | Adresse de départ | Activée par défaut |
|---|---|---|---|
| Jeu-Concours.biz | Annuaire | https://www.jeu-concours.biz/ | ✅ (version 1) |
| Toutgagner | Annuaire | https://www.toutgagner.com/ | ❌ |
| Concoursmania | Annuaire | https://www.concoursmania.com/ | ❌ |
| Jeuxconcours.fr | Annuaire | https://www.jeuxconcours.fr/ | ❌ |
| DNA | Média Alsace | https://www.dna.fr/jeux-concours *(rubrique à confirmer)* | ❌ |
| L'Alsace | Média Alsace | https://www.lalsace.fr/jeux-concours *(à confirmer)* | ❌ |
| L'Est Républicain | Média Grand Est | https://www.estrepublicain.fr/jeux-concours *(à confirmer)* | ❌ |
| Le Républicain Lorrain | Média Grand Est | https://www.republicain-lorrain.fr/jeux-concours *(à confirmer)* | ❌ |
| ici Alsace (ex-France Bleu) | Radio | https://www.francebleu.fr/alsace | ❌ |
| Script Python | Local | http://127.0.0.1:8765/concours.json | ❌ |

**Pages « jeux » de marques et enseignes** (supermarchés, marques alimentaires, parcs de loisirs
de la région…) : elles changent souvent d'adresse et sont fréquemment construites en JavaScript.
Ajoutez celles qui vous intéressent avec **Options → « Ajouter une source »** (type « Page web »),
après avoir vérifié qu'elles sont lisibles (bouton « Tester »).

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
