/**
 * Pattern detection, in two layers.
 *
 * Within one episode: what repeats often enough to be worth putting in the vault, and
 * which stage directions come in pairs, because a pair with dialogue between it is the
 * shape of a block.
 *
 * Across the series: something that appears once per episode across many episodes is
 * clearly recurring even though no single script repeats it.
 *
 * Everything here only ever proposes. A false positive that quietly rewrote the vault
 * would cost far more than typing a marker by hand.
 */

export interface CueLike {
  id: string
  idx: number
  kind: string
  text_content: string
  episode_id?: string
}

export interface RepeatSuggestion {
  key: string
  label: string
  count: number
  episodes: number
  elementIds: string[]
}

export interface PairSuggestion {
  key: string
  openLabel: string
  closeLabel: string
  openKey: string
  closeKey: string
  occurrences: number
  averageSpan: number
}

/** Collapses wording differences so "Timbre." and "(timbre de casa)" land together. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 5)
    .join(' ')
}

/**
 * Timing directions are not sounds. "Pausa." and "Silencio largo." tell the actor how long
 * to wait; they should never end up proposed as vault audio. A cue made only of these words
 * is dropped, but one that merely contains them is kept, so "CHASQUIDO. SILENCIO TOTAL."
 * still counts.
 */
const TIMING_WORDS = new Set([
  'pausa', 'silencio', 'largo', 'corto', 'breve', 'beat', 'espera', 'segundos', 'segundo',
  'pause', 'silence', 'long', 'short', 'de', 'un', 'una', 'dos', 'tres', 'y', 'muy',
])

export function isTimingOnly(text: string): boolean {
  const words = normalize(text).split(' ').filter(Boolean)
  return words.length > 0 && words.every(w => TIMING_WORDS.has(w))
}

function cuesOf(elements: CueLike[]): CueLike[] {
  return elements
    .filter(e => e.kind !== 'dialogue'
      && e.text_content.trim().length > 2
      && !isTimingOnly(e.text_content))
    .sort((a, b) => a.idx - b.idx)
}

/**
 * Sounds worth promoting to the vault.
 * In one episode we ask for three appearances. Across the series, two episodes is enough,
 * because once per episode is the strongest signal of all.
 */
export function detectRepeats(
  elements: CueLike[],
  { minCount = 3, minEpisodes = 1 }: { minCount?: number; minEpisodes?: number } = {},
): RepeatSuggestion[] {
  const groups = new Map<string, { label: string; ids: string[]; episodes: Set<string> }>()

  for (const cue of cuesOf(elements)) {
    const key = normalize(cue.text_content)
    if (!key) continue
    if (!groups.has(key)) {
      groups.set(key, { label: cue.text_content.trim(), ids: [], episodes: new Set() })
    }
    const g = groups.get(key)!
    g.ids.push(cue.id)
    if (cue.episode_id) g.episodes.add(cue.episode_id)
  }

  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: g.label.length > 64 ? `${g.label.slice(0, 61)}…` : g.label,
      count: g.ids.length,
      episodes: g.episodes.size,
      elementIds: g.ids,
    }))
    .filter(s => s.count >= minCount || s.episodes >= Math.max(minEpisodes, 2))
    .sort((a, b) => b.episodes - a.episodes || b.count - a.count)
}

/**
 * Stage directions that come in pairs.
 *
 * A cue that repeats, and is reliably followed a few lines later by another cue, with
 * dialogue in between, is a block: something opens, something happens, something closes.
 */
export function detectPairs(
  elements: CueLike[],
  { maxGap = 14, minOccurrences = 2 }: { maxGap?: number; minOccurrences?: number } = {},
): PairSuggestion[] {
  const ordered = elements.slice().sort((a, b) => a.idx - b.idx)
  const cues = cuesOf(ordered)
  if (cues.length < 4) return []

  const positionOf = new Map(ordered.map((e, i) => [e.id, i]))
  const pairs = new Map<string, { open: string; close: string; spans: number[] }>()

  for (let i = 0; i < cues.length; i++) {
    const openKey = normalize(cues[i].text_content)
    const openPos = positionOf.get(cues[i].id)!

    for (let j = i + 1; j < cues.length; j++) {
      const closePos = positionOf.get(cues[j].id)!
      const span = closePos - openPos
      if (span > maxGap) break

      const closeKey = normalize(cues[j].text_content)
      if (closeKey === openKey) break        // the same cue again is not a closing one
      if (span < 2) continue                 // needs something between them

      const id = `${openKey}→${closeKey}`
      if (!pairs.has(id)) {
        pairs.set(id, { open: cues[i].text_content.trim(), close: cues[j].text_content.trim(), spans: [] })
      }
      pairs.get(id)!.spans.push(span)
      break                                   // only the nearest closing cue counts
    }
  }

  const ranked = [...pairs.entries()]
    .filter(([, p]) => p.spans.length >= minOccurrences)
    .map(([id, p]) => {
      const [openKey, closeKey] = id.split('→')
      return {
        key: id,
        openLabel: p.open.length > 48 ? `${p.open.slice(0, 45)}…` : p.open,
        closeLabel: p.close.length > 48 ? `${p.close.slice(0, 45)}…` : p.close,
        openKey,
        closeKey,
        occurrences: p.spans.length,
        averageSpan: Math.round(p.spans.reduce((a, b) => a + b, 0) / p.spans.length),
      }
    })
    .sort((a, b) => b.occurrences - a.occurrences || b.averageSpan - a.averageSpan)

  /*
   * A cue belongs to one block. Walking the ranked list and claiming cues as we go
   * removes two kinds of false positive at once:
   *
   *   the subset       CHASQUIDO → GOLPE and TIC → GOLPE are the same block
   *   the wrap around  the GOLPE that closes one freeze pairing with the CHASQUIDO
   *                    that opens the next one
   */
  const claimed = new Set<string>()
  return ranked.filter(p => {
    if (claimed.has(p.openKey) || claimed.has(p.closeKey)) return false
    claimed.add(p.openKey)
    claimed.add(p.closeKey)
    return true
  })
}

/** The words a block should look for, taken from the first distinctive part of a cue. */
export function cueKeyword(text: string): string {
  const words = normalize(text).split(' ').filter(w => w.length > 3)
  return words.slice(0, 2).join(' ') || normalize(text)
}

/**
 * How many sounds an episode needs that the vault does not know about yet.
 * Pauses are not sounds, so they never count.
 */
export function countUnlinked(
  episodeElements: { kind: string; text_content: string; series_asset_id?: string | null }[],
  assets: { name: string; match_key?: string | null }[],
): number {
  const known = new Set(assets.map(a => a.match_key ?? normalize(a.name)))
  const keys = new Set<string>()
  for (const cue of episodeElements) {
    if (cue.kind === 'dialogue' || cue.kind === 'pause' || cue.series_asset_id) continue
    const key = normalize(cue.text_content)
    if (!key || known.has(key) || isTimingOnly(cue.text_content)) continue
    keys.add(key)
  }
  return keys.size
}
