-- Estudio migration 007. Blocks that insert themselves.
--
-- A block can now declare what makes it appear: a marker written in the script, or a stage
-- direction that already exists in it. Blocks inserted that way are marked as automatic, so
-- re-reading a script can rebuild them without touching the ones a person placed by hand.
-- Safe to run more than once.

alter table series_blocks add column if not exists trigger_marker text default '';
alter table series_blocks add column if not exists trigger_cue text default '';
alter table series_blocks add column if not exists end_cue text default '';

alter table elements add column if not exists auto boolean not null default false;

create index if not exists idx_elements_auto on elements(episode_id, origin, auto);

-- A freeze carried over from migration 006 gets its marker filled in.
update series_blocks
set trigger_marker = name
where coalesce(trigger_marker, '') = '';
