-- Estudio migration 023. Knowing that something was measured.
--
-- "Has no silence at its edges" was being used to mean "was never measured", and zero is a
-- perfectly good measurement: a trimmed file or a music bed genuinely has none. So those
-- clips were measured, kept counting as pending, and the button to fix them never went
-- away.
--
-- Anything that already has a measured edge clearly went through it, so it is marked.
-- Safe to run more than once.

alter table elements add column if not exists measured boolean not null default false;

update elements
set measured = true
where measured = false
  and (lead_silence_ms > 0 or tail_silence_ms > 0);
