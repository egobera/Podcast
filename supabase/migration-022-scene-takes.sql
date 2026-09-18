-- Estudio migration 022. A scene as one performance.
--
-- Generating each line on its own and butting the files together can never sound like a
-- conversation: every take was recorded without knowing the others existed. Text to
-- Dialogue takes the whole scene at once and decides for itself when to come in, when to
-- overlap and when to wait.
--
-- The trade is control. A scene take covers many elements, so redoing one line means
-- redoing the scene. That is why it lives alongside the per line takes rather than
-- replacing them: fast exchanges want the scene, a narrator wants the line.
-- Safe to run more than once.

create table if not exists scene_takes (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  scene text not null,
  storage_path text not null,
  duration_ms integer not null default 0,
  /** The elements this one performance covers, in order. */
  element_ids uuid[] not null default '{}',
  seed integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_scene_takes on scene_takes(episode_id, scene, created_at desc);

alter table scene_takes enable row level security;

drop policy if exists "scene takes read" on scene_takes;
create policy "scene takes read" on scene_takes for select to authenticated
  using (exists (select 1 from episodes e where e.id = episode_id and can_read_project(e.project_id)));

drop policy if exists "scene takes write" on scene_takes;
create policy "scene takes write" on scene_takes for insert to authenticated
  with check (exists (select 1 from episodes e where e.id = episode_id and can_write_project(e.project_id)));

drop policy if exists "scene takes delete" on scene_takes;
create policy "scene takes delete" on scene_takes for delete to authenticated
  using (exists (select 1 from episodes e where e.id = episode_id and can_write_project(e.project_id)));

-- Which scenes are performed together, and which stay line by line.
alter table episodes add column if not exists dialogue_scenes text[] not null default '{}';

-- An element covered by a scene take points at it, so the timeline knows not to expect
-- audio of its own.
alter table elements add column if not exists scene_take_id uuid references scene_takes(id) on delete set null;
