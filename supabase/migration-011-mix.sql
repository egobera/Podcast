-- Estudio migration 011. Mixing from the bottom panel.
-- A gain offset per element, and per lane for the whole episode, so levels can be set
-- where the audio is instead of in a settings screen somewhere else.
-- Safe to run more than once.

alter table elements add column if not exists gain_db numeric not null default 0;
alter table episodes add column if not exists lane_gain jsonb not null default '{}'::jsonb;
