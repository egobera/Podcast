import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { detectRepeats, detectPairs, cueKeyword, type CueLike } from '../lib/detect'
import { useToast } from './ui'
import { Plus, Close } from './icons'
import type { AudioElement, Project, SeriesAsset } from '../lib/types'
import { addAllCues, countUnlinked } from '../lib/autofill'

/**
 * Proposes, never acts.
 *
 * Two layers. Inside one episode we look for what repeats enough to be worth keeping, and
 * for stage directions that come in pairs. Across the series we look for what shows up in
 * several episodes, which is the stronger signal even when no single script repeats it.
 */
export default function Suggestions({
  project, elements, scope, onApplied, fullElements, assets,
}: {
  project: Project
  elements: CueLike[]
  scope: 'episode' | 'series'
  onApplied: () => void
  /** Only for the episode layer: the real elements, so the rest can be added in one go. */
  fullElements?: AudioElement[]
  assets?: SeriesAsset[]
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [hidden, setHidden] = useState<string[]>([])
  const toast = useToast()

  const dismissed = useMemo(
    () => new Set([...(project.dismissed_patterns ?? []), ...hidden]),
    [project.dismissed_patterns, hidden],
  )

  const repeats = useMemo(
    () => detectRepeats(elements, scope === 'series'
      ? { minCount: 4, minEpisodes: 2 }
      : { minCount: 3 })
      .filter(r => !dismissed.has(`sound:${r.key}`))
      .slice(0, 6),
    [elements, scope, dismissed],
  )

  const pairs = useMemo(
    () => detectPairs(elements, scope === 'series' ? { minOccurrences: 3 } : { minOccurrences: 2 })
      .filter(p => !dismissed.has(`block:${p.key}`))
      .slice(0, 3),
    [elements, scope, dismissed],
  )

  const unlinked = fullElements && assets ? countUnlinked(fullElements, assets) : 0

  if (repeats.length === 0 && pairs.length === 0 && unlinked === 0) return null

  async function dismiss(key: string) {
    setHidden(h => [...h, key])
    const next = [...new Set([...(project.dismissed_patterns ?? []), key])]
    await supabase.from('projects').update({ dismissed_patterns: next }).eq('id', project.id)
  }

  async function makeAsset(label: string, key: string, count: number, episodes: number) {
    setBusy(key)
    const { error } = await supabase.from('series_assets').insert({
      project_id: project.id,
      name: label.replace(/[.!?]+$/, '').slice(0, 48),
      kind: 'sfx',
      auto_place: 'none',
      description: episodes > 1
        ? `Appears in ${episodes} episodes`
        : `Appears ${count} times in this episode`,
    })
    setBusy(null)
    if (error) { toast(error.message, 'bad'); return }
    setHidden(h => [...h, `sound:${key}`])
    onApplied()
    toast('Added to the vault. Upload the audio once and every episode can use it.')
  }

  async function makeBlock(openLabel: string, closeLabel: string, key: string) {
    setBusy(key)
    const name = openLabel.split(/[.,]/)[0].trim().slice(0, 28) || 'Block'
    const { error } = await supabase.from('series_blocks').insert({
      project_id: project.id,
      name,
      description: `Detected between "${openLabel}" and "${closeLabel}"`,
      trigger_marker: name,
      trigger_cue: cueKeyword(openLabel),
      end_cue: cueKeyword(closeLabel),
      repeat_count: 10,
    })
    setBusy(null)
    if (error) { toast(error.message, 'bad'); return }
    setHidden(h => [...h, `block:${key}`])
    onApplied()
    toast(`${name} created. Give it audio in the vault and it will place itself from now on.`)
  }

  return (
    <section className="suggestions">
      <span className="ip-label">
        {scope === 'series' ? 'Patterns across the series' : 'Noticed in this episode'}
      </span>

      {pairs.map(p => (
        <div className="sugg" key={p.key}>
          <div className="sugg-main">
            <span className="sugg-title">
              Something opens and closes {p.occurrences} times
            </span>
            <span className="sugg-body">
              “{p.openLabel}” … {p.averageSpan} elements later … “{p.closeLabel}”.
              That shape is a block: it can wrap a line and place itself every time you read a script.
            </span>
          </div>
          <button className="btn" data-variant="primary" disabled={busy === p.key}
            onClick={() => makeBlock(p.openLabel, p.closeLabel, p.key)}>
            <Plus size={13} /> Make a block
          </button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(`block:${p.key}`)}>
            <Close size={13} />
          </button>
        </div>
      ))}

      {unlinked > 0 && fullElements && (
        <div className="sugg">
          <div className="sugg-main">
            <span className="sugg-title">
              {unlinked} more sounds this episode needs
            </span>
            <span className="sugg-body">
              They appear once each, so they were not added on their own. Put them in the vault and
              any later episode that asks for the same thing gets them for free.
            </span>
          </div>
          <button className="btn" disabled={busy === 'all'}
            onClick={async () => {
              setBusy('all')
              const n = await addAllCues(project.id, fullElements)
              setBusy(null)
              onApplied()
              toast(`${n} sounds added to the vault.`)
            }}>
            <Plus size={13} /> Add them all
          </button>
        </div>
      )}

      {repeats.map(r => (
        <div className="sugg" key={r.key}>
          <div className="sugg-main">
            <span className="sugg-title">{r.label}</span>
            <span className="sugg-body">
              {r.episodes > 1
                ? `Appears in ${r.episodes} episodes, ${r.count} times in total.`
                : `Appears ${r.count} times in this episode.`}
              {' '}Put it in the vault and you only make the audio once.
            </span>
          </div>
          <button className="btn" disabled={busy === r.key}
            onClick={() => makeAsset(r.label, r.key, r.count, r.episodes)}>
            <Plus size={13} /> To the vault
          </button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(`sound:${r.key}`)}>
            <Close size={13} />
          </button>
        </div>
      ))}
    </section>
  )
}
