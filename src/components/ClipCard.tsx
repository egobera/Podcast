import { useEffect, useRef } from 'react'
import { Play, Pause, Close } from './icons'
import type { AudioElement, Character } from '../lib/types'
import { colourFor, labelFor } from '../lib/palette'

function tc(ms: number) {
  const t = Math.max(0, ms) / 1000
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.floor((t % 1) * 10)}`
}

/**
 * Everything about one clip, where the clip is.
 *
 * These controls used to live in a strip along the transport, which meant working on a
 * clip involved looking at one end of the screen and reaching for the other. Bringing the
 * card to the clip keeps attention in one place, and it is also the only way to fit
 * controls this rich without the transport becoming a toolbar.
 */
export default function ClipCard({
  element, characters, x, playing,
  onPlay, onGain, onNudge, onFade, onFit, onSplit, onTrim, onClose, canSplit,
}: {
  element: AudioElement & { start_ms: number }
  characters: Character[]
  x: number
  playing: boolean
  onPlay: () => void
  onGain: (db: number) => void
  onNudge: (ms: number) => void
  onFade: (inMs: number | null, outMs: number | null) => void
  onFit: () => void
  onSplit: () => void
  onTrim: () => void
  onClose: () => void
  canSplit: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const colour = colourFor(element, characters)
  const gain = element.gain_db ?? 0
  const offset = element.offset_ms ?? 0

  /* Escape closes, because a card that traps you is worse than no card. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="clip-card"
      style={{ left: `${x}px` }}
      onPointerDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
    >
      <header>
        <span className="clip-dot" style={{ background: colour }} />
        <span className="clip-title">{labelFor(element, characters)}</span>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <Close size={13} />
        </button>
      </header>

      <div className="clip-meta tnum">
        <span>starts {tc(element.start_ms)}</span>
        <span>lasts {tc(element.duration_ms)}</span>
      </div>

      <div className="clip-row">
        <button className="clip-play" onClick={onPlay}>
          {playing ? <Pause size={13} /> : <Play size={13} />}
          {playing ? 'Stop' : 'Listen'}
        </button>
        <button className="btn" data-variant="quiet" onClick={onFit} title="Take the full length of the file">
          Fit to audio
        </button>
        <button className="btn" data-variant="quiet" onClick={onTrim}>Trim…</button>
        <button className="btn" data-variant="quiet" disabled={!canSplit} onClick={onSplit}
          title={canSplit ? 'Cut in two at the playhead' : 'Put the playhead inside this clip'}>
          Split
        </button>
      </div>

      <label className="clip-slider">
        <span>Level</span>
        <input type="range" min={-24} max={12} step={1} value={gain}
          onChange={e => onGain(Number(e.target.value))} />
        <span className="tnum">{gain > 0 ? '+' : ''}{gain} dB</span>
      </label>

      <label className="clip-slider">
        <span>Timing</span>
        <input type="range" min={-3000} max={3000} step={50} value={offset}
          onChange={e => onNudge(Number(e.target.value))} />
        <span className="tnum">{offset > 0 ? '+' : ''}{offset} ms</span>
      </label>

      <div className="clip-fades">
        <label>
          <span>Fade in</span>
          <input type="number" min={0} max={8000} step={100} value={element.fade_in_ms ?? 0}
            onChange={e => onFade(Number(e.target.value) || null, element.fade_out_ms)} />
        </label>
        <label>
          <span>Fade out</span>
          <input type="number" min={0} max={8000} step={100} value={element.fade_out_ms ?? 0}
            onChange={e => onFade(element.fade_in_ms, Number(e.target.value) || null)} />
        </label>
        <span className="hint">
          Zero uses the short automatic one, which is only there so nothing clicks.
        </span>
      </div>
    </div>
  )
}
