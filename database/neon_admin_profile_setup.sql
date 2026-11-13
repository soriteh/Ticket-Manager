-- Ticket Manager — diagnostic et activation contrôlée du compte administrateur
-- À exécuter dans le SQL Editor de Neon.
-- Remplacer uniquement EMAIL_A_REMPLACER par l'adresse exacte du compte Neon Auth.
-- Étape 1 : vérifier que le compte existe et relever son UUID.
select id, email, name
from neon_auth."user"
where lower(email) = lower('EMAIL_A_REMPLACER');

-- Étape 2 : créer/activer le profil admin pour CETTE adresse uniquement.
-- Si l'étape 1 ne retourne aucune ligne, ne pas exécuter l'étape 2 :
-- vérifier l'adresse e-mail et que l'utilisateur a bien terminé son inscription.
insert into public.tm_profiles (user_id, full_name, role, is_active)
select
  u.id,
  coalesce(nullif(trim(u.name), ''), u.email),
  'admin',
  true
from neon_auth."user" u
where lower(u.email) = lower('EMAIL_A_REMPLACER')
on conflict (user_id) do update
set
  full_name = excluded.full_name,
  role = 'admin',
  is_active = true;

-- Étape 3 : vérifier le résultat.
select
  p.user_id,
  u.email,
  p.full_name,
  p.role,
  p.is_active
from public.tm_profiles p
join neon_auth."user" u on u.id = p.user_id
where lower(u.email) = lower('EMAIL_A_REMPLACER');
