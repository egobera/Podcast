import { supabase } from './supabase'
import { IDX_TEMPLATE_OPEN, IDX_TEMPLATE_CLOSE } from './parser'
import type { AudioElement, SeriesAsset, SeriesBlock } from './types'

/**
 * The episode template.
 *
 * Vault assets marked to auto place are dropped into every new episode the moment it is
 * created, already approved, because the audio exists. A new episode is never empty.
 */
/** Vault assets the episode is missing, so an episode made before the vault was filled
 *  can still get its themes without being recreated. */
export async function missingTemplateAssets(episodeId: string, projectId: string) {
  const [{ data: assets }, { data: present }] = await Promise.all([
    supabase.from('series_assets').select('id, name, auto_place, storage_path')
      .eq('project_id', projectId).in('auto_place', ['open', 'close']),
    supabase.from('elements').select('series_asset_id').eq('episode_id', episodeId),
  ])
  const already = new Set((present ?? []).map(e => e.series_asset_id).filter(Boolean))
  return (assets ?? []).filter(a => a.storage_path && !already.has(a.id))
}

export async function applyTemplate(episodeId: string, projectId: string) {
  const { data: assets } = await supabase
    .from('series_assets')
    .select('*')
    .eq('project_id', projectId)
    .in('auto_place', ['open', 'close'])

  const placeable = (assets ?? []).filter(a => a.storage_path) as SeriesAsset[]
  if (placeable.length === 0) return 0

  const rows = placeable.map(a => ({
    episode_id: episodeId,
    idx: a.auto_place === 'open' ? IDX_TEMPLATE_OPEN : IDX_TEMPLATE_CLOSE,
    scene: a.auto_place === 'open' ? 'Opening' : 'Closing',
    kind: 'music' as const,
    series_asset_id: a.id,
    text_content: a.name,
    origin: 'template' as const,
    anchor: 'line' as const,
    gain_role: 'theme' as const,
    duration_ms: a.duration_ms ?? 15000,
    status: 'approved' as const,
  }))

  await supabase.from('elements').insert(rows)
  return rows.length
}

/**
 * Wraps one element in a block the series has defined.
 *
 * The entry and the return take real time, so they push the timeline. The repeats do not:
 * they are positioned at layout time, spread across the speech they cover, which is why
 * their spacing follows the actor rather than a clock.
 */
export async function insertBlock(
  episodeId: string,
  block: SeriesBlock,
  assets: SeriesAsset[],
  from: AudioElement,
  to: AudioElement = from,
  auto = false,
) {
  const find = (id: string | null) => assets.find(a => a.id === id && a.storage_path) ?? null
  const entry = find(block.entry_asset_id)
  const repeat = find(block.repeat_asset_id)
  const ret = find(block.return_asset_id)

  if (!entry && !repeat && !ret) {
    throw new Error(`${block.name} has no audio assigned yet. Set it up in the vault.`)
  }

  const blockId = crypto.randomUUID()
  const rows: Record<string, unknown>[] = []

  if (entry) {
    rows.push({
      episode_id: episodeId, idx: from.idx - 10, scene: from.scene, kind: 'music', auto,
      series_asset_id: entry.id, text_content: `${block.name}, opens`, origin: 'block',
      block_id: blockId, block_role: 'entry', block_seq: 0,
      anchor: 'line', gain_role: 'impact', duration_ms: entry.duration_ms ?? 3000,
      status: 'approved',
    })
  }

  if (repeat) {
    for (let i = 0; i < block.repeat_count; i++) {
      rows.push({
        episode_id: episodeId, idx: from.idx + 1 + i, scene: from.scene, kind: 'music', auto,
        series_asset_id: repeat.id, text_content: `${block.name}, ${i + 1}`, origin: 'block',
        block_id: blockId, block_role: 'pulse', block_seq: i,
        anchor: 'scene', gain_role: 'bed', duration_ms: repeat.duration_ms ?? 600,
        status: 'approved',
      })
    }
  }

  if (ret) {
    rows.push({
      episode_id: episodeId, idx: to.idx + 90, scene: to.scene, kind: 'music', auto,
      series_asset_id: ret.id, text_content: `${block.name}, closes`, origin: 'block',
      block_id: blockId, block_role: 'return', block_seq: block.repeat_count,
      anchor: 'line', gain_role: 'impact', duration_ms: ret.duration_ms ?? 1000,
      status: 'approved',
    })
  }

  await supabase.from('elements').insert(rows)
  return blockId
}

export async function removeBlock(blockId: string) {
  await supabase.from('elements').delete().eq('block_id', blockId)
}

/** Drops any vault asset into the episode under the selected line. */
export async function insertVaultAsset(
  episodeId: string,
  asset: SeriesAsset,
  after: AudioElement,
  anchor: 'line' | 'scene',
) {
  await supabase.from('elements').insert({
    episode_id: episodeId,
    idx: after.idx + 50,
    scene: after.scene,
    kind: asset.kind === 'bed' ? 'music' : asset.kind.startsWith('sfx') ? 'sfx' : 'music',
    series_asset_id: asset.id,
    text_content: asset.name,
    origin: 'block',
    anchor,
    gain_role: asset.kind === 'bed' ? 'bed' : 'spot',
    duration_ms: asset.duration_ms ?? 3000,
    status: 'approved',
  })
}

/**
 * Finds where a block should go without a marker, by matching the stage directions the
 * script already contains. Used for scripts written before markers existed.
 */
export function findCueSpans(
  block: SeriesBlock,
  elements: { id: string; idx: number; kind: string; text_content: string }[],
): { fromIdx: number; toIdx: number }[] {
  const open = block.trigger_cue?.trim().toLowerCase()
  const close = block.end_cue?.trim().toLowerCase()
  if (!open) return []

  const cues = elements
    .filter(e => e.kind !== 'dialogue')
    .sort((a, b) => a.idx - b.idx)

  const spans: { fromIdx: number; toIdx: number }[] = []
  for (let i = 0; i < cues.length; i++) {
    if (!cues[i].text_content.toLowerCase().includes(open)) continue
    if (!close) { spans.push({ fromIdx: cues[i].idx, toIdx: cues[i].idx }); continue }
    const end = cues.slice(i + 1).find(c => c.text_content.toLowerCase().includes(close))
    if (end) { spans.push({ fromIdx: cues[i].idx, toIdx: end.idx }); i = cues.indexOf(end) }
  }
  return spans
}
