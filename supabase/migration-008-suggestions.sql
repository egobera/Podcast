-- Estudio migration 008. Remembering dismissed suggestions.
-- Pattern detection proposes; it never changes anything by itself. Once a proposal is
-- turned down it should stay turned down, or the app nags on every read.
-- Safe to run more than once.

alter table projects add column if not exists dismissed_patterns jsonb not null default '[]'::jsonb;
