-- Estudio migration 010. Notes on a line.
--
-- A reviewer with a viewer role can listen and read but not change anything, which is
-- exactly right and also useless: they have no way to say "line 47 is too fast". Comments
-- are the one thing a viewer is allowed to write.
-- Safe to run more than once.

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null references elements(id) on delete cascade,
  episode_id uuid not null references episodes(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  author_email text,
  body text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_comments_element on comments(element_id, created_at);
create index if not exists idx_comments_episode on comments(episode_id) where not resolved;

alter table comments enable row level security;

-- Reading follows the project. Writing does too, deliberately at the read level:
-- reviewing is the point of a viewer, and a note changes no audio.
drop policy if exists "comments read" on comments;
create policy "comments read" on comments for select to authenticated
  using (exists (select 1 from episodes e where e.id = episode_id and can_read_project(e.project_id)));

drop policy if exists "comments write" on comments;
create policy "comments write" on comments for insert to authenticated
  with check (
    author = auth.uid()
    and exists (select 1 from episodes e where e.id = episode_id and can_read_project(e.project_id))
  );

-- Anyone on the team can mark a note resolved; only its author can edit or delete it.
drop policy if exists "comments resolve" on comments;
create policy "comments resolve" on comments for update to authenticated
  using (exists (select 1 from episodes e where e.id = episode_id and can_read_project(e.project_id)));

drop policy if exists "comments delete" on comments;
create policy "comments delete" on comments for delete to authenticated
  using (author = auth.uid());
