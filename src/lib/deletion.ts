import { supabase } from './supabase'

/**
 * Deleting rows is easy; the audio is the part people forget.
 *
 * Postgres cascades take care of elements, takes and blocks, but the files themselves sit
 * in storage and would stay there forever, quietly costing money. So the paths are
 * collected first, while the rows that point at them still exist.
 */

async function removeFiles(paths: string[]) {
  const clean = paths.filter(Boolean)
  if (clean.length === 0) return
  // The API takes a limited number of keys at a time.
  for (let i = 0; i < clean.length; i += 90) {
    await supabase.storage.from('audio').remove(clean.slice(i, i + 90))
  }
}

export async function deleteEpisode(episodeId: string) {
  const { data: elements } = await supabase.from('elements')
    .select('id, series_asset_id').eq('episode_id', episodeId)

  const elementIds = (elements ?? []).map(e => e.id)

  // Only takes are removed. Vault assets belong to the series and other episodes use them.
  let paths: string[] = []
  if (elementIds.length) {
    for (let i = 0; i < elementIds.length; i += 200) {
      const { data: takes } = await supabase.from('takes')
        .select('storage_path').in('element_id', elementIds.slice(i, i + 200))
      paths = paths.concat((takes ?? []).map(t => t.storage_path))
    }
  }

  const { error } = await supabase.from('episodes').delete().eq('id', episodeId)
  if (error) throw error

  await removeFiles(paths)
  return paths.length
}

export async function deleteProject(projectId: string) {
  const { data: episodes } = await supabase.from('episodes')
    .select('id').eq('project_id', projectId)
  const episodeIds = (episodes ?? []).map(e => e.id)

  let paths: string[] = []

  if (episodeIds.length) {
    const { data: elements } = await supabase.from('elements')
      .select('id').in('episode_id', episodeIds)
    const elementIds = (elements ?? []).map(e => e.id)
    for (let i = 0; i < elementIds.length; i += 200) {
      const { data: takes } = await supabase.from('takes')
        .select('storage_path').in('element_id', elementIds.slice(i, i + 200))
      paths = paths.concat((takes ?? []).map(t => t.storage_path))
    }
  }

  const { data: assets } = await supabase.from('series_assets')
    .select('storage_path').eq('project_id', projectId)
  paths = paths.concat((assets ?? []).map(a => a.storage_path).filter(Boolean) as string[])

  const { error } = await supabase.from('projects').delete().eq('id', projectId)
  if (error) throw error

  await removeFiles(paths)
  return { episodes: episodeIds.length, files: paths.length }
}

/** What a delete is about to cost, so the warning can be specific instead of vague. */
export async function countEpisodeContents(episodeId: string) {
  const { count: elements } = await supabase.from('elements')
    .select('id', { count: 'exact', head: true }).eq('episode_id', episodeId)
  const { count: approved } = await supabase.from('elements')
    .select('id', { count: 'exact', head: true })
    .eq('episode_id', episodeId).eq('status', 'approved')
  return { elements: elements ?? 0, approved: approved ?? 0 }
}
