-- Ticket Manager: extension des informations personnelles du profil
alter table public.tm_profiles
  add column if not exists date_of_birth date,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists country text,
  add column if not exists job_title text,
  add column if not exists department text,
  add column if not exists employee_code text,
  add column if not exists avatar_url text,
  add column if not exists preferred_language text not null default 'fr',
  add column if not exists theme text not null default 'light',
  add column if not exists email_notifications boolean not null default true;

alter table public.tm_profiles
  drop constraint if exists tm_profiles_preferred_language_check,
  add constraint tm_profiles_preferred_language_check check (preferred_language in ('fr','en'));

alter table public.tm_profiles
  drop constraint if exists tm_profiles_theme_check,
  add constraint tm_profiles_theme_check check (theme in ('light','dark'));

-- Matricule automatique, stable et non modifiable depuis le profil utilisateur.
-- Format : TM-AAAAMMJJ-XXXXXX (suffixe dérivé de l'identifiant utilisateur).
update public.tm_profiles
set employee_code = 'TM-' || to_char(coalesce(created_at, now()), 'YYYYMMDD') || '-' || upper(substr(replace(user_id::text, '-', ''), 1, 6))
where employee_code is null or btrim(employee_code) = '';

create or replace function public.tm_assign_employee_code()
returns trigger
language plpgsql
as $$
begin
  if new.employee_code is null or btrim(new.employee_code) = '' then
    new.employee_code := 'TM-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(replace(new.user_id::text, '-', ''), 1, 6));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tm_assign_employee_code on public.tm_profiles;
create trigger trg_tm_assign_employee_code
before insert on public.tm_profiles
for each row execute function public.tm_assign_employee_code();

create unique index if not exists tm_profiles_employee_code_unique
on public.tm_profiles(employee_code)
where employee_code is not null;
