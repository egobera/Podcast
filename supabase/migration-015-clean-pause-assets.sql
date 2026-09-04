-- Estudio migration 015. Taking the silences back out of the vault.
--
-- Pauses were being treated as sounds when scripts were read, so entries called
-- "Silencio. 1 segundo" ended up in the vault with a Generate button next to them.
-- The parser no longer does that; this clears the ones already created.
--
-- Only automatic entries with no audio are touched, so nothing anybody made by hand or
-- uploaded is at risk. Safe to run more than once.

update elements
set series_asset_id = null
where series_asset_id in (
  select id from series_assets
  where auto = true
    and storage_path is null
    and (name ~* '^(silencio|pausa|beat|corte a silencio)\b')
);

delete from series_assets
where auto = true
  and storage_path is null
  and (name ~* '^(silencio|pausa|beat|corte a silencio)\b');

-- Any element that came from a pause cue becomes what it always was.
update elements
set kind = 'pause', status = 'approved', gain_role = 'auto'
where kind = 'sfx'
  and text_content ~* '^(silencio|pausa|corte a silencio)\b'
  and text_content !~* '\bde\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}';
