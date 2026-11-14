-- Ticket Manager — module Receveurs indépendant des vendeurs
-- Migration additive et idempotente. À appliquer uniquement après sauvegarde Neon
-- et vérification du schéma existant. Aucun DROP, TRUNCATE ou transfert automatique.
--
-- Modèle :
--   suppliers -> receivers -> seller_receiver_assignments -> sellers
-- Les affectations sont historisées par dates. Les nouvelles distributions et ventes
-- peuvent mémoriser le receveur responsable au moment de l'opération.
-- Les anciennes lignes restent inchangées et doivent être rapprochées manuellement.

create extension if not exists pgcrypto;

create table if not exists public.receivers (
  id uuid primary key default gen_random_uuid(),
  receiver_code text not null unique,
  full_name text not null,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Affectation historisée : un vendeur peut changer de receveur sans réécrire
-- les anciennes ventes. Une affectation active correspond à valid_to IS NULL.
create table if not exists public.seller_receiver_assignments (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete restrict,
  receiver_id uuid not null references public.receivers(id) on delete restrict,
  valid_from date not null default current_date,
  valid_to date,
  created_by uuid references neon_auth."user"(id),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);

create unique index if not exists seller_receiver_one_current_assignment
  on public.seller_receiver_assignments(seller_id)
  where valid_to is null;

create index if not exists idx_seller_receiver_assignments_history
  on public.seller_receiver_assignments(seller_id, valid_from desc);

create index if not exists idx_seller_receiver_assignments_receiver
  on public.seller_receiver_assignments(receiver_id, valid_from desc);

-- Référentiel de taux indépendant : un taux est défini par fournisseur et receveur.
-- La table historique vendeur existante n'est ni supprimée ni modifiée.
create table if not exists public.receiver_supplier_commissions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  receiver_id uuid not null references public.receivers(id) on delete restrict,
  commission_rate numeric(5,2) not null
    check (commission_rate >= 0 and commission_rate <= 100),
  valid_from date not null default current_date,
  valid_to date,
  created_by uuid references neon_auth."user"(id),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  unique (supplier_id, receiver_id, valid_from)
);

create index if not exists idx_receiver_supplier_commissions_lookup
  on public.receiver_supplier_commissions(supplier_id, receiver_id, valid_from desc);

-- Colonnes de rattachement/snapshot facultatives pour préserver les anciennes lignes.
alter table public.distributions
  add column if not exists receiver_id uuid
  references public.receivers(id) on delete restrict;

alter table public.sales
  add column if not exists receiver_id uuid
  references public.receivers(id) on delete restrict;

create index if not exists idx_distributions_receiver_date
  on public.distributions(receiver_id, distributed_at);

create index if not exists idx_sales_receiver_date
  on public.sales(receiver_id, sold_at);

-- Le taux déjà enregistré dans sale_items reste le snapshot financier de référence.
-- Les ventes historiques sans receiver_id ne sont volontairement pas réattribuées.

-- Commission globale du receveur : taux indépendant du fournisseur et du vendeur.
-- L'ancienne table receiver_supplier_commissions est conservée sans être utilisée
-- par le calcul courant, afin de ne supprimer aucune donnée historique.
create table if not exists public.receiver_commissions (
  id uuid primary key default gen_random_uuid(),
  receiver_id uuid not null references public.receivers(id) on delete restrict,
  commission_rate numeric(5,2) not null
    check (commission_rate >= 0 and commission_rate <= 100),
  valid_from date not null default current_date,
  valid_to date,
  created_by uuid references neon_auth."user"(id),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  unique (receiver_id, valid_from)
);

create index if not exists idx_receiver_commissions_lookup
  on public.receiver_commissions(receiver_id, valid_from desc);

-- Snapshot du taux global receveur sur chaque nouvelle vente.
-- Les anciennes ventes restent NULL et ne sont pas recalculées rétroactivement.
alter table public.sale_items
  add column if not exists receiver_commission_rate numeric(5,2)
  check (receiver_commission_rate is null or (receiver_commission_rate >= 0 and receiver_commission_rate <= 100));

