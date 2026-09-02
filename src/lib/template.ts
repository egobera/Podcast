import { supabase } from './supabase'
import { IDX_TEMPLATE_OPEN, IDX_TEMPLATE_CLOSE } from './parser'
import type { AudioElement, SeriesAsset } from './types'

/**
 * The episode template.
 *
 * Vault assets marked to auto place are dropped into every new episode the moment it is
 * created, already approved, because the audio exists. A new episode is never empty.
 */
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
 * Wraps one element in a freeze.
 *
 * Creates the entry before it, the return after it, and the pulses that sit underneath.
 * The pulses carry no duration of their own: they are positioned at layout time, spread
 * across the speech they cover, so their spacing follows the actor rather than a clock.
 */
export async function insertFreeze(
  episodeId: string,
  projectId: string,
  around: AudioElement,
  pulseCount = 10,
) {
  const { data: assets } = await supabase
    .from('series_assets')
    .select('*')
    .eq('project_id', projectId)
    .in('kind', ['freeze_in', 'freeze_pulse', 'freeze_out'])

  const byKind = new Map((assets ?? []).map(a => [a.kind, a as SeriesAsset]))
  const entry = byKind.get('freeze_in')
  const pulse = byKind.get('freeze_pulse')
  const ret = byKind.get('freeze_out')

  if (!entry?.storage_path || !pulse?.storage_path || !ret?.storage_path) {
    throw new Error(
      'The freeze needs its three master files in the vault first: entry, pulse and return.',
    )
  }

  const blockId = crypto.randomUUID()
  const base = around.idx

  const rows: Record<string, unknown>[] = [
    {
      episode_id: episodeId, idx: base - 10, scene: around.scene, kind: 'music',
      series_asset_id: entry.id, text_content: 'Freeze, entry', origin: 'block',
      block_id: blockId, block_role: 'entry', block_seq: 0,
      anchor: 'line', gain_role: 'impact', duration_ms: entry.duration_ms ?? 4000,
      status: 'approved',
    },
  ]

  for (let i = 0; i < pulseCount; i++) {
    rows.push({
      episode_id: episodeId, idx: base + 1 + i, scene: around.scene, kind: 'music',
      series_asset_id: pulse.id, text_content: `Freeze, pulse ${i + 1}`, origin: 'block',
      block_id: blockId, block_role: 'pulse', block_seq: i,
      anchor: 'scene', gain_role: 'bed', duration_ms: pulse.duration_ms ?? 600,
      status: 'approved',
    })
  }

  rows.push({
    episode_id: episodeId, idx: base + 90, scene: around.scene, kind: 'music',
    series_asset_id: ret.id, text_content: 'Freeze, return', origin: 'block',
    block_id: blockId, block_role: 'return', block_seq: pulseCount,
    anchor: 'line', gain_role: 'impact', duration_ms: ret.duration_ms ?? 1000,
    status: 'approved',
  })

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
