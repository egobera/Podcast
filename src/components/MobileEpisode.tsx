import { useEffect, useRef, useState } from 'react'
import { formatMs } from '../lib/parser'
import { usePreview } from '../lib/usePreview'
import { tap } from '../lib/pwa'
import { Play, Pause, Check, Spinner } from './icons'
import type { AudioElement, Character, Comment, Episode, Take } from '../lib/types'

type Filter = 'review' | 'todo' | 'all' | 'done'

/**
 * The episode on a phone.
 *
 * Not the editor made narrow: a different job. Everything here is about hearing what came
 * back and deciding, one line at a time, with a thumb. Placing, trimming and mixing stay
 * on a machine with a pointer, because none of them can be done accurately without one.
 *
 * The default filter is Review rather than All, because the reason to open this on a phone
 * is that something is waiting.
 */
export default function MobileEpisode({
  episode, elements, characters, comments, busyId,
  onPlayElement, onApprove, onGenerate, onPlayAll, playingAll, position, total,
}: {
  episode: Episode
  elements: (AudioElement & { start_ms: number })[]
  characters: Character[]
  comments: Comment[]
  busyId: string | null
  onPlayElement: (el: AudioElement) => void
  onApprove: (el: AudioElement) => Promise<void>
  onGenerate: (el: AudioElement) => void
  onPlayAll: () => void
  playingAll: boolean
  position: number
  total: number
}) {
  const [filter, setFilter] = useState<Filter>('review')
  const [open, setOpen] = useState<string | null>(null)
  const preview = usePreview()
  const listRef = useRef<HTMLDivElement>(null)

  const visible = elements.filter(e => {
    if (e.block_role === 'pulse') return false
    if (filter === 'all') return true
    if (filter === 'todo') return e.status === 'missing' || e.status === 'stale'
    if (filter === 'review') return e.status === 'generated'
    return e.status === 'approved'
  })

  const counts = {
    review: elements.filter(e => e.status === 'generated').length,
    todo: elements.filter(e => e.status === 'missing' || e.status === 'stale').length,
    done: elements.filter(e => e.status === 'approved').length,
    all: elements.filter(e => e.block_role !== 'pulse').length,
  }

  /* If the queue empties while you are in it, fall back to everything. */
  useEffect(() => {
    if (filter === 'review' && counts.review === 0 && counts.all > 0) setFilter('all')
  }, [filter, counts.review, counts.all])

  const openNotes = new Map<string, number>()
  for (const c of comments) {
    if (!c.resolved) openNotes.set(c.element_id, (openNotes.get(c.element_id) ?? 0) + 1)
  }

  /** Approve, then move to the next one waiting. That is the whole loop. */
  async function approveAndNext(el: AudioElement) {
    tap([6, 40, 12])
    const here = visible.findIndex(v => v.id === el.id)
    await onApprove(el)
    preview.stop()
    const next = visible.slice(here + 1).find(v => v.status !== 'approved') ?? visible[here + 1]
    if (next) {
      setOpen(next.id)
      document.getElementById(`m-${next.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    } else {
      setOpen(null)
    }
  }

  return (
    <div className="phone">
      <header className="phone-head">
        <h2>{episode.title}</h2>
        <div className="phone-filters">
          {([
            ['review', 'Waiting'], ['todo', 'To make'], ['all', 'All'], ['done', 'Done'],
          ] as [Filter, string][]).map(([key, label]) => (
            <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}<span className="n">{counts[key]}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="phone-list" ref={listRef}>
        {visible.length === 0 && (
          <div className="empty">
            {filter === 'review'
              ? 'Nothing waiting. Generate a first pass on a computer, then come back here to listen.'
              : 'Nothing here.'}
          </div>
        )}

        {visible.map(el => {
          const who = characters.find(c => c.id === el.character_id)
          const isOpen = open === el.id
          const notes = openNotes.get(el.id) ?? 0

          return (
            <article
              key={el.id}
              id={`m-${el.id}`}
              className="phone-line"
              data-open={isOpen}
              data-kind={el.kind}
              onClick={() => setOpen(isOpen ? null : el.id)}
            >
              <div className="phone-line-top">
                <span className="phone-who">
                  {who?.name ?? (el.kind === 'pause' ? 'silence'
                    : el.kind === 'music' ? 'music'
                      : el.kind === 'ambience' ? 'ambience' : 'sound')}
                </span>
                <span className="phone-meta">
                  {notes > 0 && <span className="note-count tnum">{notes}</span>}
                  <span className="dur tnum">{formatMs(el.start_ms)}</span>
                  <span className="pip" data-s={el.status} />
                </span>
              </div>

              <p className="phone-text">{el.text_content}</p>

              {isOpen && el.kind !== 'pause' && (
                <div className="phone-actions" onClick={e => e.stopPropagation()}>
                  <button className="phone-btn" onClick={() => onPlayElement(el)}>
                    {preview.playing ? <Pause size={16} /> : <Play size={16} />}
                    {preview.playing ? 'Stop' : 'Listen'}
                  </button>

                  {el.status === 'generated' && (
                    <button className="phone-btn is-primary" onClick={() => approveAndNext(el)}>
                      <Check size={16} /> Keep it
                    </button>
                  )}

                  {el.origin === 'script' && (
                    <button className="phone-btn" disabled={busyId === el.id}
                      onClick={() => onGenerate(el)}>
                      {busyId === el.id ? <><Spinner size={15} /> Working</> : 'Again'}
                    </button>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      <footer className="phone-player">
        <button className="play" onClick={onPlayAll} aria-label={playingAll ? 'Pause' : 'Play episode'}>
          {playingAll ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <div className="phone-progress">
          <span style={{ width: `${total ? Math.min((position / total) * 100, 100) : 0}%` }} />
        </div>
        <span className="dur tnum">{formatMs(position)} / {formatMs(total)}</span>
      </footer>
    </div>
  )
}
