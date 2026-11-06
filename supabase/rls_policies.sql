-- Ticket Manager — politiques RLS de production
-- À exécuter après supabase/schema.sql.
-- Les droits métier sont déterminés par public.profiles.role, jamais par user_metadata.

create or replace function public.tm_is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.role in ('super_admin','admin')
  );
$$;

create or replace function public.tm_is_manager()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.role in ('super_admin','admin','sales_manager','auditor')
  );
$$;

create or replace function public.tm_is_cashier()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.role in ('super_admin','admin','cashier')
  );
$$;

-- Le vendeur est toujours lié au compte authentifié par sellers.profile_id.
create or replace function public.tm_owns_seller(target_seller uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.sellers s
    where s.id = target_seller and s.profile_id = (select auth.uid())
  );
$$;

-- Profils : chaque utilisateur voit son profil ; l'administration voit l'ensemble.
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select public.tm_is_admin()));

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin on public.profiles
for update to authenticated
using (id = (select auth.uid()) or (select public.tm_is_admin()))
with check (id = (select auth.uid()) or (select public.tm_is_admin()));

-- Vendeurs : vendeur limité à sa fiche ; équipe de gestion accès global.
drop policy if exists sellers_select_scoped on public.sellers;
create policy sellers_select_scoped on public.sellers
for select to authenticated
using ((select public.tm_is_manager()) or profile_id = (select auth.uid()));

drop policy if exists sellers_insert_admin on public.sellers;
create policy sellers_insert_admin on public.sellers
for insert to authenticated
with check ((select public.tm_is_admin()));

drop policy if exists sellers_update_admin on public.sellers;
create policy sellers_update_admin on public.sellers
for update to authenticated
using ((select public.tm_is_admin()))
with check ((select public.tm_is_admin()));

drop policy if exists sellers_delete_admin on public.sellers;
create policy sellers_delete_admin on public.sellers
for delete to authenticated
using ((select public.tm_is_admin()));

-- Catalogue : lecture aux comptes actifs ; modification réservée à l'administration.
drop policy if exists ticket_types_read_authenticated on public.ticket_types;
create policy ticket_types_read_authenticated on public.ticket_types
for select to authenticated using (true);
drop policy if exists ticket_types_write_admin on public.ticket_types;
create policy ticket_types_write_admin on public.ticket_types
for all to authenticated
using ((select public.tm_is_admin()))
with check ((select public.tm_is_admin()));

drop policy if exists ticket_prices_read_authenticated on public.ticket_prices;
create policy ticket_prices_read_authenticated on public.ticket_prices
for select to authenticated using (true);
drop policy if exists ticket_prices_write_admin on public.ticket_prices;
create policy ticket_prices_write_admin on public.ticket_prices
for all to authenticated
using ((select public.tm_is_admin()))
with check ((select public.tm_is_admin()));

-- Distributions : vendeur en lecture seule sur ses distributions ; gestion écrit.
drop policy if exists distributions_select_scoped on public.distributions;
create policy distributions_select_scoped on public.distributions
for select to authenticated
using ((select public.tm_is_manager()) or (select public.tm_owns_seller(seller_id)));
drop policy if exists distributions_insert_manager on public.distributions;
create policy distributions_insert_manager on public.distributions
for insert to authenticated
with check ((select public.tm_is_admin()) or exists (
  select 1 from public.profiles p where p.id=(select auth.uid())
  and p.is_active and p.role='sales_manager'
));
drop policy if exists distributions_update_admin on public.distributions;
create policy distributions_update_admin on public.distributions
for update to authenticated
using ((select public.tm_is_admin()))
with check ((select public.tm_is_admin()));

