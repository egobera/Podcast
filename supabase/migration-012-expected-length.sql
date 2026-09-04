-- Estudio migration 012. What the script expects a piece to last.
-- Scripts say things like "4 segundos" or "15 seg". Keeping that number next to the asset
-- lets the vault say when the audio you uploaded does not match what the episode asked for.
-- Safe to run more than once.

alter table series_assets add column if not exists expected_ms integer;
