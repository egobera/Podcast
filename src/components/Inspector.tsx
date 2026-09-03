import { formatMs } from '../lib/parser'
import { runChecks } from './ExportPanel'
import { Play as PlayIcon, Upload, Check } from './icons'
import type { AudioElement, Character, Episode, SeriesAsset, SeriesBlock, Take } from '../lib/types'

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
  onRemoveBlock: (blockId: string) => void
  onAddVault: (assetId: string) => void
  onExport: () => void
}

export default function Inspector(p: Props) {
  const { element: el } = p

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
          <PlayIcon size={12} /> Play this
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
        <div className="ip-row">
          <span className="ip-label">Voice</span>
          <span className="ip-value">
            {p.character?.voice_id
              ? `${p.character.name} · locked preset`
              : 'No voice set yet'}
          </span>
        </div>
      )}

      {!isTemplate && !isBlock && el.kind !== 'dialogue' && (
        <div className="field">
          <label>Prompt</label>
          <textarea
            key={el.id}
            defaultValue={el.prompt || el.text_content}
            onBlur={e => p.onPatch({ prompt: e.target.value })}
          />
        </div>
      )}

      {!isTemplate && (
        <div className="field">
          <label>Position</label>
          <select value={el.anchor} onChange={e => p.onPatch({ anchor: e.target.value as 'line' | 'scene' })}>
            <option value="line">Moves with the line before it</option>
            <option value="scene">Stays put under the scene</option>
          </select>
        </div>
      )}

      {!isTemplate && !isBlock && (
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
                  <button className="icon-btn" aria-label="Play take" onClick={() => p.onPlayTake(t)}>
                    <PlayIcon size={11} />
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
function EpisodeSummary({ episode, elements, total, onExport }: Props) {
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
