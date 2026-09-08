import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Close } from './icons'
import type { AudioElement, Character } from '../lib/types'
import { colourFor } from '../lib/palette'
import { applyDirection, effectiveDirection, supportsTags, DIRECTION_HINTS } from '../lib/direction'

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
  onPlay, onGain, onNudge, onFade, onFit, onSplit, onTrim, onClose,
  onEditText, onDirection, onSetCharacter, onDelete, onAddAfter, canSplit,
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
  onEditText: (text: string) => void
  onDirection: (direction: string) => void
  onSetCharacter: (characterId: string | null) => void
  onDelete: () => void
  onAddAfter: (kind: string) => void
  canSplit: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const colour = colourFor(element, characters)
  const character = characters.find(c => c.id === element.character_id)
  const isLine = element.kind === 'dialogue'

  const [text, setText] = useState(element.text_content)
  const [direction, setDirection] = useState(element.direction ?? '')

  const tone = effectiveDirection(direction, character?.direction_notes, character?.description)
  const tagsWork = supportsTags(character?.model ?? 'eleven_v3')
  const spoken = applyDirection(element.text_content, tone.text, tagsWork)
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
        {isLine ? (
          <select
            className="clip-who"
            value={element.character_id ?? ''}
            onChange={e => onSetCharacter(e.target.value || null)}
          >
            <option value="">Nobody yet</option>
            {characters.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.voice_id ? '' : ' · no voice'}</option>
            ))}
          </select>
        ) : (
          <span className="clip-title">{element.kind}</span>
        )}
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <Close size={13} />
        </button>
      </header>

      {/*
        * The words, here rather than only in the script panel.
        *
        * Working on the shape of an episode and working on what somebody says are the same
        * job done at different distances, and moving between two panels to do it broke the
        * thought in half.
        */}
      <textarea
        className="clip-text"
        value={text}
        rows={isLine ? 2 : 3}
        onChange={e => setText(e.target.value)}
        onBlur={() => { if (text.trim() && text !== element.text_content) onEditText(text) }}
        onKeyDown={e => {
          if (e.key === 'Escape') setText(element.text_content)
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { onEditText(text); e.currentTarget.blur() }
        }}
      />

      {isLine && (
        <div className="clip-direction">
          <input
            value={direction}
            placeholder={tone.fromCharacter ? tone.text : 'nervioso, muy despacio, susurrando'}
            onChange={e => setDirection(e.target.value)}
            onBlur={() => { if (direction !== (element.direction ?? '')) onDirection(direction) }}
          />
          <div className="chips">
            {DIRECTION_HINTS.slice(0, 6).map(h => (
              <button key={h} className="chip" onClick={() => {
                const next = direction.trim() ? `${direction.trim()}, ${h}` : h
                setDirection(next)
                onDirection(next)
              }}>{h}</button>
            ))}
          </div>
          <span className="hint">
            {spoken.tags.length > 0
              ? `The model is told: ${spoken.tags.join(' ')}`
              : tone.fromCharacter
                ? `Falls back to ${character?.name ?? 'the character'}`
                : 'Nothing here, so the line is read flat.'}
          </span>
        </div>
      )}

      <div className="clip-meta tnum">
        <span>starts {tc(element.start_ms)}</span>
        <span>lasts {tc(element.duration_ms)}</span>
        {element.status !== 'approved' && <span>{element.status}</span>}
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

      <div className="clip-add">
        <select value="" onChange={e => { if (e.target.value) { onAddAfter(e.target.value); onClose() } }}>
          <option value="">Add after this…</option>
          <option value="sfx">A sound</option>
          <option value="ambience">An ambience</option>
          <option value="music">Music</option>
          <option value="pause">A silence</option>
          <option value="dialogue">A line</option>
        </select>
        <button className="btn danger-quiet" onClick={() => { onDelete(); onClose() }}>
          Remove this
        </button>
      </div>

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
