-- Ticket Manager — attribution du rôle Super Administrateur
-- Compte ciblé : soritechn@gmail.com
-- À exécuter dans le SQL Editor de la base Neon de production.
-- Le script échoue volontairement si le compte n'existe pas ou si plusieurs comptes correspondent.

begin;

do $$
declare
  target_user_id uuid;
  target_name text;
begin
  select id, coalesce(nullif(trim(name), ''), email)
    into target_user_id, target_name
  from neon_auth."user"
  where lower(email) = lower('soritechn@gmail.com');

  if target_user_id is null then
    raise exception 'Aucun compte Neon Auth trouvé pour soritechn@gmail.com. Vérifiez que le compte existe avant de relancer.';
  end if;

  insert into public.tm_profiles (user_id, full_name, role, is_active)
  values (target_user_id, target_name, 'super_admin', true)
  on conflict (user_id) do update
    set role = 'super_admin',
        is_active = true,
        full_name = coalesce(nullif(public.tm_profiles.full_name, ''), excluded.full_name);
end
$$;

select u.email, p.full_name, p.role, p.is_active
from public.tm_profiles p
join neon_auth."user" u on u.id = p.user_id
where lower(u.email) = lower('soritechn@gmail.com');

commit;
