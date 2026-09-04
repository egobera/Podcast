-- Estudio migration 013. Direction on a line.
--
-- A script says "(en off, muy despacio)" or "(la voz quebrándose)". Until now that was
-- stripped out and thrown away, so every line was read flat. Keeping it lets the model be
-- told how to say the words, not just which words to say.
-- Safe to run more than once.

alter table elements add column if not exists direction text default '';
