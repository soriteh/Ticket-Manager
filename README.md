# Ticket Manager

Application de gestion des distributions de tickets physiques, des ventes et des commissions des vendeurs.

## Périmètre
- Pas de création, génération ou importation de tickets individuels.
- Gestion des types commerciaux et de leurs tarifs variables.
- Distributions par quantités et à fréquence variable.
- Déclarations des ventes et calcul des invendus.
- Commission en pourcentage, configurable par vendeur.
- Reversements partiels et suivi des soldes.
- GNF comme devise de référence.

## Démarrage
```bash
npm install
npm run dev
```

## Configuration Supabase
Créer un fichier `.env.local` à partir de `.env.example`, puis renseigner les clés du projet Supabase. Le schéma SQL de base se trouve dans `supabase/schema.sql`.

Ne jamais placer la clé `service_role` dans le frontend.
