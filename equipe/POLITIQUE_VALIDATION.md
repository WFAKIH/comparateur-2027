# Politique de validation automatique

Décidée par l'utilisateur le 2026-11-25 : les modifications qui respectent les règles sont faites **automatiquement, sans intervention humaine** (décision, intégration au site, commit, publication). Tout le reste attend une décision humaine dans Supabase.
Code : `outils/politique.js` (règles) et `outils/automatique.js` (enchaînement). Interrupteur : `mises_a_jour/etat.json` → `"automatique": true|false` et `"publication_automatique": true|false`.

## Historique de référence (passage du 2026-11-25)
| Cas | Décision humaine | Règle qui en découle |
|---|---|---|
| 37 propositions du lot du jour : vérification « confirme », neutralité « ok », budget conforme ou absent, aucune erreur | toutes acceptées | A1 |
| 11 propositions « partiel », « a_reformuler » ou budget « a_corriger » / « non_verifiable » | laissées à valider | B1 |
| Contrôles de promesses existantes dont la source a été retrouvée sur le site officiel (34) | règle « sourcée = validée » | A2 |
| P0160 : source retrouvée sur un document de la Cour des comptes lié depuis le site du candidat | annulée : seule la source du site officiel compte | A2 (site officiel uniquement) |
| Pistes et contrôles sans source trouvée (155) | laissés à valider | B1 |
| 48 promesses sans incidence budgétaire, classées d'après leur formulation | toutes acceptées | A3 |
| Intégration, commit puis push (mise en ligne) après essai sans erreur | approuvés | C |
| Retrait d'une promesse (« refuse » d'un contrôle) | jamais décidé | B2 |

## A. Accepté automatiquement
- **A1 — Proposition recommandée** : vérification indépendante « confirme », revue de neutralité « ok », revue budget absente ou « conforme », contrôle automatique sans erreur, et :
  - pour une promesse (ajout ou correction) : source sur le **site officiel du candidat** (`outils/sites-officiels.json`) ;
  - pas d'alerte « doublon possible » ni « personnalité absente de l'inventaire » ;
  - `lien_mort` : seulement avec une URL de remplacement sur le site officiel.
  Types concernés : `ajout_promesse`, `correction_promesse`, `lien_mort`, `maj_inventaire`, `ajout_sondage`, `ajout_vote`, `ajout_recoupement`.
- **A2 — Sourcée = validée** : contrôle d'une promesse existante (`controle_promesse`) dont la source a été retrouvée (niveau « trouvee », vérification « confirme », passage retrouvé sur la capture pour une page web) **sur le site officiel du candidat**. La source retrouvée devient l'URL primaire.
- **A3 — Sans incidence budgétaire** : reclassement de « Nature du chiffrage » en « Sans incidence budgétaire » d'une promesse sans montant, avec un motif (normes, institutions, règles…). En cas de doute, la promesse reste « Non chiffré » et n'est pas proposée.

## B. Jamais automatique (décision humaine dans Supabase)
- **B1** : tout ce qui est « partiel », « infirme », « non_verifiable », « a_reformuler », budget « a_corriger » ou « non_verifiable », pistes de source, doublons possibles, nouvelle personnalité, type « autre ».
- **B2** : tout **refus**, et donc tout **retrait** d'une promesse du site. L'automate ne refuse jamais.

## C. Intégration et publication
`node outils/automatique.js <lots…>` : décisions (A1–A3) → contrôle → `integrer.js --essai` → `integrer.js` → Supabase marqué → contrôles de cohérence → commit → push (mise en ligne via l'export public et Netlify).
Garde-fous (arrêt avant le push, rien n'est publié) :
- une proposition acceptée en erreur au contrôle automatique ;
- l'essai d'intégration ne correspond pas au nombre de décisions ;
- le nombre de promesses diminue ou les données ne se chargent plus ;
- plus de 150 propositions intégrées dans le même passage ;
- l'interrupteur `automatique` ou `publication_automatique` est à `false`.
## D. Décisions de commit du coordinateur (autorisation de l'utilisateur du 2026-11-25)
Le coordinateur décide seul de commiter et pousser le travail de son passage, avec `node outils/commit-passage.js AAAA-MM-JJ` en fin de procédure (même s'il n'y a eu aucune décision automatique) :
- seulement `mises_a_jour/` (rapport, lots, état, journaux) et `preuves/` (captures, textes, PDF) ; ces dossiers ne partent pas vers le dépôt public ;
- jamais `site/` (qui ne change que par `outils/automatique.js`), ni `outils/`, `equipe/`, `.claude/`, `CLAUDE.md` : tout changement de code ou de règles reste une décision humaine, signalé dans le rapport ;
- jamais de fichier sensible (`.env`, clés) ; branche `main` uniquement ; pas de `--force`, pas de réécriture d'historique ;
- interrupteur : `etat.json` → `"commit_automatique": false` ; le push suit aussi `publication_automatique`.

Chaque décision automatique porte `note_humaine` = « Décision automatique (règle A…) » et `decision_auto` = date ; le journal est écrit dans `decisions-auto.md` à côté du lot.
