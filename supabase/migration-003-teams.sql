-- Estudio migration 003. Teams.
-- Run after schema.sql and migration 002. Safe on an existing database: it moves what you
-- already have into a personal team and keeps every file where it is.

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  role text not null default 'editor',   -- owner | editor | viewer
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  email text not null,
  role text not null default 'editor',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, email)
);

alter table projects add column if not exists team_id uuid references teams(id) on delete cascade;

create index if not exists idx_members_user on team_members(user_id);
create index if not exists idx_invites_email on team_invites(lower(email));
create index if not exists idx_projects_team on projects(team_id);

-- ---------------------------------------------------------------------------
-- Helpers. security definer so a policy on team_members can ask about
-- team_members without triggering its own policy and recursing forever.
-- ---------------------------------------------------------------------------

create or replace function public.is_team_member(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = t and user_id = auth.uid());
$$;

create or replace function public.can_edit_team(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where team_id = t and user_id = auth.uid() and role in ('owner', 'editor')
  );
$$;

create or replace function public.is_team_owner(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where team_id = t and user_id = auth.uid() and role = 'owner'
  );
$$;

/* Membership seen from a project, used by everything that hangs off one. */
create or replace function public.can_read_project(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects pr
    join team_members m on m.team_id = pr.team_id
    where pr.id = p and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_write_project(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects pr
    join team_members m on m.team_id = pr.team_id
    where pr.id = p and m.user_id = auth.uid() and m.role in ('owner', 'editor')
  );
$$;

/* Two people who share any team can read each other's stored audio. Legacy files
   live under the uploader's user id, so this keeps them reachable without moving them. */
create or replace function public.shares_team_with(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members a
    join team_members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- ---------------------------------------------------------------------------
-- Creating a team makes you its owner.
-- ---------------------------------------------------------------------------

create or replace function public.add_creator_as_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into team_members (team_id, user_id, email, role)
  values (new.id, new.created_by, (select email from auth.users where id = new.created_by), 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_team_created on teams;
create trigger on_team_created after insert on teams
  for each row execute function public.add_creator_as_owner();

/* Called by the app right after sign in. Turns any invite matching this user's
   email into a real membership. No email is ever sent. */
create or replace function public.claim_invites()
returns integer language plpgsql security definer set search_path = public as $$
declare
  claimed integer;
  my_email text;
begin
  select email into my_email from auth.users where id = auth.uid();
  if my_email is null then return 0; end if;

  insert into team_members (team_id, user_id, email, role)
  select i.team_id, auth.uid(), my_email, i.role
  from team_invites i
  where lower(i.email) = lower(my_email)
  on conflict (team_id, user_id) do nothing;

  get diagnostics claimed = row_count;
  delete from team_invites where lower(email) = lower(my_email);
  return claimed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill. Every existing project moves into a personal team for its owner.
-- ---------------------------------------------------------------------------

do $$
declare
  o uuid;
  t uuid;
begin
  for o in select distinct owner from projects where team_id is null loop
    insert into teams (name, created_by) values ('Personal', o) returning id into t;
    update projects set team_id = t where owner = o and team_id is null;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Policies. Everything is reachable through team membership now.
-- ---------------------------------------------------------------------------

alter table teams enable row level security;
alter table team_members enable row level security;
alter table team_invites enable row level security;

drop policy if exists "own projects" on projects;
drop policy if exists "own series_assets" on series_assets;
drop policy if exists "own characters" on characters;
drop policy if exists "own episodes" on episodes;
drop policy if exists "own elements" on elements;
drop policy if exists "own takes" on takes;
drop policy if exists "own jobs" on jobs;

create policy "teams read" on teams for select using (is_team_member(id));
create policy "teams create" on teams for insert with check (created_by = auth.uid());
create policy "teams update" on teams for update using (is_team_owner(id));
create policy "teams delete" on teams for delete using (is_team_owner(id));

create policy "members read" on team_members for select using (is_team_member(team_id));
create policy "members add" on team_members for insert with check (is_team_owner(team_id));
create policy "members change" on team_members for update using (is_team_owner(team_id));
create policy "members remove" on team_members for delete
  using (is_team_owner(team_id) or user_id = auth.uid());

create policy "invites read" on team_invites for select using (is_team_member(team_id));
create policy "invites create" on team_invites for insert with check (is_team_owner(team_id));
create policy "invites delete" on team_invites for delete using (is_team_owner(team_id));

create policy "projects read" on projects for select using (is_team_member(team_id));
create policy "projects write" on projects for insert with check (can_edit_team(team_id));
create policy "projects update" on projects for update using (can_edit_team(team_id));
create policy "projects delete" on projects for delete using (is_team_owner(team_id));

create policy "assets read" on series_assets for select using (can_read_project(project_id));
create policy "assets write" on series_assets for insert with check (can_write_project(project_id));
create policy "assets update" on series_assets for update using (can_write_project(project_id));
create policy "assets delete" on series_assets for delete using (can_write_project(project_id));

create policy "chars read" on characters for select using (can_read_project(project_id));
create policy "chars write" on characters for insert with check (can_write_project(project_id));
create policy "chars update" on characters for update using (can_write_project(project_id));
create policy "chars delete" on characters for delete using (can_write_project(project_id));

create policy "eps read" on episodes for select using (can_read_project(project_id));
create policy "eps write" on episodes for insert with check (can_write_project(project_id));
create policy "eps update" on episodes for update using (can_write_project(project_id));
create policy "eps delete" on episodes for delete using (can_write_project(project_id));

create policy "els read" on elements for select
  using (exists (select 1 from episodes e where e.id = episode_id and can_read_project(e.project_id)));
create policy "els write" on elements for insert
  with check (exists (select 1 from episodes e where e.id = episode_id and can_write_project(e.project_id)));
create policy "els update" on elements for update
  using (exists (select 1 from episodes e where e.id = episode_id and can_write_project(e.project_id)));
create policy "els delete" on elements for delete
  using (exists (select 1 from episodes e where e.id = episode_id and can_write_project(e.project_id)));

create policy "takes read" on takes for select
  using (exists (select 1 from elements el join episodes e on e.id = el.episode_id
                 where el.id = element_id and can_read_project(e.project_id)));
create policy "takes write" on takes for insert
  with check (exists (select 1 from elements el join episodes e on e.id = el.episode_id
                 where el.id = element_id and can_write_project(e.project_id)));
create policy "takes delete" on takes for delete
  using (exists (select 1 from elements el join episodes e on e.id = el.episode_id
                 where el.id = element_id and can_write_project(e.project_id)));

create policy "jobs read" on jobs for select
  using (exists (select 1 from episodes e where e.id = episode_id and can_read_project(e.project_id)));
create policy "jobs write" on jobs for insert
  with check (exists (select 1 from episodes e where e.id = episode_id and can_write_project(e.project_id)));
create policy "jobs update" on jobs for update
  using (exists (select 1 from episodes e where e.id = episode_id and can_write_project(e.project_id)));

-- Storage. Anyone sharing a team with the uploader can read and write the audio.
drop policy if exists "own audio read" on storage.objects;
drop policy if exists "own audio write" on storage.objects;
drop policy if exists "own audio update" on storage.objects;
drop policy if exists "own audio delete" on storage.objects;

create policy "team audio read" on storage.objects for select
  using (bucket_id = 'audio' and shares_team_with(((storage.foldername(name))[1])::uuid));
create policy "team audio write" on storage.objects for insert
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "team audio update" on storage.objects for update
  using (bucket_id = 'audio' and shares_team_with(((storage.foldername(name))[1])::uuid));
create policy "team audio delete" on storage.objects for delete
  using (bucket_id = 'audio' and shares_team_with(((storage.foldername(name))[1])::uuid));
