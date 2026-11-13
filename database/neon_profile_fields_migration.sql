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
