import { supabase } from './supabase'
import { normalize, isTimingOnly } from './detect'
import { expectedMsFrom } from './duration'
import { buildSoundPrompt, defaultLengthMs } from './soundprompt'
import type { AudioElement, SeriesAsset } from './types'

/**
 * Fills the vault from a script, and connects what is already in it.
 *
 * Two things happen every time a script is read:
 *
 *   1. Any sound the script asks for that the vault already has is linked straight to it.
 *      A doorbell made once in episode one is done for every episode after it.
 *   2. Anything new that repeats, inside this episode or across the series, is added to
 *      the vault as an empty entry, so it appears in the list waiting for audio instead of
 *      hiding inside one episode.
 *
 * Entries created here are flagged automatic. A person can rename, describe or delete them
 * and nothing will put them back.
 */

/** Cues too generic to be worth a vault entry of their own. */
const TOO_GENERIC = /^(pausa|silencio|sonido|ambiente|musica|music|beat)$/

export interface AutofillResult {
  linked: number
  created: number
}

export async function autofillVault(
  projectId: string,
  episodeElements: AudioElement[],
): Promise<AutofillResult> {
  const { data: existing } = await supabase.from('series_assets')
    .select('*').eq('project_id', projectId)
  const assets = (existing ?? []) as SeriesAsset[]

  const byKey = new Map<string, SeriesAsset>()
  for (const a of assets) {
    const key = a.match_key ?? normalize(a.name)
    if (key) byKey.set(key, a)
  }

  /*
   * A pause is not a sound, so it has no business in the vault. Leaving it in produced
   * entries called "Silencio. 1 segundo" with a Generate button next to them.
   */
  const cues = episodeElements.filter(e =>
    e.kind !== 'dialogue' && e.kind !== 'pause'
    && !e.series_asset_id && e.text_content.trim().length > 2)

  // Group this episode's cues by their normalized wording.
  const groups = new Map<string, { label: string; elements: AudioElement[] }>()
  for (const cue of cues) {
    const key = normalize(cue.text_content)
    if (!key || TOO_GENERIC.test(key) || isTimingOnly(cue.text_content)) continue
    if (!groups.has(key)) groups.set(key, { label: cue.text_content.trim(), elements: [] })
    groups.get(key)!.elements.push(cue)
  }

  let created = 0
  let linked = 0
  let sort = assets.length

  for (const [key, group] of groups) {
    let asset = byKey.get(key)

    /*
     * A spot effect earns its place in the vault by repeating. Music and ambience do not
     * have to: a bed or a room is reusable by nature, and a theme that plays once in this
     * episode plays once in every episode. Requiring a repeat left them stranded inside a
     * single script, which is exactly where series audio should never live.
     */
    const alwaysVault = group.elements.some(e => e.kind === 'music' || e.kind === 'ambience')

    if (!asset && (alwaysVault || group.elements.length >= 2)) {
      const first = group.elements[0]
      const kind = first.kind === 'music' ? 'bed' : first.kind === 'ambience' ? 'ambience' : 'sfx'

      const { data } = await supabase.from('series_assets').insert({
        project_id: projectId,
        // "MÚSICA · Cama de juego" is a label plus a name. Only the name belongs here.
        // "MÚSICA · Cama de juego. Entra aquí y sale cuando..." is a label, a name and a
        // note to the editor. Only the name goes on the card.
        name: group.label
          .replace(/^(m[úu]sica|ambiente|sonido|efecto)\s*[·:-]\s*/i, '')
          .split(/\.\s/)[0]
          .replace(/[.!?]+$/, '')
          .trim()
          .slice(0, 48),
        kind,
        auto_place: 'none',
        auto: true,
        match_key: key,
        description: kind === 'sfx'
          ? buildSoundPrompt(group.label).prompt
          : 'From the script. Music and ambiences are uploaded, not generated.',
        expected_ms: expectedMsFrom(group.label) ?? defaultLengthMs(kind),
        sort: sort++,
      }).select().single()
      if (data) { asset = data as SeriesAsset; byKey.set(key, asset); created++ }
    }

    if (!asset) continue

    // Point the episode at the vault entry. If it already has audio, the work is done.
    const ids = group.elements.map(e => e.id)
    const ready = !!asset.storage_path
    await supabase.from('elements').update({
      series_asset_id: asset.id,
      ...(ready ? { status: 'approved', duration_ms: asset.duration_ms ?? 3000 } : {}),
    }).in('id', ids)

    // A later script may be the one that states the length.
    const expected = asset.expected_ms ?? expectedMsFrom(group.label)
    await supabase.from('series_assets')
      .update({ uses: (asset.uses ?? 0) + ids.length, expected_ms: expected })
      .eq('id', asset.id)

    linked += ids.length
  }

  return { linked, created }
}

/** The two entries practically every series has, created once so the vault is never empty. */
export async function seedVault(projectId: string) {
  const { count } = await supabase.from('series_assets')
    .select('id', { count: 'exact', head: true }).eq('project_id', projectId)
  if ((count ?? 0) > 0) return 0

  await supabase.from('series_assets').insert([
    {
      project_id: projectId, name: 'Opening theme', kind: 'theme_open',
      auto_place: 'open', auto: true, sort: 0,
      description: 'Plays at the start of every episode.',
    },
    {
      project_id: projectId, name: 'Closing theme', kind: 'theme_close',
      auto_place: 'close', auto: true, sort: 1,
      description: 'Plays at the end of every episode.',
    },
  ])
  return 2
}

/**
 * Everything the script asks for that is not in the vault yet, including the sounds that
 * appear only once. Offered as one action rather than done automatically: a single mention
 * is not evidence that something recurs, and a vault full of one-offs is a worse vault.
 */
export async function addAllCues(
  projectId: string,
  episodeElements: AudioElement[],
): Promise<number> {
  const { data: existing } = await supabase.from('series_assets')
    .select('id, name, match_key').eq('project_id', projectId)
  const known = new Set((existing ?? []).map(a => a.match_key ?? normalize(a.name)))

  const groups = new Map<string, { label: string; ids: string[] }>()
  for (const cue of episodeElements) {
    if (cue.kind === 'dialogue' || cue.kind === 'pause' || cue.series_asset_id) continue
    const key = normalize(cue.text_content)
    if (!key || known.has(key) || TOO_GENERIC.test(key) || isTimingOnly(cue.text_content)) continue
    if (!groups.has(key)) groups.set(key, { label: cue.text_content.trim(), ids: [] })
    groups.get(key)!.ids.push(cue.id)
  }
  if (groups.size === 0) return 0

  const rows = [...groups.entries()].map(([key, g], i) => ({
    project_id: projectId,
    name: g.label.replace(/[.!?]+$/, '').slice(0, 48),
    kind: 'sfx',
    auto_place: 'none',
    auto: true,
    match_key: key,
    description: buildSoundPrompt(g.label).prompt,
    expected_ms: expectedMsFrom(g.label) ?? defaultLengthMs('sfx'),
    uses: g.ids.length,
    sort: 100 + i,
  }))

  /*
   * Inserting the batch in one call meant a single duplicate key threw the whole thing
   * away, and the count returned was the number attempted rather than the number made.
   * So it reported success for work that never happened.
   */
  const { data: made, error } = await supabase.from('series_assets').insert(rows).select()
  if (error) throw new Error(error.message)

  for (const asset of (made ?? [])) {
    const group = groups.get(asset.match_key as string)
    if (group) {
      await supabase.from('elements').update({ series_asset_id: asset.id }).in('id', group.ids)
    }
  }
  return (made ?? []).length
}

export { countUnlinked } from './detect'
