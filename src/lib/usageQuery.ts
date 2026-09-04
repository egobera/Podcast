import { supabase } from './supabase'
import type { Usage } from './usage'

export async function loadUsage(projectId: string): Promise<Usage> {
  const { data: eps } = await supabase.from('episodes').select('id').eq('project_id', projectId)
  const episodeIds = (eps ?? []).map(e => e.id)

  const assets = new Map<string, number>()
  const characters = new Map<string, number>()
  if (episodeIds.length === 0) return { assets, characters, episodes: 0 }

  const { data: els } = await supabase.from('elements')
    .select('episode_id, series_asset_id, character_id')
    .in('episode_id', episodeIds)

  // A thing used twice in one episode is used by one episode, not two.
  const assetSeen = new Map<string, Set<string>>()
  const charSeen = new Map<string, Set<string>>()

  for (const row of els ?? []) {
    if (row.series_asset_id) {
      if (!assetSeen.has(row.series_asset_id)) assetSeen.set(row.series_asset_id, new Set())
      assetSeen.get(row.series_asset_id)!.add(row.episode_id)
    }
    if (row.character_id) {
      if (!charSeen.has(row.character_id)) charSeen.set(row.character_id, new Set())
      charSeen.get(row.character_id)!.add(row.episode_id)
    }
  }

  for (const [id, set] of assetSeen) assets.set(id, set.size)
  for (const [id, set] of charSeen) characters.set(id, set.size)

  return { assets, characters, episodes: episodeIds.length }
}
