-- Estudio migration 009. The vault fills itself from the scripts.
--
-- Reading a script already tells us which sounds an episode needs. Anything that repeats,
-- or that another episode of the series already needed, becomes a vault entry on the spot
-- instead of waiting for someone to add it by hand. Entries created this way are flagged,
-- so they can be told apart from the ones a person made deliberately.
--
-- match_key is the normalized wording, which is how a cue in episode four is recognised as
-- the same doorbell that episode one already had.
-- Safe to run more than once.

alter table series_assets add column if not exists auto boolean not null default false;
alter table series_assets add column if not exists match_key text;
alter table series_assets add column if not exists uses integer not null default 0;

create unique index if not exists idx_assets_match
  on series_assets(project_id, match_key)
  where match_key is not null;
