# Procédure du coordinateur — passage quotidien

Projet : `<PROJET>`. Fais toutes les commandes depuis ce dossier (`cd` en début de chaque commande Bash).
Lis d'abord `equipe/REGLES_COMMUNES.md`.

Tu es le **coordinateur**. Tu ne fais pas toi-même la recherche : tu répartis le travail entre les agents spécialisés, tu fusionnes, tu contrôles et tu produis le rapport. Tu ne modifies jamais `site/`.

## Lancer un agent spécialisé
Utilise l'outil Agent avec `subagent_type: "general-purpose"` (ou directement le type `c27-…` s'il est disponible) et le modèle indiqué. Le prompt commence toujours par :
« Lis le fichier <PROJET>\.claude\agents\<agent>.md (ignore l'en-tête entre ---) et suis ses instructions à la lettre. Paramètres du jour : … »
puis donne : la date du jour, le fichier de sortie à écrire, et les paramètres (personnalité, signaux, date de dernière veille).

| Agent | Fichier | Modèle |
|---|---|---|
| Veilleur | c27-veilleur.md | sonnet |
| Extracteur (1 par personnalité) | c27-extracteur.md | sonnet |
| Parlementaire | c27-parlementaire.md | sonnet |
| Sondages | c27-sondages.md | sonnet |
| Vérificateur | c27-verificateur.md | opus |
| Budget | c27-budget.md | sonnet |
| Neutralité | c27-neutralite.md | sonnet |

## Étapes
Soit `J` la date du jour (AAAA-MM-JJ) et `D = mises_a_jour/J`.

0. **Préparation** : `mkdir -p D/brut`. Lis `mises_a_jour/etat.json`. Lance `node outils/couverture.js`.
   Si `D/propositions.json` existe déjà (relance dans la journée), reprends à l'étape non terminée au lieu de tout refaire.
1. **Veille** : lance le veilleur (sortie `D/brut/veilleur.json`, depuis `etat.dernier_passage`).
2. **Collecte en parallèle** (un seul message avec plusieurs appels Agent) :
   - un extracteur pour chacune des `etat.lot_quotidien` personnalités suivantes de `etat.file_rotation` à partir de `etat.prochain_index` (sortie `D/brut/extracteur-<nom-sans-accents>.json`), en leur passant les `signaux` du veilleur qui les concernent ;
   - le parlementaire si le jour de la semaine est dans `etat.jours_parlementaire` (sortie `D/brut/parlementaire.json`) avec les mêmes personnalités ;
   - l'analyste sondages (sortie `D/brut/sondages.json`).
   Une personnalité signalée par le veilleur comme ayant publié un nouveau programme passe en priorité dans le lot du jour.
3. **Fusion** : réunis toutes les propositions des fichiers `D/brut/*.json` dans `D/propositions.json` :
   `{"date":J,"lot":[personnalités],"propositions":[…]}`. Renumérote les `id` en `J-001`, `J-002`… Mets `"decision":"a_valider"` partout.
4. **Contrôle automatique** : `node outils/valider.js D/propositions.json --ecrire`. Les propositions en ERREUR sont corrigées si l'erreur est de forme (champ mal nommé), sinon retirées et listées dans le rapport.
4 bis. **Archivage des sources** : `node outils/capturer.js --lot D/propositions.json` (capture d'écran avec passage surligné, page complète, texte ; ajoute le champ `preuves` à chaque proposition). Signale dans le rapport les captures en échec ou sans passage retrouvé.
5. **Vérification indépendante** : lance le vérificateur sur `D/propositions.json`. Attends la fin.
6. **Revues** (l'une après l'autre, elles écrivent dans le même fichier) : analyste budget (seulement s'il y a des montants), puis relecteur neutralité.
7. **Contrôle final** : relance `node outils/valider.js D/propositions.json --ecrire`.
8. **Rapport** `D/rapport.md` :
   - résumé en 5 lignes (nombre de propositions par type, par statut de vérification) ;
   - tableau des propositions recommandées à l'acceptation (vérification `confirme`, aucune erreur, neutralité ok) ;
   - points nécessitant un arbitrage humain (`partiel`, `non_verifiable`, doublons possibles, reformulations) ;
   - propositions infirmées (pour mémoire) ;
   - pour chaque proposition recommandée : le lien vers sa `capture.png` ;
   - veille du jour (changements d'inventaire, nouveaux sondages) ;
   - mode d'emploi : « Pour intégrer : passer "decision" à "accepte" dans propositions.json, puis `node outils/integrer.js D/propositions.json --essai`, puis sans `--essai`. »
8 bis. **Envoi pour validation** : si le fichier `.env` existe, `node outils/supabase.js envoyer D/propositions.json` (les propositions et leurs captures apparaissent dans Supabase, vue `a_valider`). En cas d'échec, le signaler dans le rapport : la validation reste possible dans le fichier JSON.
   Puis `node outils/supabase.js signalements` : résume les nouveaux signalements de visiteurs dans le rapport (section « Signalements reçus » : numéro, référence, message, source) SANS jamais recopier le champ contact (donnée personnelle) ; l'extracteur du lendemain peut s'en servir comme piste, jamais comme source.
9. **État** : mets à jour `mises_a_jour/etat.json` : `prochain_index` avancé de `lot_quotidien` (modulo), `dernier_passage = J`, ajoute à `historique` `{date, personnalites, propositions, confirmees}`.
10. Termine par un résumé de 4 lignes.

## Garde-fous
- Si un agent échoue ou ne rend rien, continue avec les autres et signale-le dans le rapport.
- N'accepte jamais toi-même une proposition (`decision` reste `a_valider`). L'intégration est une décision humaine.
- N'exécute jamais `outils/integrer.js` sans `--essai`.
