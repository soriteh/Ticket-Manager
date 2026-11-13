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

## Configuration Neon
L’application utilise Neon PostgreSQL et Neon Auth (pas Supabase).

Variables Vercel requises : `DATABASE_URL` côté serveur et `VITE_NEON_AUTH_URL` côté client. `NEON_AUTH_BASE_URL` peut être défini côté serveur pour l’issuer JWT ; `NEON_AUTH_JWKS_URL` est facultatif si l’URL JWKS standard Neon est utilisée.

Le schéma initial se trouve dans `database/neon_schema.sql`, puis les évolutions de stock/fournisseurs dans `database/neon_supplier_stock_migration.sql`, suivies de la migration de cohérence `database/neon_integrity_hardening_migration.sql`. Les profils applicatifs sont stockés dans `public.tm_profiles` et doivent être attribués explicitement par un administrateur. Pour diagnostiquer et activer un compte administrateur précis, utiliser `database/neon_admin_profile_setup.sql` après avoir remplacé l’adresse e-mail de démonstration par l’adresse exacte du compte Neon Auth.

Ne jamais exposer `DATABASE_URL`, un secret Neon ou une clé privée dans le frontend.
