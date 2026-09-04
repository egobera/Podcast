import { useState } from 'react'
import { formatMs } from '../lib/parser'
import { runChecks } from './ExportPanel'
import { Play as PlayIcon, Pause as PauseIcon, Upload, Check } from './icons'
import { usePreview } from '../lib/usePreview'
import Comments from './Comments'
import { applyDirection, effectiveDirection, DIRECTION_HINTS } from '../lib/direction'
import { buildSoundPrompt } from '../lib/soundprompt'
import type { AudioElement, Character, Comment, Episode, SeriesAsset, SeriesBlock, Take } from '../lib/types'

interface Props {
  element: (AudioElement & { start_ms: number }) | null
  character: Character | undefined
  characters: Character[]
  assets: SeriesAsset[]
  takes: Take[]
  busy: boolean
  blocks: SeriesBlock[]
  blockReturnMs: number | null
  pulseCount: number
  // episode summary, shown when nothing is selected
  episode: Episode
  elements: (AudioElement & { start_ms: number })[]
  total: number
  onPatch: (fields: Partial<AudioElement>) => void
  onGenerate: () => void
  onUpload: () => void
  onApprove: (take: Take) => void
  onPlayTake: (take: Take) => void
  onPlayElement: () => void
  onAddBlock: (blockId: string) => void
  onStopAudio: () => void
  onRemoveBlock: (blockId: string) => void
  onAddVault: (assetId: string) => void
  onExport: () => void
  onDeleteEpisode: () => void
  missingThemes: { id: string; name: string }[]
  onPlaceThemes: () => void
  comments: Comment[]
  userId: string
  userEmail: string | null
  episodeId: string
  onCommentsChanged: () => void
}

