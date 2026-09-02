import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, callFunction, signedUrl, uploadAudio, readDuration } from '../lib/supabase'
import {
  parseScript, uniqueCharacters, formatMs, hash, layout, runtime,
  IDX_SCRIPT_START, IDX_STEP,
} from '../lib/parser'
import { insertFreeze, removeBlock, insertVaultAsset } from '../lib/template'
import ManualNote from './ManualNote'
import Inspector from './Inspector'
import BottomPanel from './BottomPanel'
import { Confirm, Keys, useToast } from './ui'
import ExportPanel from './ExportPanel'
import { Play as PlayIcon, Check as CheckIcon } from './icons'
import type { Clip } from '../lib/player'
import type { AudioElement, Character, Episode, Job, Project, SeriesAsset, Take } from '../lib/types'

const COST_PER_ELEMENT = 0.04

export default function EpisodeView({
  project, episode, userId,
}: {
  project: Project
  episode: Episode
  userId: string
}) {
  const [elements, setElements] = useState<AudioElement[]>([])
  const [chars, setChars] = useState<Character[]>([])
  const [assets, setAssets] = useState<SeriesAsset[]>([])
  const [takes, setTakes] = useState<Record<string, Take[]>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [script, setScript] = useState(episode.script_text ?? '')
  const [importing, setImporting] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cursor, setCursor] = useState(0)
  const [askGenerate, setAskGenerate] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [filter, setFilter] = useState<'all' | 'todo' | 'review' | 'done'>('all')
  const toast = useToast()
  const uploadInput = useRef<HTMLInputElement | null>(null)
  const uploadTarget = useRef<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: els }, { data: cs }, { data: sa }] = await Promise.all([
      supabase.from('elements').select('*').eq('episode_id', episode.id).order('idx'),
      supabase.from('characters').select('*').eq('project_id', project.id),
      supabase.from('series_assets').select('*').eq('project_id', project.id),
    ])
    setElements((els ?? []) as AudioElement[])
    setChars((cs ?? []) as Character[])
    setAssets((sa ?? []) as SeriesAsset[])
  }, [episode.id, project.id])

  useEffect(() => { load(); setScript(episode.script_text ?? '') }, [load, episode.id])

  useEffect(() => {
    if (!job || ['done', 'failed', 'cancelled'].includes(job.status)) return
    const t = setInterval(async () => {
      const { data } = await supabase.from('jobs').select('*').eq('id', job.id).single()
      if (data) {
        setJob(data as Job)
        if (data.status === 'done' || data.status === 'failed') load()
      }
    }, 2500)
    return () => clearInterval(t)
  }, [job, load])

  async function loadTakes(elementId: string) {
    const { data } = await supabase.from('takes').select('*')
      .eq('element_id', elementId).order('created_at', { ascending: false })
    setTakes(t => ({ ...t, [elementId]: (data ?? []) as Take[] }))
  }

  /**
   * Re-reading the script replaces only what came from the script.
   * Template themes and inserted freeze blocks survive untouched, and approved takes
   * whose line has not changed keep their audio.
   */
  async function importScript() {
    setImporting(true)
    setError('')
    setNotice('')
    try {
      const parsed = parseScript(script)
      if (parsed.length === 0) {
        setError('No lines found. Character lines look like NAME: text and sound cues go in parentheses.')
        return
      }

      const existing = new Map(chars.map(c => [c.name, c]))
      const missing = uniqueCharacters(parsed).filter(n => !existing.has(n))
      if (missing.length) {
        const { data } = await supabase.from('characters')
          .insert(missing.map(name => ({ project_id: project.id, name }))).select()
        for (const c of (data ?? []) as Character[]) existing.set(c.name, c)
      }

      const scriptElements = elements.filter(e => e.origin === 'script')
      const previous = new Map(scriptElements.map(e => [`${e.kind}:${e.source_hash}`, e]))
      const kept = scriptElements.filter(e => e.status === 'approved').length

      await supabase.from('elements').delete().eq('episode_id', episode.id).eq('origin', 'script')

      const rows = parsed.map(p => {
        const h = hash(p.text)
        const old = previous.get(`${p.kind}:${h}`)
        return {
          episode_id: episode.id,
          idx: IDX_SCRIPT_START + p.idx * IDX_STEP,
          scene: p.scene,
          kind: p.kind,
          character_id: p.characterName ? existing.get(p.characterName)?.id ?? null : null,
          text_content: p.text,
          source_hash: h,
          origin: 'script',
          anchor: p.anchor,
          gain_role: p.gainRole,
          duration_ms: old?.duration_ms ?? p.estimatedMs,
          status: old?.status === 'approved' ? 'approved' : 'missing',
          approved_take_id: old?.approved_take_id ?? null,
          prompt: old?.prompt ?? '',
        }
      })

      await supabase.from('elements').insert(rows)
      await supabase.from('episodes').update({ script_text: script }).eq('id', episode.id)
      await load()

      const carried = rows.filter(r => r.status === 'approved').length
      if (kept > 0) {
        setNotice(
          `${carried} of ${kept} approved takes carried over. ` +
          `${kept - carried} lines changed and need a new take.`,
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  async function addFreeze(el: AudioElement) {
    setError('')
    try {
      await insertFreeze(episode.id, project.id, el)
      await load()
      setNotice('Freeze wrapped around that line. Ten pulses will spread across it as the speech grows or shrinks.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not insert the freeze')
    }
  }

  async function addVaultAsset(el: AudioElement, assetId: string, anchor: 'line' | 'scene') {
    const asset = assets.find(a => a.id === assetId)
    if (!asset) return
    await insertVaultAsset(episode.id, asset, el, anchor)
    await load()
  }

  async function generateOne(el: AudioElement) {
    setBusyId(el.id)
    setError('')
    try {
      await callFunction('generate-element', { element_id: el.id })
      await load()
      await loadTakes(el.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusyId(null)
    }
  }

  async function runFirstPass() {
    try {
      const out = await callFunction<{ job_id: string }>('generate-episode-background', { episode_id: episode.id })
      const { data } = await supabase.from('jobs').select('*').eq('id', out.job_id).single()
      setJob(data as Job)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start the run', 'bad')
    }
  }

  async function approve(el: AudioElement, take: Take, advance = false) {
    await supabase.from('elements').update({
      approved_take_id: take.id,
      status: 'approved',
      duration_ms: take.duration_ms || el.duration_ms,
      source_hash: hash(el.text_content),
    }).eq('id', el.id)
    await load()
    if (advance) goToNext()
  }

  /** Moves the cursor to the next row that still needs attention. */
  function goToNext(from = cursor) {
    const next = visibleRef.current.findIndex((e, i) => i > from && e.status !== 'approved')
    const target = next === -1 ? Math.min(from + 1, visibleRef.current.length - 1) : next
    const el = visibleRef.current[target]
    if (!el) return
    setCursor(target)
    setSelected(el.id)
    loadTakes(el.id)
    document.getElementById(`row-${el.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  async function uploadOwn(elementId: string, file: File) {
    setBusyId(elementId)
    try {
      const duration = await readDuration(file)
      const path = await uploadAudio(userId, project.id, file.name, file)
      const { data } = await supabase.from('takes').insert({
        element_id: elementId, storage_path: path, duration_ms: duration, provider: 'upload',
      }).select().single()
      const el = elements.find(e => e.id === elementId)!
      if (data) await approve(el, data as Take)
      await loadTakes(elementId)
    } finally {
      setBusyId(null)
    }
  }

  async function play(el: AudioElement) {
    let path: string | null = null
    if (el.series_asset_id) {
      path = assets.find(a => a.id === el.series_asset_id)?.storage_path ?? null
    } else if (el.approved_take_id) {
      const list = takes[el.id] ?? []
      path = list.find(t => t.id === el.approved_take_id)?.storage_path ?? null
      if (!path) {
        const { data } = await supabase.from('takes').select('storage_path')
          .eq('id', el.approved_take_id).single()
        path = data?.storage_path ?? null
      }
    }
    if (!path) return
    const url = await signedUrl(path)
    if (url) new Audio(url).play()
  }

  const positionedRef = useRef<(AudioElement & { start_ms: number })[]>([])

  /** Resolves every playable element to a signed URL so the mix can be assembled. */
  const buildClips = useCallback(async (): Promise<Clip[]> => {
    const withAudio = positionedRef.current.filter(e => e.series_asset_id || e.approved_take_id)
    if (withAudio.length === 0) {
      toast('Nothing to play yet. Approve a take or add audio from the vault.')
      return []
    }
    const takeIds = withAudio.map(e => e.approved_take_id).filter(Boolean) as string[]
    const { data: tk } = takeIds.length
      ? await supabase.from('takes').select('id, storage_path').in('id', takeIds)
      : { data: [] as { id: string; storage_path: string }[] }
    const takePath = new Map((tk ?? []).map(t => [t.id, t.storage_path]))

    const clips: Clip[] = []
    for (const el of withAudio) {
      const path = el.series_asset_id
        ? assets.find(a => a.id === el.series_asset_id)?.storage_path
        : takePath.get(el.approved_take_id!)
      if (!path) continue
      const url = await signedUrl(path)
      if (!url) continue
      const role = el.gain_role === 'auto'
        ? (el.kind === 'dialogue' ? 'voice' : el.kind === 'music' ? 'bed' : 'spot')
        : el.gain_role
      clips.push({
        id: el.id, url, startMs: el.start_ms, durationMs: el.duration_ms,
        role, anchor: el.anchor,
      })
    }
    return clips
  }, [assets, toast])

  const starts = useMemo(() => layout(elements), [elements])
  const positioned = useMemo(
    () => elements.map(e => ({ ...e, start_ms: starts.get(e.id) ?? 0 }))
      .sort((a, b) => a.start_ms - b.start_ms || a.idx - b.idx),
    [elements, starts],
  )
  const total = useMemo(() => runtime(elements, starts), [elements, starts])

  positionedRef.current = positioned

  const allRows = positioned.filter(e => e.block_role !== 'pulse')
  const counts = {
    all: allRows.length,
    todo: allRows.filter(e => e.status === 'missing' || e.status === 'stale').length,
    review: allRows.filter(e => e.status === 'generated').length,
    done: allRows.filter(e => e.status === 'approved').length,
  }
  const visible = allRows.filter(e =>
    filter === 'all' ? true
      : filter === 'todo' ? (e.status === 'missing' || e.status === 'stale')
        : filter === 'review' ? e.status === 'generated'
          : e.status === 'approved')
  const approved = elements.filter(e => e.status === 'approved').length
  const pct = elements.length ? Math.round((approved / elements.length) * 100) : 0
  const inRange = total >= episode.target_min_ms && total <= episode.target_max_ms
  const freezeReady = ['freeze_in', 'freeze_pulse', 'freeze_out']
    .every(k => assets.some(a => a.kind === k && a.storage_path))

  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const selectedEl = positioned.find(e => e.id === selected) ?? null
  const blockPulses = selectedEl?.block_id
    ? positioned.filter(e => e.block_id === selectedEl.block_id && e.block_role === 'pulse')
    : []
  const blockReturnMs = selectedEl?.block_id
    ? positioned.find(e => e.block_id === selectedEl.block_id && e.block_role === 'return')?.start_ms ?? null
    : null
  const pulseCount = blockPulses.length

  const scriptCount = elements.filter(e => e.origin === 'script').length

  /**
   * Keyboard review. Approving 160 elements with a mouse is not a workflow, it is a chore.
   * Arrows move, Enter opens, A approves the newest take, G asks for another one.
   */
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.metaKey || e.ctrlKey || visible.length === 0) return

      const move = (delta: number) => {
        e.preventDefault()
        const next = Math.min(Math.max(cursor + delta, 0), visible.length - 1)
        setCursor(next)
        setSelected(visible[next].id)
        loadTakes(visible[next].id)
        document.getElementById(`row-${visible[next].id}`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }

      if (e.key === 'ArrowDown' || e.key === 'j') return move(1)
      if (e.key === 'ArrowUp' || e.key === 'k') return move(-1)

      const el = visible[cursor]
      if (!el) return
      if (e.key === 'Enter') { e.preventDefault(); setSelected(s => s === el.id ? null : el.id); loadTakes(el.id) }
      if (e.key === 'a') {
        const newest = (takes[el.id] ?? [])[0]
        if (newest) { await approve(el, newest, true) }
        else toast('No take to approve on this line yet.')
      }
      if (e.key === 'g' && el.origin === 'script') generateOne(el)
      if (e.key === 'n') { e.preventDefault(); goToNext() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (scriptCount === 0) {
    return (
      <div className="page">
        <h2>{episode.title}</h2>
        <p className="lede">
          Paste the script and Estudio turns it into a list of everything this episode needs.
          Character lines look like <code>NAME: text</code>. Sound cues go in parentheses on their own line.
          {elements.length > 0 && ' The themes from your vault are already in place.'}
        </p>
        <div className="field">
          <label htmlFor="script">Script</label>
          <textarea id="script" value={script} onChange={e => setScript(e.target.value)} style={{ minHeight: 340 }} />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn" data-variant="primary" disabled={!script.trim() || importing} onClick={importScript}>
            {importing ? 'Reading' : 'Read script'}
          </button>
        </div>
      </div>
    )
  }

  let lastScene = ''

  return (
    <>
      <div className="progress-bar">
        <div className="segmented" role="group" aria-label="Filter lines">
          {([
            ['all', 'All'], ['todo', 'To do'], ['review', 'Review'], ['done', 'Done'],
          ] as const).map(([key, label]) => (
            <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setCursor(0) }}>
              {label}<span className="n">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="meter"><span style={{ width: `${pct}%` }} /></div>
        <span className="meter-text" style={{ color: inRange ? 'var(--blue)' : 'var(--alert)' }}>
          {formatMs(total)} / {formatMs(episode.target_min_ms)} to {formatMs(episode.target_max_ms)}
        </span>
        <button
          className="btn" data-variant="primary"
          disabled={!!job && job.status === 'running'}
          onClick={() => {
            const pending = elements.filter(e => e.status === 'missing' || e.status === 'stale').length
            if (pending === 0) { toast('Nothing left to generate.'); return }
            setAskGenerate(pending)
          }}
        >
          {job && job.status === 'running' ? `Generating ${job.done}/${job.total}` : 'Generate first pass'}
        </button>
        <button className="btn" onClick={() => setExporting(true)}>Export</button>
      </div>

      <div className="episode-grid">
      <div className="page">
        <h2>{episode.title}</h2>
        <p className="lede">
          Every line and every sound this episode needs, in the order the listener hears it.
        </p>

        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        {job && job.failed > 0 && (
          <p className="notice">{job.failed} elements failed and were left untouched.</p>
        )}

        {visible.length === 0 && (
          <div className="empty">
            {filter === 'todo'
              ? 'Nothing left to make. Every line has audio.'
              : filter === 'review'
                ? 'Nothing waiting for you. Generate a take or switch to All.'
                : 'No lines here yet.'}
          </div>
        )}

        {visible.map(el => {
          const showScene = el.scene !== lastScene
          lastScene = el.scene
          const char = chars.find(c => c.id === el.character_id)
          const isOpen = selected === el.id
          const isBlock = el.origin === 'block'
          const isTemplate = el.origin === 'template'
          const pulses = el.block_role === 'entry'
            ? positioned.filter(p => p.block_id === el.block_id && p.block_role === 'pulse')
            : []

          return (
            <div key={el.id}>
              {showScene && <div className="scene-head">{el.scene}</div>}
              <div
                id={`row-${el.id}`}
                className="row"
                data-kind={el.kind}
                data-selected={isOpen}
                data-cursor={visible[cursor]?.id === el.id}
                onClick={() => { setSelected(isOpen ? null : el.id); if (!isOpen) loadTakes(el.id) }}
              >
                <span className="row-who">
                  {char?.name ?? (isTemplate ? 'theme' : isBlock ? 'block' : el.kind === 'music' ? 'music' : 'sound')}
                </span>
                <span className="row-text">
                  {el.text_content}
                  {el.block_role === 'entry' && pulses.length > 0 && (
                    <span className="dur" style={{ marginLeft: 10 }}>
                      {pulses.length} pulses to {formatMs((positioned.find(p =>
                        p.block_id === el.block_id && p.block_role === 'return')?.start_ms) ?? 0)}
                    </span>
                  )}
                </span>
                <span className="row-side">
                  <span className="row-actions">
                    {(el.series_asset_id || el.approved_take_id) && (
                      <button className="icon-btn" title="Play this" aria-label="Play this"
                        onClick={ev => { ev.stopPropagation(); play(el) }}><PlayIcon size={12} /></button>
                    )}
                    {el.status === 'generated' && (
                      <button className="icon-btn" title="Approve the newest take"
                        onClick={async ev => {
                          ev.stopPropagation()
                          const list = takes[el.id] ?? await (async () => {
                            const { data } = await supabase.from('takes').select('*')
                              .eq('element_id', el.id).order('created_at', { ascending: false })
                            return (data ?? []) as Take[]
                          })()
                          if (list[0]) approve(el, list[0])
                        }} aria-label="Approve the newest take"><CheckIcon size={13} /></button>
                    )}
                  </span>
                  <span className="dur">{formatMs(el.start_ms)}</span>
                  <span className="pip" data-s={el.status} title={el.status} />
                </span>
              </div>

            </div>
          )
        })}

        {!freezeReady && (
          <div className="manual">
            <h4>The freeze block needs its three files first</h4>
            <p>
              Upload the entry, the pulse and the return to the vault. Once they are there, any line
              can be wrapped in a freeze from its inspector, and the ten pulses spread themselves
              across the speech rather than sitting on a fixed beat.
            </p>
          </div>
        )}

        <div className="shortcuts">
          <span><Keys>space</Keys> play the episode</span>
          <span><Keys>↑</Keys><Keys>↓</Keys> move</span>
          <span><Keys>enter</Keys> open</span>
          <span><Keys>a</Keys> approve</span>
          <span><Keys>g</Keys> new take</span>
          <span><Keys>n</Keys> next gap</span>
        </div>

        <ManualNote topic="fine-edit" />
        <ManualNote topic="mastering" />

        <details style={{ marginTop: 30 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-soft)' }}>Edit the script</summary>
          <div className="field" style={{ marginTop: 12 }}>
            <textarea value={script} onChange={e => setScript(e.target.value)} style={{ minHeight: 300 }} />
          </div>
          <p className="notice">
            Re-reading keeps every approved take whose line has not changed, and leaves your themes
            and freeze blocks exactly where they are.
          </p>
          <button className="btn" onClick={importScript} disabled={importing}>
            {importing ? 'Reading' : 'Re-read script'}
          </button>
        </details>
      </div>

      <Inspector
        element={selectedEl}
        character={chars.find(c => c.id === selectedEl?.character_id)}
        characters={chars}
        assets={assets}
        takes={selectedEl ? takes[selectedEl.id] ?? [] : []}
        busy={busyId === selectedEl?.id}
        freezeReady={freezeReady}
        blockReturnMs={blockReturnMs}
        pulseCount={pulseCount}
        episode={episode}
        elements={positioned}
        total={total}
        onPatch={fields => {
          if (!selectedEl) return
          supabase.from('elements').update(fields).eq('id', selectedEl.id).then(load)
        }}
        onGenerate={() => selectedEl && generateOne(selectedEl)}
        onUpload={() => { if (selectedEl) { uploadTarget.current = selectedEl.id; uploadInput.current?.click() } }}
        onApprove={t => selectedEl && approve(selectedEl, t)}
        onPlayTake={async t => {
          const url = await signedUrl(t.storage_path)
          if (url) new Audio(url).play()
        }}
        onPlayElement={() => selectedEl && play(selectedEl)}
        onFreeze={() => selectedEl && addFreeze(selectedEl)}
        onRemoveBlock={async id => { await removeBlock(id); await load() }}
        onAddVault={id => selectedEl && addVaultAsset(selectedEl, id, 'scene')}
        onExport={() => setExporting(true)}
      />
      </div>

      <input
        ref={uploadInput} type="file" accept="audio/*" hidden
        onChange={e => {
          const f = e.target.files?.[0]
          if (f && uploadTarget.current) uploadOwn(uploadTarget.current, f)
          e.target.value = ''
        }}
      />

      {exporting && (
        <ExportPanel
          project={project}
          episode={episode}
          elements={positioned}
          total={total}
          buildClips={buildClips}
          onClose={() => setExporting(false)}
        />
      )}

      {askGenerate !== null && (
        <Confirm
          title="Generate a first pass"
          confirmLabel={`Generate ${askGenerate}`}
          onClose={() => setAskGenerate(null)}
          onConfirm={runFirstPass}
          body={
            <>
              <p>
                {askGenerate} elements have no audio yet. Estimated cost is about{' '}
                ${(askGenerate * COST_PER_ELEMENT).toFixed(2)}.
              </p>
              <p>
                This makes a first pass, not a finished episode. Everything comes back as an
                unapproved take for you to keep or replace.
              </p>
              <p className="notice">
                It runs in the background. You can close this tab and come back.
              </p>
            </>
          }
        />
      )}

      <BottomPanel
        elements={positioned}
        total={total}
        duckDb={project.music_duck_db}
        selectedId={selected}
        buildClips={buildClips}
        onSelect={id => {
          setSelected(id)
          loadTakes(id)
          const i = visibleRef.current.findIndex(v => v.id === id)
          if (i >= 0) setCursor(i)
          document.getElementById(`row-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }}
      />
    </>
  )
}
