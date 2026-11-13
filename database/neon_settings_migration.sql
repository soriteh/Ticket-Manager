-- Ticket Manager — migration des paramètres persistants
-- À exécuter une seule fois dans le SQL Editor de Neon.
-- La ligne unique conserve les paramètres communs à toute l'application.

create table if not exists public.tm_app_settings (
  id boolean primary key default true check (id = true),
  ticket_name text not null default 'Ticket standard',
  ticket_price bigint not null default 5000 check (ticket_price >= 0),
  default_commission_rate numeric(5,2) not null default 10
    check (default_commission_rate between 0 and 100),
  updated_by uuid references neon_auth."user"(id),
  updated_at timestamptz not null default now()
);

insert into public.tm_app_settings (id)
values (true)
on conflict (id) do nothing;

-- Vérification
select ticket_name, ticket_price, default_commission_rate, updated_at
from public.tm_app_settings
where id = true;
