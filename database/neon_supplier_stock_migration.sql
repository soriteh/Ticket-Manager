-- Ticket Manager — migration Neon : fournisseurs et stock de tickets
-- À exécuter dans le SQL Editor Neon après database/neon_schema.sql.
-- Migration idempotente : peut être rejouée sans dupliquer les objets.

create extension if not exists pgcrypto;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_code text unique,
  name text not null,
  contact_name text,
  phone text,
  email text,
  address text,
  tax_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_receipts (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  supplier_id uuid not null references public.suppliers(id),
  received_at timestamptz not null default now(),
  quantity integer not null check (quantity > 0),
  unit_cost bigint not null check (unit_cost >= 0),
  status text not null default 'validated'
    check (status in ('draft','validated','cancelled')),
  notes text,
  created_by text references neon_auth."user"(id),
  created_at timestamptz not null default now()
);

alter table public.distributions
  add column if not exists supplier_id uuid references public.suppliers(id);

alter table public.sales
  add column if not exists supplier_id uuid references public.suppliers(id);

create table if not exists public.supplier_receiver_commissions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  seller_id uuid not null references public.sellers(id),
  commission_rate numeric(5,2) not null check (commission_rate between 0 and 100),
  valid_from date not null default current_date,
  valid_to date,
  created_by text references neon_auth."user"(id),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  unique (supplier_id, seller_id, valid_from)
);

create index if not exists idx_ticket_receipts_supplier_date
  on public.ticket_receipts(supplier_id, received_at);
create index if not exists idx_distributions_supplier_date
  on public.distributions(supplier_id, distributed_at);
create index if not exists idx_sales_supplier_date
  on public.sales(supplier_id, sold_at);
create index if not exists idx_supplier_receiver_commissions_pair
  on public.supplier_receiver_commissions(supplier_id, seller_id, valid_from desc);

-- Stock fournisseur = réceptions validées - distributions validées.
create or replace view public.supplier_ticket_stock as
select
  sp.id as supplier_id,
  sp.name as supplier_name,
  coalesce(rc.received_quantity, 0)::bigint as received_quantity,
  coalesce(ds.distributed_quantity, 0)::bigint as distributed_quantity,
  (coalesce(rc.received_quantity, 0) - coalesce(ds.distributed_quantity, 0))::bigint
    as available_quantity
from public.suppliers sp
left join (
  select supplier_id, sum(quantity) as received_quantity
  from public.ticket_receipts
  where status = 'validated'
  group by supplier_id
) rc on rc.supplier_id = sp.id
left join (
  select supplier_id, sum(di.quantity) as distributed_quantity
  from public.distributions d
  join public.distribution_items di on di.distribution_id = d.id
  where d.status = 'validated'
  group by supplier_id
) ds on ds.supplier_id = sp.id;

-- Contrôle de cohérence : les anciennes distributions/ventes restent sans fournisseur
-- et doivent être rapprochées manuellement avant d'être incluses dans le stock par fournisseur.
