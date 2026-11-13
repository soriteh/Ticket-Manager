-- Ticket Manager — extension de la configuration et des commissions fournisseur–receveur
-- À exécuter dans Neon SQL Editor après neon_settings_migration.sql.
-- Migration non destructive : les paramètres et opérations existants sont conservés.

alter table public.tm_app_settings
  add column if not exists app_name text not null default 'Ticket Manager',
  add column if not exists organization_name text not null default '',
  add column if not exists support_email text not null default '',
  add column if not exists support_phone text not null default '',
  add column if not exists timezone text not null default 'Africa/Conakry';

create table if not exists public.supplier_receiver_commissions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  seller_id uuid not null references public.sellers(id),
  commission_rate numeric(5,2) not null check (commission_rate between 0 and 100),
  valid_from date not null default current_date,
  valid_to date,
  created_by uuid references neon_auth."user"(id),
  created_at timestamptz not null default now(),
  constraint supplier_receiver_commissions_valid_dates
    check (valid_to is null or valid_to >= valid_from),
  constraint supplier_receiver_commissions_pair_date_unique
    unique (supplier_id,seller_id,valid_from)
);

alter table public.sale_items
  add column if not exists supplier_receiver_commission_rate numeric(5,2)
  check (supplier_receiver_commission_rate between 0 and 100);

create index if not exists idx_supplier_receiver_commissions_pair_dates
  on public.supplier_receiver_commissions(supplier_id,seller_id,valid_from desc);

select app_name, organization_name, support_email, support_phone, timezone
from public.tm_app_settings where id = true;

select supplier_id, seller_id, commission_rate, valid_from, valid_to
from public.supplier_receiver_commissions
order by supplier_id,seller_id,valid_from desc;