export default function Inspector(p: Props) {
  const { element: el } = p
  const preview = usePreview()

  if (!el) return <EpisodeSummary {...p} />

  const isTemplate = el.origin === 'template'
  const isBlock = el.origin === 'block'
  const hasAudio = !!(el.series_asset_id || el.approved_take_id)

  return (
    <aside className="inspector-panel">
      <header className="ip-head">
        <span className="ip-kind">
          {p.character?.name ?? (isTemplate ? 'From the vault' : isBlock ? 'Block' : el.kind)}
        </span>
        <span className="dur tnum">{formatMs(el.start_ms)}</span>
      </header>

      <p className="ip-text" data-kind={el.kind}>{el.text_content}</p>

      {hasAudio && (
        <button className="btn ip-play" onClick={p.onPlayElement}>
          {preview.playing ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
          {preview.playing ? 'Stop' : 'Play this'}
        </button>
      )}

      {isTemplate && (
        <p className="notice">
          Placed automatically in every episode. To change it, replace the asset in the vault.
        </p>
      )}

      {isBlock && el.block_role === 'entry' && (
        <>
          <p className="notice">
            {p.pulseCount} pulses spread across the speech, ending at{' '}
            {p.blockReturnMs !== null ? formatMs(p.blockReturnMs) : 'the return'}. They reposition
            themselves whenever the line inside changes length.
          </p>
          <button className="btn" data-variant="quiet" onClick={() => p.onRemoveBlock(el.block_id!)}>
            Remove this freeze
          </button>
        </>
      )}

      {el.kind === 'dialogue' && !isTemplate && (
        <>
          <div className="ip-row">
            <span className="ip-label">Voice</span>
            <span className="ip-value">
              {p.character?.voice_id
                ? `${p.character.name} · locked preset`
                : 'No voice set yet'}
            </span>
          </div>

          <DirectionField
            key={el.id}
            value={el.direction ?? ''}
            character={p.character}
            line={el.text_content}
            onChange={direction => p.onPatch({ direction })}
          />
        </>
      )}

      {!isTemplate && !isBlock && el.kind !== 'dialogue' && el.kind !== 'pause' && (() => {
        const built = buildSoundPrompt(el.text_content, el.duration_ms)
        return (
          <div className="field">
            <label>Sound prompt</label>
            <textarea
              key={el.id}
              defaultValue={el.prompt || built.prompt}
              onBlur={e => p.onPatch({ prompt: e.target.value })}
            />
            <span className="hint">
              {built.described
                ? 'In English. The generator answers to concrete nouns, not to stage directions.'
                : 'Nothing in this cue was recognised, so it went through as written. Rewrite it in English as a sound.'}
            </span>

            <div className="sound-controls">
              <label htmlFor={`secs-${el.id}`}>Length</label>
              <input
                id={`secs-${el.id}`}
                type="number" min={1} max={22} step={1}
                defaultValue={Math.round((el.duration_ms || built.seconds * 1000) / 1000)}
                onBlur={e => p.onPatch({
                  duration_ms: Math.min(Math.max(Number(e.target.value) || 3, 1), 22) * 1000,
                })}
              />
              <span className="unit">sec</span>
              <button className="btn" data-variant="primary" disabled={p.busy}
                onClick={() => { p.onStopAudio(); p.onGenerate() }}>
                {p.busy ? 'Working' : p.takes.length ? 'Another take' : 'Generate'}
              </button>
            </div>
          </div>
        )
      })()}

      {!isTemplate && (
        <div className="field">
          <label>Position</label>
          <select value={el.anchor} onChange={e => p.onPatch({ anchor: e.target.value as 'line' | 'scene' })}>
            <option value="line">Moves with the line before it</option>
            <option value="scene">Stays put under the scene</option>
          </select>
        </div>
      )}

      <Comments
        elementId={el.id}
        episodeId={p.episodeId}
        userId={p.userId}
        userEmail={p.userEmail}
        comments={p.comments}
        onChanged={p.onCommentsChanged}
      />

      {el.kind === 'pause' && (
        <div className="field">
          <label>How long the silence lasts</label>
          <input
            key={`pause-${el.id}`}
            type="number" min={1} max={20} step={1}
            defaultValue={Math.round(el.duration_ms / 1000)}
            onBlur={e => p.onPatch({ duration_ms: Math.max(1, Number(e.target.value) || 1) * 1000 })}
          />
          <span className="hint">
            Nothing is generated for a pause. It is real time on the timeline, and everything
            after it moves when you change it.
          </span>
        </div>
      )}

      {!isTemplate && !isBlock && el.kind !== 'pause' && (
        <>
          <div className="ip-section">
            <span className="ip-label">Takes</span>
            <div className="takes">
              {p.takes.length === 0 && <p className="notice">No takes yet.</p>}
              {p.takes.map((t, i) => (
                <div className="take" key={t.id} data-approved={el.approved_take_id === t.id}>
                  <span className="take-name">
                    {p.takes.length - i} · {formatMs(t.duration_ms)}
                  </span>
                  <button className="icon-btn"
                    data-on={preview.playing === t.storage_path}
                    aria-label={preview.playing === t.storage_path ? 'Stop take' : 'Play take'}
                    onClick={() => p.onPlayTake(t)}>
                    {preview.playing === t.storage_path ? <PauseIcon size={11} /> : <PlayIcon size={11} />}
                  </button>
                  <button className="icon-btn" aria-label="Approve take" data-on={el.approved_take_id === t.id}
                    onClick={() => p.onApprove(t)}>
                    <Check size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="btn-row">
            <button className="btn" data-variant="primary" disabled={p.busy} onClick={p.onGenerate}>
              {p.busy ? 'Generating' : p.takes.length ? 'Another take' : 'Generate'}
            </button>
            <button className="btn" onClick={p.onUpload}><Upload size={13} /> Upload</button>
          </div>

          <div className="ip-section">
            <span className="ip-label">Add here</span>
            <div className="btn-row">
              {p.blocks.length > 0 && (
                <select className="inline" value=""
                  onChange={e => { if (e.target.value) { p.onAddBlock(e.target.value); e.target.value = '' } }}>
                  <option value="">Wrap in…</option>
                  {p.blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
              <select className="inline" value=""
                onChange={e => { if (e.target.value) { p.onAddVault(e.target.value); e.target.value = '' } }}>
                <option value="">From vault</option>
                {p.assets.filter(a => a.storage_path && a.auto_place !== 'open' && a.auto_place !== 'close')
                  .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
        </>
      )}
    </aside>
  )
}

/** What the panel shows when nothing is selected: the state of the episode. */
function EpisodeSummary(p: Props) {
  const { episode, elements, total, onExport, onDeleteEpisode, missingThemes, onPlaceThemes } = p
  const checks = runChecks(elements, episode, total)
  const byKind = {
    dialogue: elements.filter(e => e.kind === 'dialogue').length,
    sfx: elements.filter(e => e.kind === 'sfx' || e.kind === 'ambience').length,
    music: elements.filter(e => e.kind === 'music').length,
  }
  const approved = elements.filter(e => e.status === 'approved').length
  const inRange = total >= episode.target_min_ms && total <= episode.target_max_ms

  return (
    <aside className="inspector-panel">
      <header className="ip-head">
        <span className="ip-kind">Episode</span>
      </header>

      <div className="ip-stats">
        <div className="stat">
          <span className="stat-n tnum">{formatMs(total)}</span>
          <span className="stat-l" style={{ color: inRange ? 'var(--blue)' : 'var(--alert)' }}>
            {inRange ? 'within target' : 'outside target'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-n tnum">{approved}/{elements.length}</span>
          <span className="stat-l">approved</span>
        </div>
      </div>

      <div className="ip-section">
        <span className="ip-label">What it is made of</span>
        <div className="ip-bars">
          <Bar label="Lines" n={byKind.dialogue} total={elements.length} />
          <Bar label="Sound" n={byKind.sfx} total={elements.length} />
          <Bar label="Music" n={byKind.music} total={elements.length} />
        </div>
      </div>

      {missingThemes.length > 0 && (
        <div className="ip-section">
          <span className="ip-label">Missing from this episode</span>
          <p className="notice">
            {missingThemes.map(t => t.name).join(' and ')} {missingThemes.length === 1 ? 'is' : 'are'} in
            the vault but not in this episode. Episodes only pick them up when they are created,
            so one made before the vault was filled never got them.
          </p>
          <button className="btn" data-variant="primary" onClick={onPlaceThemes}>
            Place {missingThemes.length === 1 ? 'it' : 'them'} now
          </button>
        </div>
      )}

      <div className="ip-section">
        <span className="ip-label">Before you export</span>
        {checks.length === 0 ? (
          <p className="notice">Nothing to flag.</p>
        ) : (
          <div className="checks">
            {checks.map((c, i) => (
              <div className="check" data-level={c.level} key={i}>
                <span className="check-mark">{c.level === 'stop' ? '!' : '·'}</span>
                <span>{c.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="btn" onClick={onExport}>Export episode</button>

      <button className="btn danger quiet-danger" onClick={p.onDeleteEpisode}>
        Delete this episode
      </button>

      <p className="notice ip-hint">
        Select a line to work on it, or press <kbd className="key">↓</kbd> to start from the top.
      </p>
    </aside>
  )
}

function Bar({ label, n, total }: { label: string; n: number; total: number }) {
  return (
    <div className="ip-bar">
      <span className="ip-bar-l">{label}</span>
      <div className="ip-bar-track">
        <span style={{ width: `${total ? (n / total) * 100 : 0}%` }} />
      </div>
      <span className="ip-bar-n tnum">{n}</span>
    </div>
  )
}

/**
 * The tone for one line.
 *
 * Kept as its own component with its own state so the preview under it updates as you
 * type. Reading straight from the row meant the hint lagged a save behind and said a line
 * would be read flat while you were looking at the words you had just written.
 */
function DirectionField({
  value, character, line, onChange,
}: {
  value: string
  character: Character | undefined
  line: string
  onChange: (value: string) => void
}) {
  const [text, setText] = useState(value)

  const tone = effectiveDirection(text, character?.direction_notes, character?.description)
  const out = applyDirection(line, tone.text)

  const add = (hint: string) => {
    const next = text.trim() ? `${text.trim()}, ${hint}` : hint
    setText(next)
    onChange(next)
  }

  return (
    <div className="field">
      <label>How it is said</label>
      <input
        value={text}
        placeholder={tone.fromCharacter ? tone.text : 'nervioso, muy despacio, susurrando'}
        onChange={e => setText(e.target.value)}
        onBlur={() => onChange(text)}
      />
      <div className="chips" style={{ marginTop: 6 }}>
        {DIRECTION_HINTS.slice(0, 8).map(h => (
          <button key={h} className="chip" onClick={() => add(h)}>{h}</button>
        ))}
      </div>

      <details className="sent">
        <summary>Exactly what is sent for this line</summary>
        <pre>{out.text}</pre>
        <span className="hint">
          {tone.fromCharacter
            ? `Tone inherited from ${character?.name ?? 'the character'}.`
            : 'Tone written on this line.'}
        </span>
      </details>

      <span className="hint">
        {out.tags.length > 0
          ? <>The model is told: {out.tags.join(' ')}{tone.fromCharacter && ', from the character'}</>
          : tone.fromCharacter
            ? <>Falls back to {character?.name}: “{tone.text}”. Nothing in it the model reads as a feeling.</>
            : tone.text
              ? 'Nothing in there the model understands yet. Try a feeling or a pace.'
              : 'No direction here and none on the character, so this line is read flat.'}
      </span>
    </div>
  )
}
