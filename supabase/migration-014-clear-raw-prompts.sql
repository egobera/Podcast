-- Estudio migration 014. Clearing prompts that were never prompts.
--
-- Earlier versions saved the Spanish stage direction into the prompt field, and a stored
-- prompt takes priority over the built one. The result was a voice reading "la silla se
-- tambalea" out loud instead of a chair creaking.
--
-- Anything that does not carry the builder's signature is cleared, so the app rebuilds it.
-- A prompt written by hand in English keeps working as long as it says no voice.
-- Safe to run more than once.

update elements
set prompt = ''
where kind <> 'dialogue'
  and coalesce(prompt, '') <> ''
  and prompt not ilike '%no voice, no narration%';

update series_assets
set description = ''
where coalesce(description, '') <> ''
  and description not ilike '%no voice, no narration%'
  and description not ilike '%plays at the%'
  and description not ilike '%loops under%';
