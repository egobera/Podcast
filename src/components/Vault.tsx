import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, uploadAudio, readDuration, signedUrl } from '../lib/supabase'
import { formatMs } from '../lib/parser'
import { LANGUAGES, accentsFor } from '../lib/languages'
import { useToast, AskText, Confirm } from './ui'
import { Play, Upload, Plus, Close } from './icons'
import TrimEditor from './TrimEditor'
import ManualNote from './ManualNote'
import Suggestions from './Suggestions'
import type { CueLike } from '../lib/detect'
import type { Project, SeriesAsset, SeriesBlock } from '../lib/types'

/** Suggestions only. A series decides what it actually needs. */
const SUGGESTIONS = [
  { name: 'Opening theme', kind: 'theme_open', auto: 'open', hint: 'Plays at the start of every episode.' },
  { name: 'Closing theme', kind: 'theme_close', auto: 'close', hint: 'Plays at the end of every episode.' },
  { name: 'Tension bed', kind: 'bed', auto: 'none', hint: 'Loops under scenes that need pressure.' },
  { name: 'Emotional bed', kind: 'bed', auto: 'none', hint: 'Loops under the scenes that carry weight.' },
]

export default function Vault({
  project, userId, onChanged,
}: {
  project: Project
  userId: string
  onChanged: () => void
}) {
  const [assets, setAssets] = useState<SeriesAsset[]>([])
  const [blocks, setBlocks] = useState<SeriesBlock[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addingBlock, setAddingBlock] = useState(false)
  const [trim, setTrim] = useState<SeriesAsset | null>(null)
  const [seriesCues, setSeriesCues] = useState<CueLike[]>([])
  const [remove, setRemove] = useState<SeriesAsset | null>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const toast = useToast()

  const load = useCallback(async () => {
    const [{ data: a }, { data: b }] = await Promise.all([
      supabase.from('series_assets').select('*').eq('project_id', project.id).order('sort').order('created_at'),
      supabase.from('series_blocks').select('*').eq('project_id', project.id).order('created_at'),
    ])
    setAssets((a ?? []) as SeriesAsset[])
    setBlocks((b ?? []) as SeriesBlock[])
  }, [project.id])

  useEffect(() => { load() }, [load])

  /* The series layer. One query for every sound cue in every episode of this project. */
  useEffect(() => {
    let dead = false
    ;(async () => {
      const { data: eps } = await supabase.from('episodes').select('id').eq('project_id', project.id)
      const ids = (eps ?? []).map(e => e.id)
      if (ids.length < 2) { setSeriesCues([]); return }
      const { data } = await supabase.from('elements')
        .select('id, idx, kind, text_content, episode_id')
        .in('episode_id', ids)
        .neq('kind', 'dialogue')
      if (!dead) setSeriesCues((data ?? []) as CueLike[])
    })()
    return () => { dead = true }
  }, [project.id])

  async function addAsset(name: string, kind = 'sfx', auto = 'none', description = '') {
    const { error } = await supabase.from('series_assets').insert({
      project_id: project.id, name, kind, auto_place: auto,
      description, sort: assets.length,
    })
    if (error) { toast(error.message, 'bad'); return }
    load(); onChanged()
  }

  async function patch(id: string, fields: Partial<SeriesAsset>) {
    await supabase.from('series_assets').update(fields).eq('id', id)
    load(); onChanged()
  }

  async function upload(asset: SeriesAsset, file: File) {
    setBusy(asset.id)
    try {
      const duration = await readDuration(file)
      const path = await uploadAudio(userId, project.id, file.name, file)
      await patch(asset.id, {
        storage_path: path, duration_ms: duration, provider: 'upload',
        version: asset.version + 1,
      })
      toast(`${asset.name} saved. ${formatMs(duration)}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'bad')
    } finally {
      setBusy(null)
    }
  }

  async function play(path: string) {
    const url = await signedUrl(path)
    if (url) new Audio(url).play()
  }

  async function setLanguage(fields: Partial<Project>) {
    await supabase.from('projects').update(fields).eq('id', project.id)
    onChanged()
  }

  async function addBlock(name: string) {
    const { error } = await supabase.from('series_blocks').insert({ project_id: project.id, name })
    if (error) { toast(error.message, 'bad'); return }
    load()
  }

  async function patchBlock(id: string, fields: Partial<SeriesBlock>) {
    await supabase.from('series_blocks').update(fields).eq('id', id)
    load()
  }

  const missing = SUGGESTIONS.filter(s => !assets.some(a => a.name === s.name))
  const withAudio = assets.filter(a => a.storage_path).length

  return (
    <div className="page">
      <h2>Series vault</h2>
      <p className="lede">
        Audio that belongs to the whole series, not to one episode. You decide what goes here.
        {assets.length > 0 && ` ${withAudio} of ${assets.length} filled.`}
      </p>

      <div className="lang-bar">
        <div className="field">
          <label>Language</label>
          <select value={project.language_code}
            onChange={e => setLanguage({ language_code: e.target.value, accent: accentsFor(e.target.value)[0] })}>
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Accent</label>
          <select value={project.accent} onChange={e => setLanguage({ accent: e.target.value })}>
            {accentsFor(project.language_code).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <p className="notice lang-note">
          The language goes to the model so it reads numbers and abbreviations by the right rules.
          The accent is not a setting the model takes: it comes from the voices you pick or record.
        </p>
      </div>

      {assets.length === 0 && (
        <div className="empty">
          Nothing here yet. Add whatever repeats across your episodes: a theme, a bed, a station
          ident, a doorbell you use every week.
        </div>
      )}

      <div className="cards">
        {assets.map(asset => (
          <div className="card" key={asset.id}>
            <div className="card-head">
              <h3>{asset.name}</h3>
              <button className="icon-btn" aria-label="Remove" onClick={() => setRemove(asset)}>
                <Close size={13} />
              </button>
            </div>

            <input
              className="card-desc"
              placeholder="What is it for"
              defaultValue={asset.description}
              onBlur={e => patch(asset.id, { description: e.target.value })}
            />

            <label className="auto-place">
              <select value={asset.auto_place ?? 'none'}
                onChange={e => patch(asset.id, { auto_place: e.target.value })}>
                <option value="none">Not placed automatically</option>
                <option value="open">Opens every episode</option>
                <option value="close">Closes every episode</option>
              </select>
            </label>

            <div className="btn-row" style={{ marginTop: 'auto', paddingTop: 8 }}>
              {asset.storage_path ? (
                <>
                  <button className="icon-btn" aria-label="Play" onClick={() => play(asset.storage_path!)}>
                    <Play size={12} />
                  </button>
                  <span className="dur tnum">{formatMs(asset.duration_ms ?? 0)}</span>
                  <button className="btn" data-variant="quiet" onClick={() => setTrim(asset)}>Trim</button>
                  <button className="btn" data-variant="quiet"
                    onClick={() => inputs.current[asset.id]?.click()}>Replace</button>
                </>
              ) : (
                <button className="btn" data-variant="primary" disabled={busy === asset.id}
                  onClick={() => inputs.current[asset.id]?.click()}>
                  <Upload size={13} /> {busy === asset.id ? 'Uploading' : 'Upload'}
                </button>
              )}
              <input ref={el => { inputs.current[asset.id] = el }} type="file" accept="audio/*" hidden
                onChange={e => { const f = e.target.files?.[0]; if (f) upload(asset, f); e.target.value = '' }} />
            </div>
          </div>
        ))}

        <button className="card is-add" onClick={() => setAdding(true)}>
          <span className="new-mark"><Plus size={16} /></span>
          <span className="new-text">Add a sound</span>
        </button>
      </div>

      {missing.length > 0 && (
        <div className="suggest">
          <span className="ip-label">Common ones you have not added</span>
          <div className="btn-row" style={{ marginTop: 8 }}>
            {missing.map(s => (
              <button className="btn" key={s.name} title={s.hint}
                onClick={() => addAsset(s.name, s.kind, s.auto, s.hint)}>
                <Plus size={12} /> {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <h3 className="section-head">Blocks</h3>
      <p className="notice" style={{ marginBottom: 14 }}>
        A block is a shape that repeats inside episodes: something opens it, something repeats
        underneath for as long as the moment lasts, and something closes it. Define one here and
        you can wrap any line of any script in it. A time freeze, a flashback, a dream.
      </p>

      {blocks.length === 0 && (
        <div className="empty" style={{ marginBottom: 16 }}>
          No blocks yet. Most series do not need one.
        </div>
      )}

      {blocks.map(b => (
        <div className="block-card" key={b.id}>
          <div className="card-head">
            <input className="block-name" defaultValue={b.name}
              onBlur={e => patchBlock(b.id, { name: e.target.value })} />
            <button className="icon-btn" aria-label="Delete block"
              onClick={async () => { await supabase.from('series_blocks').delete().eq('id', b.id); load() }}>
              <Close size={13} />
            </button>
          </div>
          <input className="card-desc" placeholder="When to use it" defaultValue={b.description}
            onBlur={e => patchBlock(b.id, { description: e.target.value })} />
          <div className="block-slots">
            {([
              ['entry_asset_id', 'Opens with'],
              ['repeat_asset_id', 'Repeats underneath'],
              ['return_asset_id', 'Closes with'],
            ] as const).map(([key, label]) => (
              <div className="field" key={key}>
                <label>{label}</label>
                <select value={b[key] ?? ''} onChange={e => patchBlock(b.id, { [key]: e.target.value || null })}>
                  <option value="">Nothing</option>
                  {assets.filter(a => a.storage_path).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            ))}
            <div className="field">
              <label>How many repeats</label>
              <input type="number" min={1} max={40} defaultValue={b.repeat_count}
                onBlur={e => patchBlock(b.id, { repeat_count: Number(e.target.value) || 10 })} />
            </div>
          </div>

          <div className="block-slots">
            <div className="field">
              <label>Marker in the script</label>
              <input defaultValue={b.trigger_marker || b.name}
                onBlur={e => patchBlock(b.id, { trigger_marker: e.target.value })} />
            </div>
            <div className="field">
              <label>Or a stage direction that opens it</label>
              <input placeholder="chasquido" defaultValue={b.trigger_cue}
                onBlur={e => patchBlock(b.id, { trigger_cue: e.target.value })} />
            </div>
            <div className="field">
              <label>And one that closes it</label>
              <input placeholder="golpe de aire" defaultValue={b.end_cue}
                onBlur={e => patchBlock(b.id, { end_cue: e.target.value })} />
            </div>
          </div>

          <p className="notice">
            Write <code>[[{b.trigger_marker || b.name}]]</code> on its own line and the block wraps
            the line that follows. Put <code>[[/{b.trigger_marker || b.name}]]</code> further down
            to wrap everything in between. Blocks placed this way rebuild themselves every time you
            re-read the script; ones you insert by hand are left alone.
          </p>
        </div>
      ))}

      <button className="btn" onClick={() => setAddingBlock(true)} style={{ marginTop: 12 }}>
        <Plus size={13} /> Add a block
      </button>

      <Suggestions
        project={project}
        elements={seriesCues}
        scope="series"
        onApplied={() => { load(); onChanged() }}
      />

      <ManualNote topic="theme-cut" />
      <ManualNote topic="reverse-reverb" />

      {adding && (
        <AskText title="Add a sound" label="What is it called" submitLabel="Add"
          onSubmit={name => addAsset(name)} onClose={() => setAdding(false)} />
      )}
      {addingBlock && (
        <AskText title="Add a block" label="What is it called" initial="Freeze" submitLabel="Add"
          onSubmit={addBlock} onClose={() => setAddingBlock(false)} />
      )}
      {trim && trim.storage_path && (
        <TrimEditor
          path={trim.storage_path}
          title={trim.name}
          userId={userId}
          projectId={project.id}
          onSaved={(newPath, ms) => patch(trim.id, {
            storage_path: newPath, duration_ms: ms, version: trim.version + 1,
          })}
          onClose={() => setTrim(null)}
        />
      )}
      {remove && (
        <Confirm
          title={`Remove ${remove.name}`}
          confirmLabel="Remove"
          destructive
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await supabase.from('series_assets').delete().eq('id', remove.id)
            load(); onChanged()
          }}
          body={<p>Episodes already using it keep the audio they have. Only the vault entry goes.</p>}
        />
      )}
    </div>
  )
}
