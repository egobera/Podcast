-- Estudio migration 016. The voice design prompt gets its own home.
--
-- Saving a designed voice was writing its English description over the character's own
-- description, the one taken from the cast list. So a narrator described as "cálida,
-- cercana, ritmo tranquilo" ended up described as "warm, slow and deliberate, middle
-- aged, female", and every line inherited that instead.
--
-- The two are different things and now live in different columns.
-- Safe to run more than once.

alter table characters add column if not exists voice_prompt text default '';
