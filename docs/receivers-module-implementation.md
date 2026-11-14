# Module Receveurs — plan d’intégration

## Décision métier
Un receveur est une entité métier distincte d’un vendeur. Un receveur peut encadrer plusieurs vendeurs. Un vendeur peut changer de receveur dans le temps, avec conservation des affectations passées. Le compte utilisateur du receveur est facultatif.

## Modèle de données
La migration `neon_receivers_module_migration.sql` ajoute :
- `receivers` : fiche receveur, code unique, coordonnées, statut ;
- `seller_receiver_assignments` : affectations historisées vendeur → receveur ;
- `receiver_supplier_commissions` : taux fournisseur → receveur avec dates de validité ;
- `receiver_id` nullable sur `distributions` et `sales` pour mémoriser le receveur responsable.

Les tables et colonnes historiques ne sont pas supprimées. Aucun rapprochement automatique n’est réalisé sur les anciennes distributions ou ventes.

## Règles financières
1. La commission du vendeur reste calculée à partir de `sale_items.commission_rate`.
2. La commission fournisseur–receveur est calculée uniquement sur les ventes validées, selon le receveur mémorisé sur la vente et le taux applicable à la date de vente.
3. Les tickets reçus ou distribués mais non vendus ne génèrent aucune commission.
4. Les périodes de calcul mensuel vont du premier au dernier jour du mois.
5. Le taux fournisseur–receveur appliqué à chaque vente doit être figé dans `sale_items.supplier_receiver_commission_rate`.
6. Un vendeur sans affectation à la date de vente ne génère pas de commission fournisseur–receveur. L’API doit refuser ou signaler explicitement une attribution ambiguë, sans inventer de receveur.

## API à raccorder
Ajouter la ressource `receivers` (GET/POST), les opérations d’affectation vendeur–receveur, et la gestion des taux par couple fournisseur–receveur. Étendre les lectures de distributions et ventes pour exposer `receiverId). Lors d’une nouvelle vente, résoudre l’affectation valide à la date de vente, résoudre le taux valide pour le fournisseur et le receveur, puis enregistrer `sales.receiver_id` et le snapshot du taux dans `sale_items`.

Les contrôles d’accès doivent être côté serveur : seuls `super_admin`, `admin` et `sales_manager` gèrent les receveurs, affectations et taux. Les vendeurs ne doivent jamais pouvoir choisir ou modifier leur `receiver_id`.

## Interface à raccorder
- Entrée de navigation « Receveurs », séparée de « Vendeurs ».
- Liste avec recherche, statut, coordonnées et nombre de vendeurs rattachés.
- Formulaire création/modification et activation/désactivation.
- Fiche receveur : vendeurs rattachés, fournisseurs associés, taux de commission et historique.
- Affectation d’un vendeur avec date d’effet et fermeture de l’affectation précédente.
- Page Commissions : tableau fournisseur–receveur distinct du tableau des commissions vendeurs.

## Migration et déploiement
1. Sauvegarder Neon et vérifier le schéma réel.
2. Exécuter la migration additive en staging.
3. Vérifier les contraintes, index et données existantes.
4. Raccorder API et interface, puis lancer `npm run build` et les tests métier.
5. Déployer en Preview et valider les scénarios avant toute fusion ou mise en Production.

## Scénarios de validation
- Un receveur peut avoir plusieurs vendeurs.
- Un vendeur peut être réaffecté sans réécrire ses ventes passées.
- Deux receveurs distincts peuvent avoir des taux différents chez un même fournisseur.
- Les ventes validées seules alimentent la commission.
- Le taux vendeur et le taux receveur sont figés sur chaque vente.
- Une vente historique non rapprochée reste sans receveur et n’est pas attribuée arbitrairement.
- Un utilisateur vendeur ne peut ni créer un receveur, ni changer son affectation, ni modifier les taux.
