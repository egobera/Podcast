-- Estudio migration 021. Silences that were filed as sounds.
--
-- Cues that state their own length, like "Silencio. 1 segundo.", slipped past the timing
-- check because of the digit, so they were imported as sound effects and then proposed as
-- vault entries. The parser and the detector are fixed; this repairs what is already in
-- the database.
--
-- Safe to run more than once.

update elements
set kind = 'pause',
    status = 'approved',
    gain_role = 'auto',
    series_asset_id = null
where kind <> 'pause'
  and kind <> 'dialogue'
  and (text_content ilike 'silencio%' or text_content ilike 'pausa%');

-- And any vault entry that was created from one.
delete from series_assets
where auto = true
  and storage_path is null
  and (name ilike 'silencio%' or name ilike 'pausa%');
