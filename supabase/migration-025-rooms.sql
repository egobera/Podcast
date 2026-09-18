-- Canon migration 025. The room everything is standing in.
--
-- Every voice arrives dry, centred and at the same distance, which is the clearest tell
-- that audio was assembled rather than recorded. A real recording happens somewhere, and
-- that somewhere is audible in every source at once.
--
-- The room is per scene, because a scene is a place. Distance is per element, because two
-- people in the same room are not the same distance from the microphone.
-- Safe to run more than once.

alter table episodes add column if not exists scene_rooms jsonb not null default '{}'::jsonb;
alter table elements add column if not exists distance text not null default 'normal';

-- The glue over the whole episode, and how much the timing is allowed to wobble.
alter table projects add column if not exists glue boolean not null default true;
alter table projects add column if not exists humanise numeric not null default 0.14;
