-- Ticket Manager — migration de cohérence du schéma et des commissions
-- À exécuter APRÈS neon_schema.sql et neon_supplier_stock_migration.sql.
-- Migration additive/idempotente : aucune table ni donnée existante n'est supprimée.
begin;

-- La vente conserve le taux fournisseur-receveur réellement applicable au jour de la vente.
alter table public.sale_items
  add column if not exists supplier_receiver_commission_rate numeric(5,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sale_items_supplier_receiver_commission_rate_check'
      and conrelid = 'public.sale_items'::regclass
  ) then
    alter table public.sale_items
      add constraint sale_items_supplier_receiver_commission_rate_check
      check (
        supplier_receiver_commission_rate is null
        or supplier_receiver_commission_rate between 0 and 100
      );
  end if;
end
$$;

-- Les anciens taux fournisseur-receveur restent NULL lorsqu'ils ne sont pas documentés.
-- Ne pas les reconstituer avec le taux actuel : cela falsifierait l'historique comptable.

-- Table attendue par l'API de configuration.
create table if not exists public.tm_app_settings (
  id boolean primary key default true check (id is true),
  app_name text not null default 'Ticket Manager',
  organization_name text not null default '',
  support_email text not null default '',
  support_phone text not null default '',
  timezone text not null default 'Africa/Conakry',
  ticket_name text not null default 'Ticket standard',
  ticket_price bigint not null default 5000 check (ticket_price >= 0),
  default_commission_rate numeric(5,2) not null default 10
    check (default_commission_rate between 0 and 100),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- Liaison facultative entre un profil Neon Auth et sa fiche vendeur.
-- Les profils existants (dont le Super Admin) restent non associés par défaut.
alter table public.tm_profiles
  add column if not exists seller_id uuid;

do $
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tm_profiles_seller_id_fkey'
      and conrelid = 'public.tm_profiles'::regclass
  ) then
    alter table public.tm_profiles
      add constraint tm_profiles_seller_id_fkey
      foreign key (seller_id) references public.sellers(id) on delete restrict;
  end if;
end
$;

create unique index if not exists tm_profiles_seller_id_unique
  on public.tm_profiles(seller_id)
  where seller_id is not null;

alter table public.tm_app_settings
  add column if not exists organization_name text not null default '',
  add column if not exists support_email text not null default '',
  add column if not exists support_phone text not null default '',
  add column if not exists timezone text not null default 'Africa/Conakry',
  add column if not exists ticket_name text not null default 'Ticket standard',
  add column if not exists ticket_price bigint not null default 5000,
  add column if not exists default_commission_rate numeric(5,2) not null default 10,
  add column if not exists updated_by uuid,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_sale_items_supplier_receiver_rate
  on public.sale_items(sale_id)
  where supplier_receiver_commission_rate is not null;

commit;
