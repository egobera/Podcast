-- Estudio migration 006. The vault stops being a fixed list.
--
-- The old vault hardcoded slots that only made sense for one show: an opening theme, a
-- closing theme, and three files for a "freeze". Another series needs a flashback, a
-- scene change, a station ident. So the vault becomes a free list the project defines,
-- and repeated structures become blocks the project defines too.
-- Safe to run more than once.

alter table series_assets add column if not exists description text default '';
alter table series_assets add column if not exists sort integer default 0;
alter table series_assets alter column kind set default 'sfx';

alter table characters add column if not exists description text default '';

-- A block is a shape that repeats: something that opens, something that repeats
-- underneath for as long as the moment lasts, and something that closes it.
create table if not exists series_blocks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  description text default '',
  entry_asset_id uuid references series_assets(id) on delete set null,
  repeat_asset_id uuid references series_assets(id) on delete set null,
  return_asset_id uuid references series_assets(id) on delete set null,
  repeat_count integer not null default 10,
  created_at timestamptz not null default now()
);

create index if not exists idx_blocks_project on series_blocks(project_id);

alter table series_blocks enable row level security;

drop policy if exists "blocks read" on series_blocks;
create policy "blocks read" on series_blocks for select to authenticated
  using (can_read_project(project_id));
drop policy if exists "blocks write" on series_blocks;
create policy "blocks write" on series_blocks for insert to authenticated
  with check (can_write_project(project_id));
drop policy if exists "blocks update" on series_blocks;
create policy "blocks update" on series_blocks for update to authenticated
  using (can_write_project(project_id));
drop policy if exists "blocks delete" on series_blocks;
create policy "blocks delete" on series_blocks for delete to authenticated
  using (can_write_project(project_id));

-- Anything already in the vault keeps working. Freeze files, if present, become a block.
do $$
declare
  p record;
  a_in uuid; a_pulse uuid; a_out uuid;
begin
  for p in select id from projects loop
    select id into a_in from series_assets where project_id = p.id and kind = 'freeze_in' limit 1;
    select id into a_pulse from series_assets where project_id = p.id and kind = 'freeze_pulse' limit 1;
    select id into a_out from series_assets where project_id = p.id and kind = 'freeze_out' limit 1;

    if a_in is not null and not exists (select 1 from series_blocks where project_id = p.id) then
      insert into series_blocks (project_id, name, description,
                                 entry_asset_id, repeat_asset_id, return_asset_id, repeat_count)
      values (p.id, 'Freeze',
              'Wraps a line in a moment where time stops.',
              a_in, a_pulse, a_out, 10);
    end if;
  end loop;
end $$;
