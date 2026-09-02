-- Estudio. Run this whole file once in the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- A project is one series. Casi Superpoderes is a project.
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null,
  language text not null default 'es-MX',
  mix_target_lufs numeric not null default -16,
  music_duck_db numeric not null default 20,
  style_notes text default '',
  created_at timestamptz not null default now()
);

-- The Series Vault. Assets that live across every episode.
create table if not exists series_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,           -- theme_open | theme_close | bed | freeze_in | freeze_pulse | freeze_out | villain | sfx
  name text not null,
  storage_path text,
  duration_ms integer,
  provider text,                -- suno | elevenlabs | upload | freesound
  license_note text,
  auto_place text,              -- open | close | none. Drives the episode template.
  locked boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

-- A character is a locked voice preset, not just a voice.
create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  source text not null default 'catalog',   -- catalog | cloned | human
  voice_id text,
  model text not null default 'eleven_v3',
  stability numeric not null default 0.5,
  similarity numeric not null default 0.75,
  style numeric not null default 0.3,
  direction_notes text default '',
  consent_url text,             -- required when source = cloned and the speaker is a minor
  locked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists episodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  number integer not null,
  title text not null,
  script_text text default '',
  target_min_ms integer not null default 840000,
  target_max_ms integer not null default 960000,
  created_at timestamptz not null default now()
);

-- One row per thing that must exist for the episode to be finished.
create table if not exists elements (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  idx integer not null,
  scene text default '',
  kind text not null,                    -- dialogue | sfx | ambience | music
  character_id uuid references characters(id) on delete set null,
  series_asset_id uuid references series_assets(id) on delete set null,
  text_content text default '',          -- the line, or the description of the sound
  source_hash text default '',           -- hash of text_content when the approved take was made
  prompt text default '',
  anchor text not null default 'line',   -- line | scene
  start_ms integer not null default 0,
  duration_ms integer not null default 0,
  gain_role text not null default 'auto',-- voice | ambience | spot | impact | bed | theme
  status text not null default 'missing',-- missing | generated | approved | stale
  approved_take_id uuid,
  created_at timestamptz not null default now()
);

-- Every generation is a take. Nothing is ever overwritten.
create table if not exists takes (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null references elements(id) on delete cascade,
  storage_path text not null,
  duration_ms integer not null default 0,
  prompt_used text default '',
  provider text default '',
  params jsonb default '{}'::jsonb,
  cost_cents numeric default 0,
  created_at timestamptz not null default now()
);

alter table elements
  add constraint elements_approved_take_fk
  foreign key (approved_take_id) references takes(id) on delete set null;

-- Background job tracking for the first pass generator.
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  status text not null default 'queued',  -- queued | running | done | cancelled | failed
  total integer not null default 0,
  done integer not null default 0,
  failed integer not null default 0,
  message text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_elements_episode on elements(episode_id, idx);
create index if not exists idx_takes_element on takes(element_id, created_at desc);

-- Row level security. Everything is reachable only through the owning project.
alter table projects enable row level security;
alter table series_assets enable row level security;
alter table characters enable row level security;
alter table episodes enable row level security;
alter table elements enable row level security;
alter table takes enable row level security;
alter table jobs enable row level security;

create policy "own projects" on projects
  for all using (owner = auth.uid()) with check (owner = auth.uid());

create policy "own series_assets" on series_assets for all
  using (exists (select 1 from projects p where p.id = project_id and p.owner = auth.uid()))
  with check (exists (select 1 from projects p where p.id = project_id and p.owner = auth.uid()));

create policy "own characters" on characters for all
  using (exists (select 1 from projects p where p.id = project_id and p.owner = auth.uid()))
  with check (exists (select 1 from projects p where p.id = project_id and p.owner = auth.uid()));

create policy "own episodes" on episodes for all
  using (exists (select 1 from projects p where p.id = project_id and p.owner = auth.uid()))
  with check (exists (select 1 from projects p where p.id = project_id and p.owner = auth.uid()));

create policy "own elements" on elements for all
  using (exists (select 1 from episodes e join projects p on p.id = e.project_id
                 where e.id = episode_id and p.owner = auth.uid()))
  with check (exists (select 1 from episodes e join projects p on p.id = e.project_id
                 where e.id = episode_id and p.owner = auth.uid()));

create policy "own takes" on takes for all
  using (exists (select 1 from elements el join episodes e on e.id = el.episode_id
                 join projects p on p.id = e.project_id
                 where el.id = element_id and p.owner = auth.uid()))
  with check (exists (select 1 from elements el join episodes e on e.id = el.episode_id
                 join projects p on p.id = e.project_id
                 where el.id = element_id and p.owner = auth.uid()));

create policy "own jobs" on jobs for all
  using (exists (select 1 from episodes e join projects p on p.id = e.project_id
                 where e.id = episode_id and p.owner = auth.uid()))
  with check (exists (select 1 from episodes e join projects p on p.id = e.project_id
                 where e.id = episode_id and p.owner = auth.uid()));

-- Storage bucket for audio. Private, served through signed URLs.
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;

create policy "own audio read" on storage.objects for select
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own audio write" on storage.objects for insert
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own audio update" on storage.objects for update
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own audio delete" on storage.objects for delete
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
