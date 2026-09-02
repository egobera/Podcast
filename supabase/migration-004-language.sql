-- Estudio migration 004. Language and accent.
-- ElevenLabs takes an ISO 639-1 language code ("es"), not a regional one. Regional variety
-- comes from the voice's accent and from the words in the script, so we store both:
-- the code we send to the model, and the accent label that guides voice choice.

alter table projects add column if not exists language_code text not null default 'es';
alter table projects add column if not exists accent text not null default 'Latin American';

alter table characters add column if not exists accent text;
alter table characters add column if not exists sample_language text;

-- Carry over anything already set, e.g. 'es-MX' becomes code 'es' with a Mexican accent.
update projects
set language_code = split_part(language, '-', 1)
where language like '%-%' and language_code = 'es';

update projects set accent = 'Mexican' where language = 'es-MX' and accent = 'Latin American';
update projects set accent = 'Castilian' where language = 'es-ES' and accent = 'Latin American';
