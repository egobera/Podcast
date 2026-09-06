import { useCallback, useEffect, useState } from 'react'
import { supabase, signedUrl } from '../lib/supabase'
import { useAssetInProject, useVoiceInProject } from '../lib/library'
import { formatMs } from '../lib/parser'
import { usePreview } from '../lib/usePreview'
import { useToast, Confirm } from './ui'
import { Play, Pause, Close } from './icons'
import type { Project } from '../lib/types'

interface Kept {
  id: string
  name: string
  description: string
  from_project: string | null
  created_at: string
}

interface KeptAsset extends Kept {
  kind: string
  storage_path: string
  duration_ms: number | null
  expected_ms: number | null
}

interface KeptVoice extends Kept {
  voice_id: string
  model: string
  stability: number
  similarity: number
  style: number
  speed: number
  seed: number | null
  accent: string | null
  source: string
  voice_prompt: string
  direction_notes: string
}

/**
 * What survives a series.
 *
 * Deleting a series takes its audio with it, and that is correct. This is the exception a
 * person declares: the theme that took twenty attempts, the narrator whose settings
 * finally sit right. Nothing arrives here on its own, which is what stops it becoming a
 * drawer nobody opens.
 */
export default function LibraryPanel({
  teamId, project, userId, onChanged,
}: {
  teamId: string
  project: Project | null
  userId: string
  onChanged: () => void
}) {
  const [assets, setAssets] = useState<KeptAsset[]>([])
  const [voices, setVoices] = useState<KeptVoice[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ table: string; id: string; name: string } | null>(null)
  const preview = usePreview()
  const toast = useToast()

  const load = useCallback(async () => {
    const [{ data: a }, { data: v }] = await Promise.all([
      supabase.from('library_assets').select('*').eq('team_id', teamId).order('created_at', { ascending: false }),
      supabase.from('library_voices').select('*').eq('team_id', teamId).order('created_at', { ascending: false }),
    ])
    setAssets((a ?? []) as KeptAsset[])
    setVoices((v ?? []) as KeptVoice[])
  }, [teamId])

  useEffect(() => { load() }, [load])

  async function play(path: string) {
    if (preview.playing === path) { preview.stop(); return }
    const url = await signedUrl(path)
    if (url) preview.toggle(path, url)
  }

  const empty = assets.length === 0 && voices.length === 0

  return (
    <div className="page">
      <h2>Library</h2>
      <p className="lede">
        Sounds and voices kept out of a series, so they outlive it. Nothing lands here on its own:
        press <em>Keep</em> on anything in a vault or a cast that you would be sorry to lose.
      </p>

      {empty && (
        <div className="empty">
          Nothing kept yet. The first candidates are usually your themes and whichever voice took
          the longest to get right.
        </div>
      )}

      {voices.length > 0 && (
        <>
          <h3 className="section-head">Voices</h3>
          <div className="cards">
            {voices.map(v => (
              <div className="card" key={v.id}>
                <div className="card-head">
                  <h3>{v.name}</h3>
                  <button className="icon-btn" aria-label="Remove"
                    onClick={() => setRemoving({ table: 'library_voices', id: v.id, name: v.name })}>
                    <Close size={13} />
                  </button>
                </div>
                {v.description && <p className="card-desc-static">{v.description}</p>}
                <p className="uses">
                  {v.model.replace('eleven_', '')} · {v.accent ?? 'no accent set'}
                  {v.from_project && ` · from ${v.from_project}`}
                </p>
                <div className="btn-row" style={{ marginTop: 'auto', paddingTop: 8 }}>
                  <button className="btn" data-variant="primary"
                    disabled={!project || busy === v.id}
                    title={project ? '' : 'Open a series first'}
                    onClick={async () => {
                      if (!project) return
                      setBusy(v.id)
                      try {
                        await useVoiceInProject(project.id, v)
                        onChanged()
                        toast(`${v.name} added to ${project.name}.`)
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Could not add it', 'bad')
                      } finally { setBusy(null) }
                    }}>
                    {busy === v.id ? 'Adding' : 'Add to this series'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {assets.length > 0 && (
        <>
          <h3 className="section-head">Sounds and music</h3>
          <div className="cards">
            {assets.map(a => (
              <div className="card" key={a.id}>
                <div className="card-head">
                  <h3>{a.name}</h3>
                  <button className="icon-btn" aria-label="Remove"
                    onClick={() => setRemoving({ table: 'library_assets', id: a.id, name: a.name })}>
                    <Close size={13} />
                  </button>
                </div>
                <p className="uses">
                  {a.duration_ms ? formatMs(a.duration_ms) : 'unknown length'}
                  {a.from_project && ` · from ${a.from_project}`}
                </p>
                <div className="btn-row" style={{ marginTop: 'auto', paddingTop: 8 }}>
                  <button className="icon-btn" data-on={preview.playing === a.storage_path}
                    aria-label="Play" onClick={() => play(a.storage_path)}>
                    {preview.playing === a.storage_path ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                  <button className="btn" data-variant="primary"
                    disabled={!project || busy === a.id}
                    title={project ? '' : 'Open a series first'}
                    onClick={async () => {
                      if (!project) return
                      setBusy(a.id)
                      try {
                        await useAssetInProject(project.id, userId, a)
                        onChanged()
                        toast(`${a.name} copied into ${project.name}.`)
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Could not add it', 'bad')
                      } finally { setBusy(null) }
                    }}>
                    {busy === a.id ? 'Copying' : 'Add to this series'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {removing && (
        <Confirm
          title={`Remove ${removing.name} from the library`}
          confirmLabel="Remove"
          destructive
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await supabase.from(removing.table).delete().eq('id', removing.id)
            load()
          }}
          body={
            <p>
              Any series already using it keeps its own copy. Only the kept one goes.
            </p>
          }
        />
      )}
    </div>
  )
}
