-- Estudio migration 020. Fades you can see and drag.
--
-- Every clip already fades a few milliseconds so nothing clicks. These are the other kind:
-- a deliberate one or two seconds on a bed coming in under a line, or on a sound dying
-- away. Null means "use the short automatic one".
-- Safe to run more than once.

alter table elements add column if not exists fade_in_ms integer;
alter table elements add column if not exists fade_out_ms integer;
