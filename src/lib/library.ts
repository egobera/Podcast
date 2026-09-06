import { supabase } from './supabase'
import type { Character, SeriesAsset } from './types'

/**
 * Things worth keeping when a series goes.
 *
 * Deleting a series deletes its audio, which is the right default: nobody wants to pay to
 * store episodes they threw away. But a theme that took twenty generations to get right,
 * or a narrator whose settings finally sit where you want them, are not part of one
 * series. They are part of your work.
 *
 * Saving is a button rather than a rule. Everything kept automatically becomes a drawer
 * nobody opens.
 */

/**
 * The audio is copied, not pointed at.
 *
 * A reference would die with the series that owns the file, which is exactly the thing
 * this is meant to prevent. Storage is cheap; losing a theme is not.
 */
export async function saveAssetToLibrary(
  teamId: string,
  userId: string,
  asset: SeriesAsset,
  projectName: string,
) {
  if (!asset.storage_path) throw new Error('There is no audio to keep yet.')

  const ext = asset.storage_path.split('.').pop() ?? 'mp3'
  const target = `${userId}/library/${Date.now()}-${asset.id}.${ext}`

  const { error: copyError } = await supabase.storage.from('audio')
    .copy(asset.storage_path, target)
  if (copyError) throw new Error(copyError.message)

  const { error } = await supabase.from('library_assets').insert({
    team_id: teamId,
    name: asset.name,
    kind: asset.kind,
    description: asset.description ?? '',
    storage_path: target,
    duration_ms: asset.duration_ms,
    expected_ms: asset.expected_ms,
    from_project: projectName,
    saved_by: userId,
  })
  if (error) throw new Error(error.message)
}

/** A voice needs no file: it lives in the provider's account, and a preset is enough. */
export async function saveVoiceToLibrary(
  teamId: string,
  userId: string,
  character: Character,
  projectName: string,
) {
  if (!character.voice_id) throw new Error('This character has no voice yet.')

  const { error } = await supabase.from('library_voices').insert({
    team_id: teamId,
    name: character.name,
    description: character.description ?? '',
    voice_prompt: character.voice_prompt ?? '',
    direction_notes: character.direction_notes ?? '',
    voice_id: character.voice_id,
    model: character.model,
    stability: character.stability,
    similarity: character.similarity,
    style: character.style,
    speed: character.speed ?? 1,
    seed: character.seed,
    accent: character.accent,
    source: character.source,
    from_project: projectName,
    saved_by: userId,
  })
  if (error) throw new Error(error.message)
}

/** Copies a kept sound into a series, file and all, so the two are independent. */
export async function useAssetInProject(
  projectId: string,
  userId: string,
  item: { id: string; name: string; kind: string; description: string; storage_path: string; duration_ms: number | null; expected_ms: number | null },
) {
  const ext = item.storage_path.split('.').pop() ?? 'mp3'
  const target = `${userId}/${projectId}/${Date.now()}-${item.id}.${ext}`

  const { error: copyError } = await supabase.storage.from('audio')
    .copy(item.storage_path, target)
  if (copyError) throw new Error(copyError.message)

  const { error } = await supabase.from('series_assets').insert({
    project_id: projectId,
    name: item.name,
    kind: item.kind,
    auto_place: 'none',
    description: item.description,
    storage_path: target,
    duration_ms: item.duration_ms,
    expected_ms: item.expected_ms,
    provider: 'library',
  })
  if (error) throw new Error(error.message)
}

/** A kept voice becomes a character, ready to speak. */
export async function useVoiceInProject(
  projectId: string,
  item: {
    name: string; description: string; voice_prompt: string; direction_notes: string
    voice_id: string; model: string; stability: number; similarity: number; style: number
    speed: number; seed: number | null; accent: string | null; source: string
  },
) {
  const { error } = await supabase.from('characters').insert({
    project_id: projectId,
    name: item.name,
    description: item.description,
    voice_prompt: item.voice_prompt,
    direction_notes: item.direction_notes,
    voice_id: item.voice_id,
    model: item.model,
    stability: item.stability,
    similarity: item.similarity,
    style: item.style,
    speed: item.speed,
    seed: item.seed,
    accent: item.accent,
    source: item.source,
  })
  if (error) throw new Error(error.message)
}
