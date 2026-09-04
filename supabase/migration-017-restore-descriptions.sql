-- Estudio migration 017. Putting the English descriptions back where they belong.
--
-- Characters whose description was overwritten by a voice design prompt end up inheriting
-- an English sentence as their tone. The prompt moves to its own column and the
-- description is cleared, so "Fill from the scripts" can put the real one back.
--
-- A description is treated as a stray prompt when it reads like one: written in English
-- with the trait words the designer produces.
-- Safe to run more than once.

update characters
set voice_prompt = description,
    description = ''
where coalesce(voice_prompt, '') = ''
  and description ~* '(middle aged|elderly|young adult|androgynous|slow and deliberate|high pitched|raspy|gravelly|breathy)'
  and description ~* '(accent|female|male)';
