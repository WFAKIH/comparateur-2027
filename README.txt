LE COMPARATEUR — PRÉSIDENTIELLE 2027
==================================
Version : 18 novembre 2026, fondée sur l'audit XLSX de ce projet.

POUR LE VOIR SUR TON ORDINATEUR
1. Décompresse l'archive ZIP.
2. Ouvre site/index.html dans ton navigateur.
Il fonctionne sans compte et sans connexion Internet (les liens vers les sources nécessitent Internet).

POUR LE PUBLIER GRATUITEMENT — NETLIFY DROP
1. Va sur https://app.netlify.com/drop
2. Glisse-dépose UNIQUEMENT le dossier site/ (pas outils/, equipe/ ni mises_a_jour/).
3. Récupère l'adresse ...netlify.app donnée par Netlify.
4. Crée un compte gratuit / connecte-toi pour revendiquer et conserver le site, puis vérifie qu'il est public.
5. Lors d'une mise à jour, dépose la nouvelle version dans les déploiements du même projet.
Documentation : https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/

COMPOSITION DU SITE
index.html — interface, SEO, sections
styles.css — mise en page responsive
app.js — interactions / filtres / calculatrices
 data.js — données embarquées à partir de l'audit Excel (chargées dans le navigateur)
 data.json — copie lisible des données (facultative pour l'affichage)

MISE À JOUR DES DONNÉES
Le site n'est pas connecté à des mises à jour automatiques.
Les informations de data.js doivent être régénérées depuis un audit renouvelé.
Chaque fiche mentionne la date de sa publication et son lien.
Ne pas fusionner des chiffrages annuels, pluriannuels, ponctuels ou de natures différentes.
Ne pas attribuer automatiquement au candidat un contre-budget ou une position de son parti.

MISE EN GARDE
Le nombre d'engagements extraits n'est pas exhaustif et ne permet pas de noter un candidat.
Le vote de groupe à une date donnée ne vaut pas vote individuel d'une personne.
Le site est statique et sans cookie. Seul le formulaire « Signaler une erreur » transmet des données (à Supabase), dont un contact facultatif : voir site/mentions-legales.html.

ÉQUIPE DE VEILLE
Voir equipe/ARCHITECTURE.md et CLAUDE.md : une tâche planifiée quotidienne
produit des propositions sourcées dans mises_a_jour/, intégrées après validation humaine
avec outils/integrer.js.
