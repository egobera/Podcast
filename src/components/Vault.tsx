import { useEffect, useRef, useState } from 'react'
import { supabase, uploadAudio, readDuration, signedUrl } from '../lib/supabase'
import { formatMs } from '../lib/parser'
import ManualNote from './ManualNote'
import { useToast } from './ui'
import type { Project, SeriesAsset } from '../lib/types'

const SLOTS: { kind: string; name: string; hint: string; auto: string }[] = [
  { kind: 'theme_open', name: 'Opening theme', hint: 'Plays at 0:00 of every episode. Ends unresolved.', auto: 'open' },
  { kind: 'theme_close', name: 'Closing theme', hint: 'Same riff, resolving. Placed at the end of every episode.', auto: 'close' },
  { kind: 'bed', name: 'Tension bed', hint: 'Loops under scenes that need pressure.', auto: 'none' },
  { kind: 'bed', name: 'Emotional bed', hint: 'Loops under the scenes that carry weight.', auto: 'none' },
  { kind: 'freeze_in', name: 'Freeze entry', hint: 'Reverse reverb swell, hard cut, acid tail.', auto: 'none' },
  { kind: 'freeze_pulse', name: 'Freeze pulse', hint: 'One low tom hit. Placed ten times per freeze.', auto: 'none' },
  { kind: 'freeze_out', name: 'Freeze return', hint: 'Air hit and the world coming back.', auto: 'none' },
  { kind: 'villain', name: 'Antagonist motif', hint: 'The riff inverted and warped.', auto: 'none' },
]

export default function Vault({ project, userId, onChanged }: { project: Project; userId: string; onChanged: () => void }) {
  const [assets, setAssets] = useState<SeriesAsset[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const toast = useToast()

  async function load() {
    const { data } = await supabase.from('series_assets').select('*').eq('project_id', project.id)
    setAssets(data ?? [])
  }
  useEffect(() => { load() }, [project.id])

  async function upload(slot: typeof SLOTS[number], file: File) {
    setBusy(slot.name)
    try {
      const duration = await readDuration(file)
      const path = await uploadAudio(userId, project.id, file.name, file)
      const existing = assets.find(a => a.name === slot.name)
      if (existing) {
        await supabase.from('series_assets')
          .update({ storage_path: path, duration_ms: duration, version: existing.version + 1 })
          .eq('id', existing.id)
      } else {
        await supabase.from('series_assets').insert({
          project_id: project.id,
          kind: slot.kind,
          name: slot.name,
          storage_path: path,
          duration_ms: duration,
          provider: 'upload',
          auto_place: slot.auto,
        })
      }
      await load()
      onChanged()
      toast(slot.auto === 'open' || slot.auto === 'close'
        ? `${slot.name} saved. It will be placed in every new episode automatically.`
        : `${slot.name} saved to the vault.`)
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

  const filled = assets.filter(a => a.storage_path).length

  return (
    <div className="page">
      <h2>Series vault</h2>
      <p className="lede">
        Audio that belongs to the whole series, not to one episode. Set it once here and every new
        episode is born with it already in place. {filled} of {SLOTS.length} slots filled.
      </p>

      <div className="cards">
        {SLOTS.map(slot => {
          const asset = assets.find(a => a.name === slot.name)
          return (
            <div className="card" key={slot.name}>
              <h3>{slot.name}</h3>
              <p>{slot.hint}</p>
              <div className="btn-row" style={{ marginTop: 'auto', paddingTop: 8 }}>
                {asset?.storage_path ? (
                  <>
                    <button className="btn" onClick={() => play(asset.storage_path!)}>Play</button>
                    <span className="dur">{formatMs(asset.duration_ms ?? 0)}</span>
                    <button className="btn" data-variant="quiet" onClick={() => inputs.current[slot.name]?.click()}>
                      Replace
                    </button>
                  </>
                ) : (
                  <button
                    className="btn"
                    data-variant="primary"
                    disabled={busy === slot.name}
                    onClick={() => inputs.current[slot.name]?.click()}
                  >
                    {busy === slot.name ? 'Uploading' : 'Upload audio'}
                  </button>
                )}
                <input
                  ref={el => { inputs.current[slot.name] = el }}
                  type="file"
                  accept="audio/*"
                  hidden
                  onChange={e => { const f = e.target.files?.[0]; if (f) upload(slot, f) }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <ManualNote topic="theme-cut" />
      <ManualNote topic="freeze-assembly" />
      <ManualNote topic="reverse-reverb" />
    </div>
  )
}
