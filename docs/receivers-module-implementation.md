# Module Receveurs — implémentation

## Décision métier
Un receveur est une entité métier distincte d’un vendeur. Un receveur peut encadrer plusieurs vendeurs. Un vendeur peut changer de receveur dans le temps, avec conservation des affectations passées. Le compte utilisateur du receveur est facultatif.

## Modèle de données
La migration additive `neon_receivers_module_migration.sql` ajoute :
- `receivers` : fiche receveur, code unique, coordonnées et statut ;
- `seller_receiver_assignments` : affectations historisées vendeur → receveur ;
- `receiver_commissions` : taux global propre au receveur, avec périodes de validité ;
- `receiver_id` nullable sur `distributions` et `sales` ;
- `sale_items.receiver_commission_rate` : snapshot du taux global appliqué à chaque vente.

La table historique `receiver_supplier_commissions` est conservée si elle existe, mais elle n’est plus utilisée par le calcul courant. Aucune table ou donnée historique n’est supprimée. Aucun rapprochement automatique n’est réalisé sur les anciennes distributions ou ventes.

## Règles financières
1. La commission du vendeur reste indépendante et son taux est figé dans `sale_items.commission_rate`.
2. La commission du receveur utilise un taux unique configuré sur sa fiche, indépendant du fournisseur et du taux vendeur.
3. La base de calcul est le chiffre d’affaires mensuel total des ventes validées des vendeurs affectés au receveur.
4. Les périodes mensuelles vont du premier au dernier jour du mois.
5. Le taux global receveur applicable à la date de vente est figé dans `sale_items.receiver_commission_rate`.
6. Les taux historiques restent consultables ; une nouvelle période clôt la précédente la veille de sa date d’effet.
7. Les ventes historiques dont le snapshot est NULL restent à compléter par rapprochement financier ; aucun taux actuel ne leur est appliqué rétroactivement.
8. Une vente ne peut être créée sans exactement une affectation receveur valide et un taux receveur configuré à sa date.

## API et interface
- Ressources API : `receivers`, `receiver-assignments`, `commissions`.
- La configuration des commissions demande uniquement receveur, taux et date d’effet.
- Le tableau mensuel est groupé par receveur, sans regroupement par fournisseur.
- Les commissions vendeur et receveur restent affichées séparément.
- Les contrôles d’accès sont appliqués côté serveur.

## Migration et déploiement
1. Sauvegarder Neon et vérifier le schéma réel.
2. Exécuter la migration additive en staging.
3. Vérifier contraintes, index et données existantes.
4. Lancer le build et les tests métier.
5. Déployer en Preview et valider les scénarios avant toute fusion ou mise en Production.

La migration n’a pas été exécutée sur Neon Production. Ne pas la lancer sans sauvegarde, inspection du schéma réel et validation préalable.

## Scénarios de validation
- Un receveur peut avoir plusieurs vendeurs.
- Un vendeur peut être réaffecté sans réécrire ses ventes passées.
- Le taux receveur est indépendant du fournisseur et du taux vendeur.
- Les ventes validées seules alimentent la commission.
- Le taux vendeur et le taux receveur sont figés sur chaque vente.
- Une vente historique sans snapshot receveur n’est pas recalculée rétroactivement.
- Un utilisateur vendeur ne peut ni créer un receveur, ni changer son affectation, ni modifier les taux.
