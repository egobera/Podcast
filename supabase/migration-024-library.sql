-- Canon migration 024. A library that outlives a series.
--
-- Deleting a series takes its audio with it, which is right: nobody wants a storage bill
-- for episodes they threw away. But a theme you like and a narrator you spent an afternoon
-- getting right are not part of one series, they are part of your work.
--
-- Saving is deliberate. Everything kept by default becomes a drawer nobody opens, so this
-- fills only when somebody presses a button.
--
-- The audio is copied rather than referenced, so the library survives the series it came
-- from. A voice needs no copy: it lives in the provider's account and a preset is enough.
-- Safe to run more than once.

create table if not exists library_assets (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  kind text not null default 'sfx',
  description text default '',
  storage_path text not null,
  duration_ms integer,
  expected_ms integer,
  from_project text,
  saved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists library_voices (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  description text default '',
  voice_prompt text default '',
  direction_notes text default '',
  voice_id text not null,
  model text not null default 'eleven_v3',
  stability numeric not null default 0.5,
  similarity numeric not null default 0.75,
  style numeric not null default 0,
  speed numeric not null default 1.0,
  seed integer,
  accent text,
  source text not null default 'catalog',
  from_project text,
  saved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_library_assets on library_assets(team_id, created_at desc);
create index if not exists idx_library_voices on library_voices(team_id, created_at desc);

alter table library_assets enable row level security;
alter table library_voices enable row level security;

drop policy if exists "library assets read" on library_assets;
create policy "library assets read" on library_assets for select to authenticated
  using (is_team_member(team_id));
drop policy if exists "library assets write" on library_assets;
create policy "library assets write" on library_assets for insert to authenticated
  with check (can_edit_team(team_id));
drop policy if exists "library assets update" on library_assets;
create policy "library assets update" on library_assets for update to authenticated
  using (can_edit_team(team_id));
drop policy if exists "library assets delete" on library_assets;
create policy "library assets delete" on library_assets for delete to authenticated
  using (can_edit_team(team_id));

drop policy if exists "library voices read" on library_voices;
create policy "library voices read" on library_voices for select to authenticated
  using (is_team_member(team_id));
drop policy if exists "library voices write" on library_voices;
create policy "library voices write" on library_voices for insert to authenticated
  with check (can_edit_team(team_id));
drop policy if exists "library voices update" on library_voices;
create policy "library voices update" on library_voices for update to authenticated
  using (can_edit_team(team_id));
drop policy if exists "library voices delete" on library_voices;
create policy "library voices delete" on library_voices for delete to authenticated
  using (can_edit_team(team_id));
