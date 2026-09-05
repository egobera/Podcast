-- Estudio migration 018. Rhythm.
--
-- Lines were placed hard against each other, which is why an episode sounded like a list
-- of recordings rather than a conversation. Two people do not speak with no gap between
-- them, and the gap is not the same after a question as after a statement.
--
-- offset_ms nudges one element earlier or later, so a sound can land under the line before
-- it instead of waiting politely for it to finish.
-- Safe to run more than once.

alter table elements add column if not exists offset_ms integer not null default 0;
alter table elements add column if not exists lead_silence_ms integer not null default 0;
alter table elements add column if not exists tail_silence_ms integer not null default 0;

alter table episodes add column if not exists pacing jsonb not null default '{}'::jsonb;
