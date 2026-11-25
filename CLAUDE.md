# Comparateur présidentielle 2027

Site statique neutre et sourcé comparant les programmes des prétendants à la présidentielle 2027. Répondre en français.

## Arborescence
- `site/` — le site publié (Netlify Drop : déposer CE dossier). `data.js` = `window.DATA_2027 = {…}` ; `data.json` = copie lisible. Ne jamais les éditer à la main : passer par `outils/integrer.js`.
- `preuves/` — archives des sources (captures, texte, PDF), rangées par candidat puis par ID de promesse ; index `preuves/index.json`.
- `supabase/schema.sql` — tables propositions (privée), signalements (dépôt public), bucket privé preuves. `netlify.toml` + `site/_headers` — publication de `site/` et en-têtes de sécurité.
- `outils/` — scripts node (dépendance : `npm install`, playwright-core pilote le Edge installé) : `couverture.js` (état du registre), `valider.js` (contrôle d'un lot), `integrer.js` (application des propositions acceptées), `donnees.js` (lecture/écriture).
- `.claude/agents/c27-*.md` — agents spécialisés de l'équipe de veille.
- `equipe/` — `REGLES_COMMUNES.md` (neutralité, sources, format des propositions), `COORDINATEUR.md` (procédure quotidienne), `ARCHITECTURE.md`.
- `mises_a_jour/AAAA-MM-JJ/` — lots quotidiens : `brut/` (sorties des agents), `propositions.json`, `rapport.md`. `mises_a_jour/etat.json` = rotation des personnalités.

## Validation automatique (décision de l'utilisateur, 2026-11-25)
Les propositions conformes à `equipe/POLITIQUE_VALIDATION.md` (règles A1 recommandée, A2 sourcée sur le site officiel, A3 sans incidence budgétaire) sont acceptées, intégrées, commitées et poussées (mises en ligne) sans intervention : `node outils/automatique.js <lots…> [--essai] [--sans-publication]`. Jamais de refus automatique. Interrupteurs `automatique` / `publication_automatique` dans `mises_a_jour/etat.json`. La tâche planifiée quotidienne l'exécute (étape 10 de `equipe/COORDINATEUR.md`).

## Valider, intégrer, publier (décisions humaines)
L'utilisateur valide dans Supabase (Table Editor > vue `a_valider` ou table `propositions` : colonne `decision` = accepte / refuse, `note_humaine` facultative). Quand il demande d'intégrer (« intègre les validations du 25 », « publie ») :
1. `node outils/supabase.js recuperer mises_a_jour/AAAA-MM-JJ/propositions.json` (sans Supabase : il modifie `decision` directement dans le JSON).
2. `node outils/integrer.js mises_a_jour/AAAA-MM-JJ/propositions.json --essai` → montrer le résultat à l'utilisateur.
3. Même commande sans `--essai`, puis `node outils/supabase.js marquer mises_a_jour/AAAA-MM-JJ/propositions.json`.
4. Vérifier le site en aperçu local, committer (avec l'accord de l'utilisateur).
5. `node outils/publier.js` (ou `--brouillon` pour une URL de prévisualisation) — publication sur Netlify, uniquement à la demande de l'utilisateur.

Validation en masse : `node outils/decider.js <lot.json> (--liste | accepte|refuse|a_valider (--recommandees | 001 …) | chercher | auto) [--essai]`.
Règle « sourcée = validée » (décidée par l'utilisateur le 2026-11-25) : un contrôle de promesse existante (`controle_promesse`) dont `chercher` a retrouvé la source (niveau « trouvee », vérification « confirme », et pour une page web passage retrouvé sur la capture) est accepté automatiquement (`note_humaine` = « Validée automatiquement… », champ `decision_auto`). Les pistes, les sources non trouvées et les autres types de propositions restent à valider à la main. L'intégration au site (`integrer.js`) reste une étape séparée.

Contrôle de la base héritée : `node outils/controle-existant.js` crée `mises_a_jour/<date>-controle/propositions.json` (type `controle_promesse`) pour les promesses sans source probante. Décision « accepte » = promesse confirmée ; « refuse » = promesse RETIRÉE du site (archivée dans `promesses_retirees` avec le motif = note_humaine). Même procédure d'intégration que les autres lots.

Signalements des visiteurs : `node outils/supabase.js signalements [--tous]`. Un signalement est une piste à vérifier, jamais une source.
Configuration : `.env` (modèle `.env.exemple`), schéma de base `supabase/schema.sql`. Ne jamais afficher ni committer la clé service_role.

## Quand l'utilisateur demande la source d'une information
1. `node outils/source.js <ID | mots-clés> [--candidat "Nom"]` (ex. `node outils/source.js P0163` ou `node outils/source.js smic roussel`).
2. Donner : la promesse, l'URL, la date de capture, le passage retrouvé (et son niveau : exacte / partielle / approchante / non).
3. Afficher la capture : lire `capture.png` avec l'outil Read, puis l'envoyer avec SendUserFile ; proposer `page-complete.jpg` ou `document.pdf` si utile.
4. Pas de capture ou capture ancienne : `node outils/capturer.js --url <URL> --candidat "Nom" --cle <ID> [--citation "…"]`.
« approchante » signifie que le passage surligné a été choisi par proximité de mots (promesses anciennes sans citation) : le dire, et ne pas le présenter comme une preuve.

Rattrapage des captures des promesses existantes : `node outils/capturer.js --existant [--candidat "Nom"]` (ne refait pas ce qui existe déjà).

## Dépôts GitHub
- Privé : WFAKIH/Presidentielle-2027 (ce dossier, tout le projet sauf .env, node_modules, page-complete.jpg).
- Public : WFAKIH/comparateur-2027 — alimenté AUTOMATIQUEMENT par la GitHub Action `.github/workflows/export-public.yml` à chaque push sur main (liste blanche de `outils/exporter-public.js`, chemins locaux masqués, export bloqué si un secret est détecté). Ne jamais pousser à la main vers le dépôt public.
- Netlify est relié au dépôt public : un push sur le privé → export public → mise en ligne.

## Sources fiables et chiffrage (règles de l'utilisateur, 2026-11-25)
- Source fiable = le site officiel de chaque candidat (`outils/sites-officiels.json`), pour la proposition comme pour son chiffrage ; y chercher en premier.
- Le chiffrage ne concerne que les propositions qui entrent dans le calcul du budget. Les autres : « Nature du chiffrage » = « Sans incidence budgétaire », pas de montant, aucun coût réclamé. Détail : `equipe/REGLES_COMMUNES.md`.

## Principes non négociables
Aucun classement ni jugement ; toute donnée a une source datée ; position de parti ≠ promesse du candidat ; pas d'addition de montants de périodes différentes ; vote de groupe ≠ vote individuel.
