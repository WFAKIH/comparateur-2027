# Architecture de l'équipe d'agents

```
                    ┌────────────────────────────┐
  Tâche planifiée → │ COORDINATEUR (07:00/jour)  │  equipe/COORDINATEUR.md
                    └─────────────┬──────────────┘
        1. Veille                 │
        ┌─────────────────────────┴───────────┐
        │ c27-veilleur : candidatures,        │ → signaux (nouveaux programmes)
        │ investitures, inventaire            │
        └─────────────────────────┬───────────┘
        2. Collecte en parallèle  │
   ┌──────────────┬───────────────┼──────────────┐
   │ c27-extracteur│ c27-extracteur│ c27-parlem.  │ c27-sondages
   │ (personne 1)  │ (personne 2…) │ (lun., jeu.) │ (chaque jour)
   └──────┬───────┴───────┬───────┴──────┬───────┘
          └──── mises_a_jour/J/brut/*.json ┘
        3. Fusion → propositions.json
        4. outils/valider.js  (schéma, doublons, montants)      ← déterministe
        4b. outils/capturer.js --lot  (captures des sources → preuves/)
        5. c27-verificateur   (ré-ouvre chaque source)          ← indépendant, modèle le plus fort
        6. c27-budget → c27-neutralite  (revues)
        7. outils/valider.js  (contrôle final)
        8. rapport.md
                                  │
                    ┌─────────────┴──────────────┐
                    │ Supabase : vue a_valider    │
                    │ HUMAIN : decision=accepte   │
                    └─────────────┬──────────────┘
                    supabase.js recuperer → integrer.js → site/data.js → git commit → publier.js (Netlify)

  Visiteurs → formulaire « Signaler une erreur » → Supabase (signalements) → rapport du jour
```

## Principes
- **Séparation des rôles** : celui qui collecte ne vérifie pas. Le vérificateur ré-ouvre chaque source sans faire confiance au collecteur.
- **Contrôles déterministes** (scripts) avant et après les contrôles par IA : schéma, doublons, montant sans période, IDs.
- **Humain dans la boucle** : aucune donnée n'entre sur le site sans `decision: "accepte"`. L'intégration refuse par défaut ce qui n'est pas `confirme`.
- **Traçabilité** : chaque proposition garde source, citation, vérification et revues ; `git` garde l'historique des données.
- **Coût maîtrisé** : 3 personnalités par jour (12 en 4 jours), votes 2 fois par semaine, modèle fort réservé à la vérification.

## Réglages (mises_a_jour/etat.json)
- `lot_quotidien` : nombre de personnalités par jour.
- `jours_parlementaire` : jours où l'analyste parlementaire tourne.
- `file_rotation` : ordre de passage (ajouter ici une nouvelle personnalité pour qu'elle soit suivie).
