-- Ticket Manager — schéma PostgreSQL pour Neon
-- À exécuter une seule fois dans le SQL Editor Neon, après activation de Neon Auth.
-- Les identifiants Neon restent exclusivement côté serveur.
create extension if not exists pgcrypto;

create table if not exists public.tm_profiles (
  user_id uuid primary key references neon_auth."user"(id) on delete cascade,
  full_name text not null,
  phone text,
  role text not null default 'seller'
    check (role in ('super_admin','admin','sales_manager','cashier','seller','auditor')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  seller_code text unique not null,
  full_name text not null,
  phone text,
  commission_rate numeric(5,2) not null default 0 check (commission_rate between 0 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Association facultative : un vendeur sans compte reste géré par l'administration.
alter table public.tm_profiles add column if not exists seller_id uuid;
do $
begin
  if not exists (select 1 from pg_constraint where conname = 'tm_profiles_seller_id_fkey' and conrelid = 'public.tm_profiles'::regclass) then
    alter table public.tm_profiles add constraint tm_profiles_seller_id_fkey foreign key (seller_id) references public.sellers(id) on delete restrict;
  end if;
end $;
create unique index if not exists tm_profiles_seller_id_unique on public.tm_profiles(seller_id) where seller_id is not null;

create table if not exists public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_prices (
  id uuid primary key default gen_random_uuid(),
  ticket_type_id uuid not null references public.ticket_types(id),
  unit_price bigint not null check (unit_price >= 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from)
);

create table if not exists public.distributions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  seller_id uuid not null references public.sellers(id),
  distributed_at timestamptz not null default now(),
  status text not null default 'draft' check (status in ('draft','validated','cancelled')),
  notes text,
  created_by uuid references neon_auth."user"(id),
  created_at timestamptz not null default now()
);

create table if not exists public.distribution_items (
  id uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.distributions(id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types(id),
  quantity integer not null check (quantity > 0),
  reference_unit_price bigint not null check (reference_unit_price >= 0)
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  seller_id uuid not null references public.sellers(id),
  sold_at timestamptz not null default now(),
  period_start date,
  period_end date,
  status text not null default 'draft' check (status in ('draft','validated','cancelled')),
  notes text,
  created_by uuid references neon_auth."user"(id),
  created_at timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end >= period_start)
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types(id),
  quantity integer not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  commission_rate numeric(5,2) not null check (commission_rate between 0 and 100),
  revenue bigint generated always as (quantity::bigint * unit_price) stored,
  commission_amount bigint generated always as
    (round(quantity::numeric * unit_price * commission_rate / 100)::bigint) stored
);

create table if not exists public.remittances (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  seller_id uuid not null references public.sellers(id),
  amount bigint not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash','bank_transfer','mobile_money','other')),
  transaction_reference text,
  paid_at timestamptz not null default now(),
  received_by uuid references neon_auth."user"(id),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references neon_auth."user"(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_distributions_seller_date on public.distributions(seller_id, distributed_at);
create index if not exists idx_sales_seller_date on public.sales(seller_id, sold_at);
create index if not exists idx_remittances_seller_date on public.remittances(seller_id, paid_at);
create index if not exists idx_sale_items_sale on public.sale_items(sale_id);
create index if not exists idx_distribution_items_distribution on public.distribution_items(distribution_id);

create or replace view public.seller_financial_summary as
select
  s.id as seller_id,
  s.seller_code,
  s.full_name,
  s.commission_rate,
  coalesce(v.revenue,0)::bigint as revenue,
  coalesce(v.commission,0)::bigint as commission,
  (coalesce(v.revenue,0)-coalesce(v.commission,0))::bigint as net_to_remit,
  coalesce(r.remitted,0)::bigint as remitted,
  (coalesce(v.revenue,0)-coalesce(v.commission,0)-coalesce(r.remitted,0))::bigint as balance_to_remit
from public.sellers s
left join (
  select sa.seller_id, sum(si.revenue) revenue, sum(si.commission_amount) commission
  from public.sales sa join public.sale_items si on si.sale_id=sa.id
  where sa.status='validated' group by sa.seller_id
) v on v.seller_id=s.id
left join (
  select seller_id, sum(amount) remitted from public.remittances group by seller_id
) r on r.seller_id=s.id;

-- Les données financières ne sont pas exposées par une API publique.
-- Les accès applicatifs doivent passer par une API serveur authentifiant le JWT Neon.
