-- Estudio migration 019. Getting more out of the voice model.
--
-- speed and seed are per character: speed because a narrator and an eight year old do not
-- talk at the same rate, seed because a fixed one makes a regeneration comparable to the
-- last instead of a fresh roll of the dice.
--
-- prompt_influence is per project: how literally the sound generator follows the words,
-- which is the difference between a doorbell and something doorbell-ish.
-- Safe to run more than once.

alter table characters add column if not exists speed numeric not null default 1.0;
alter table characters add column if not exists seed integer;
alter table characters add column if not exists model text not null default 'eleven_v3';

alter table projects add column if not exists prompt_influence numeric not null default 0.4;
alter table projects add column if not exists context_lines boolean not null default true;
