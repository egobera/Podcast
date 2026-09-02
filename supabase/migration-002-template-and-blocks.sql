-- Estudio migration 002. Run after schema.sql, once, in the Supabase SQL editor.
-- Adds the episode template and the freeze block.

alter table elements add column if not exists origin text not null default 'script';
-- script   : came from parsing the script, replaced on every re-read
-- template : placed automatically from the vault, survives re-reads
-- block    : part of an inserted block such as a freeze, survives re-reads

alter table elements add column if not exists block_id uuid;
alter table elements add column if not exists block_role text;   -- entry | pulse | return
alter table elements add column if not exists block_seq integer default 0;
alter table elements add column if not exists locked_start boolean not null default false;

create index if not exists idx_elements_block on elements(block_id, block_seq);

-- Episode length targets. Eight minute episodes by default.
alter table episodes alter column target_min_ms set default 420000;
alter table episodes alter column target_max_ms set default 540000;

-- Where a vault asset should be placed automatically in every new episode.
alter table series_assets add column if not exists pulse_count integer default 10;
