-- Schéma Supabase du comparateur présidentielle 2027.
-- À exécuter une fois : Supabase > SQL Editor > New query > coller ce fichier > Run.
-- Le site public reste statique (Netlify). Supabase sert :
--   1. à valider les propositions des agents (table propositions, privée) ;
--   2. à recevoir les signalements d'erreur des visiteurs (table signalements, dépôt public seulement) ;
--   3. à stocker les captures des sources des propositions (bucket privé « preuves »).

-- 1. Propositions des agents ---------------------------------------------------
create table if not exists public.propositions (
  id               text primary key,               -- ex. 2026-11-25-003
  lot              date not null,
  agent            text,
  type             text not null,
  table_cible      text,
  id_existant      text,
  champ            text,
  candidat         text,
  resume           text,                           -- résumé lisible de la proposition
  valeur_actuelle  jsonb,
  valeur_proposee  jsonb,
  source_url       text,
  citation         text,
  date_source      text,
  confiance        text,
  verification     text,                           -- confirme | partiel | infirme | non_verifiable
  verification_detail jsonb,
  revue_neutralite jsonb,
  revue_budget     jsonb,
  controle_auto    jsonb,
  passage_trouve   text,                           -- exacte | partielle | approchante | non
  capture_url      text,                           -- lien signé (valable 60 jours) vers la capture
  decision         text not null default 'a_valider' check (decision in ('a_valider', 'accepte', 'refuse')),
  note_humaine     text,
  decide_le        timestamptz,
  integre_le       date,
  id_cree          text,
  cree_le          timestamptz not null default now(),
  maj_le           timestamptz not null default now()
);
create index if not exists propositions_lot_idx on public.propositions (lot desc);
create index if not exists propositions_decision_idx on public.propositions (decision);

-- Date de décision renseignée automatiquement quand on change « decision ».
create or replace function public.propositions_horodatage() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.maj_le := now();
  if new.decision is distinct from old.decision then new.decide_le := now(); end if;
  return new;
end $$;
drop trigger if exists propositions_horodatage on public.propositions;
create trigger propositions_horodatage before update on public.propositions
  for each row execute function public.propositions_horodatage();

-- Vue de travail : ce qui reste à valider, le plus sûr en premier.
create or replace view public.a_valider with (security_invoker = true) as
select id, lot, candidat, type, resume, verification, passage_trouve, confiance,
       capture_url, source_url, citation, decision, note_humaine
from public.propositions
where decision = 'a_valider'
order by lot desc,
  case verification when 'confirme' then 0 when 'partiel' then 1 when 'non_verifiable' then 2 else 3 end,
  id;

-- Table privée : RLS activé SANS politique => seule la clé service_role (scripts locaux) y accède.
alter table public.propositions enable row level security;

-- 2. Signalements des visiteurs --------------------------------------------------
create table if not exists public.signalements (
  id          bigint generated always as identity primary key,
  cree_le     timestamptz not null default now(),
  reference   text check (reference is null or char_length(reference) <= 200),
  message     text not null check (char_length(message) between 10 and 2000),
  source_url  text check (source_url is null or (char_length(source_url) <= 500 and source_url ~ '^https?://')),
  contact     text check (contact is null or char_length(contact) <= 200),
  statut      text not null default 'nouveau' check (statut in ('nouveau', 'en_cours', 'traite', 'rejete')),
  reponse     text
);
alter table public.signalements enable row level security;
-- Les visiteurs peuvent DÉPOSER un signalement, jamais lire ceux des autres.
drop policy if exists "depot public de signalements" on public.signalements;
create policy "depot public de signalements" on public.signalements
  for insert to anon with check (statut = 'nouveau' and reponse is null);
grant insert (reference, message, source_url, contact) on public.signalements to anon;

-- Droits explicites : le projet n'accorde PAS automatiquement l'accès API aux nouvelles tables
-- (option « Grant API access to new tables automatically » décochée). On donne exactement le nécessaire.
grant usage on schema public to anon, service_role;
grant select, insert, update, delete on public.propositions to service_role;
grant select on public.a_valider to service_role;
grant select, insert, update, delete on public.signalements to service_role;
grant usage, select on sequence public.signalements_id_seq to service_role;
grant usage on sequence public.signalements_id_seq to anon;   -- nécessaire pour l'identifiant auto du dépôt public
revoke all on public.propositions from anon, authenticated;
revoke all on public.a_valider from anon, authenticated;
revoke select, update, delete on public.signalements from anon, authenticated;

-- 3. Captures des sources (bucket privé) -----------------------------------------
insert into storage.buckets (id, name, public)
values ('preuves', 'preuves', false)
on conflict (id) do nothing;
