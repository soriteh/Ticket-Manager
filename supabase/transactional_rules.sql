-- Ticket Manager — règles transactionnelles et garde-fous métier
-- À exécuter après schema.sql et rls_policies.sql.

-- Création automatique d'un profil minimal à l'inscription.
-- Le rôle est fixé côté serveur à seller : aucune valeur de rôle fournie par le navigateur n'est utilisée.
create or replace function public.tm_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, role, is_active)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Nouveau vendeur'),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    'seller',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.tm_handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists tm_on_auth_user_created on auth.users;
create trigger tm_on_auth_user_created
after insert on auth.users
for each row execute procedure public.tm_handle_new_auth_user();

-- Contrôle du plafond distribué avant validation d'une déclaration.
-- Le vendeur ne peut pas valider davantage de tickets qu'il n'en a reçus.
create or replace function public.tm_check_sale_quantities()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item record;
  qty_distributed bigint;
  qty_previously_sold bigint;
begin
  if new.status <> 'validated' or old.status = 'validated' then
    return new;
  end if;

  -- Sérialise les validations du même vendeur afin d'éviter les validations concurrentes en dépassement.
  perform 1 from public.sellers where id = new.seller_id for update;

  for item in
    select ticket_type_id, sum(quantity)::bigint as qty
    from public.sale_items
    where sale_id = new.id
    group by ticket_type_id
  loop
    select coalesce(sum(di.quantity), 0)
      into qty_distributed
    from public.distributions d
    join public.distribution_items di on di.distribution_id = d.id
    where d.seller_id = new.seller_id
      and d.status = 'validated'
      and di.ticket_type_id = item.ticket_type_id;

    select coalesce(sum(si.quantity), 0)
      into qty_previously_sold
    from public.sales sa
    join public.sale_items si on si.sale_id = sa.id
    where sa.seller_id = new.seller_id
      and sa.status = 'validated'
      and sa.id <> new.id
      and si.ticket_type_id = item.ticket_type_id;

    if qty_previously_sold + item.qty > qty_distributed then
      raise exception 'Quantité vendue supérieure à la quantité distribuée pour le type de ticket % (distribué %, déjà vendu %, déclaration %)',
        item.ticket_type_id, qty_distributed, qty_previously_sold, item.qty
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists tm_validate_sale_quantities on public.sales;
create trigger tm_validate_sale_quantities
before update of status on public.sales
for each row execute function public.tm_check_sale_quantities();

-- Les éléments d'une déclaration validée sont immuables.
create or replace function public.tm_prevent_validated_sale_item_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_status text;
begin
  select status into parent_status from public.sales where id = coalesce(new.sale_id, old.sale_id);
  if parent_status = 'validated' then
    raise exception 'Une vente validée est verrouillée. Effectuez une annulation/correction tracée par un administrateur.'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists tm_lock_validated_sale_items on public.sale_items;
create trigger tm_lock_validated_sale_items
before update or delete on public.sale_items
for each row execute function public.tm_prevent_validated_sale_item_change();

-- Les distributions validées sont verrouillées pour préserver l'historique des quantités.
create or replace function public.tm_prevent_validated_distribution_item_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_status text;
begin
  select status into parent_status from public.distributions where id = coalesce(new.distribution_id, old.distribution_id);
  if parent_status = 'validated' then
    raise exception 'Une distribution validée est verrouillée. Effectuez une correction tracée par un administrateur.'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists tm_lock_validated_distribution_items on public.distribution_items;
create trigger tm_lock_validated_distribution_items
before update or delete on public.distribution_items
for each row execute function public.tm_prevent_validated_distribution_item_change();