drop policy if exists distribution_items_select_scoped on public.distribution_items;
create policy distribution_items_select_scoped on public.distribution_items
for select to authenticated
using (exists (
  select 1 from public.distributions d
  where d.id=distribution_id
  and ((select public.tm_is_manager()) or (select public.tm_owns_seller(d.seller_id)))
));
drop policy if exists distribution_items_write_manager on public.distribution_items;
create policy distribution_items_write_manager on public.distribution_items
for all to authenticated
using ((select public.tm_is_admin()) or exists (
  select 1 from public.profiles p where p.id=(select auth.uid())
  and p.is_active and p.role='sales_manager'
))
with check ((select public.tm_is_admin()) or exists (
  select 1 from public.profiles p where p.id=(select auth.uid())
  and p.is_active and p.role='sales_manager'
));

-- Ventes : vendeurs peuvent créer et consulter leurs propres déclarations.
drop policy if exists sales_select_scoped on public.sales;
create policy sales_select_scoped on public.sales
for select to authenticated
using ((select public.tm_is_manager()) or (select public.tm_owns_seller(seller_id)));
drop policy if exists sales_insert_owner_or_manager on public.sales;
create policy sales_insert_owner_or_manager on public.sales
for insert to authenticated
with check ((select public.tm_is_admin()) or
  (select public.tm_owns_seller(seller_id)) or exists (
    select 1 from public.profiles p where p.id=(select auth.uid())
    and p.is_active and p.role='sales_manager'
  ));
drop policy if exists sales_update_admin on public.sales;
create policy sales_update_admin on public.sales
for update to authenticated
using ((select public.tm_is_admin()))
with check ((select public.tm_is_admin()));

drop policy if exists sale_items_select_scoped on public.sale_items;
create policy sale_items_select_scoped on public.sale_items
for select to authenticated
using (exists (
  select 1 from public.sales sa
  where sa.id=sale_id
  and ((select public.tm_is_manager()) or (select public.tm_owns_seller(sa.seller_id)))
));
drop policy if exists sale_items_insert_owner_or_manager on public.sale_items;
create policy sale_items_insert_owner_or_manager on public.sale_items
for insert to authenticated
with check (exists (
  select 1 from public.sales sa
  where sa.id=sale_id and sa.status='draft'
  and ((select public.tm_is_admin()) or (select public.tm_owns_seller(sa.seller_id)) or exists (
    select 1 from public.profiles p where p.id=(select auth.uid())
    and p.is_active and p.role='sales_manager'
  ))
));
drop policy if exists sale_items_update_admin on public.sale_items;
create policy sale_items_update_admin on public.sale_items
for update to authenticated
using ((select public.tm_is_admin()))
with check ((select public.tm_is_admin()));

-- Reversements : vendeur consulte les siens ; caissier/admin enregistre.
drop policy if exists remittances_select_scoped on public.remittances;
create policy remittances_select_scoped on public.remittances
for select to authenticated
using ((select public.tm_is_manager()) or (select public.tm_owns_seller(seller_id)) or (select public.tm_is_cashier()));
drop policy if exists remittances_insert_cashier on public.remittances;
create policy remittances_insert_cashier on public.remittances
for insert to authenticated
with check ((select public.tm_is_cashier()));
drop policy if exists remittances_update_admin on public.remittances;
create policy remittances_update_admin on public.remittances
for update to authenticated
using ((select public.tm_is_admin()))
with check ((select public.tm_is_admin()));

-- Audit : lecture réservée à l'administration/audit ; insertion des événements par le serveur.
drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_admin on public.audit_logs
for select to authenticated
using ((select public.tm_is_admin()) or exists (
  select 1 from public.profiles p where p.id=(select auth.uid())
  and p.is_active and p.role='auditor'
));

-- Le résumé financier ne doit jamais contourner les règles RLS des tables sources.
alter view public.seller_financial_summary set (security_invoker = true);

-- Aucun accès anonyme à ces données.
revoke all on public.profiles, public.sellers, public.ticket_types, public.ticket_prices,
  public.distributions, public.distribution_items, public.sales, public.sale_items,
  public.remittances, public.audit_logs from anon;
grant select, insert, update, delete on public.profiles, public.sellers, public.ticket_types,
  public.ticket_prices, public.distributions, public.distribution_items, public.sales,
  public.sale_items, public.remittances, public.audit_logs to authenticated;
grant select on public.seller_financial_summary to authenticated;
