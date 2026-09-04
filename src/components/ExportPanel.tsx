import { useState } from 'react'
import { exportEpisode, download, type ExportResult } from '../lib/export'
import { EpisodePlayer, type Clip } from '../lib/player'
import { formatMs } from '../lib/parser'
import { Modal, useToast } from './ui'
import ManualNote from './ManualNote'
import type { AudioElement, Episode, Project } from '../lib/types'

export interface Check { level: 'stop' | 'warn'; text: string }

/** Everything worth catching before an episode leaves the building. */
export function runChecks(
  elements: (AudioElement & { start_ms: number })[],
  episode: Episode,
  total: number,
): Check[] {
  const out: Check[] = []

  const unapproved = elements.filter(e => e.kind !== 'pause' && e.status !== 'approved')
  if (unapproved.length) {
    out.push({
      level: 'stop',
      text: `${unapproved.length} ${unapproved.length === 1 ? 'element has' : 'elements have'} no approved audio. They will be silent.`,
    })
  }

  if (total < episode.target_min_ms) {
    out.push({ level: 'warn', text: `Runs ${formatMs(episode.target_min_ms - total)} shorter than your target.` })
  }
  if (total > episode.target_max_ms) {
    out.push({ level: 'warn', text: `Runs ${formatMs(total - episode.target_max_ms)} longer than your target.` })
  }

  const voices = elements.filter(e => e.gain_role === 'voice' && e.status === 'approved')
    .sort((a, b) => a.start_ms - b.start_ms)
  for (let i = 1; i < voices.length; i++) {
    const gap = voices[i].start_ms - (voices[i - 1].start_ms + voices[i - 1].duration_ms)
    if (gap < -400) {
      out.push({ level: 'warn', text: `Two lines overlap around ${formatMs(voices[i].start_ms)}.` })
      break
    }
  }

  const beds = elements.filter(e => e.gain_role === 'bed' && e.anchor === 'line')
  if (beds.length) {
    out.push({
      level: 'warn',
      text: `${beds.length} music ${beds.length === 1 ? 'bed is' : 'beds are'} set to push the timeline. Beds usually sit under a scene instead.`,
    })
  }

  const orphanBlocks = elements.filter(e => e.block_role === 'entry' &&
    !elements.some(x => x.block_id === e.block_id && x.block_role === 'return'))
  if (orphanBlocks.length) {
    out.push({ level: 'stop', text: 'A freeze block has an entry with no return.' })
  }

  return out
}

export default function ExportPanel({
  project, episode, elements, total, buildClips, onClose,
}: {
  project: Project
  episode: Episode
  elements: (AudioElement & { start_ms: number })[]
  total: number
  buildClips: () => Promise<Clip[]>
  onClose: () => void
}) {
  const [step, setStep] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExportResult | null>(null)
  const toast = useToast()

  const checks = runChecks(elements, episode, total)
  const blocking = checks.filter(c => c.level === 'stop')
  const slug = episode.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  async function run() {
    setBusy(true)
    try {
      setStep('Collecting audio')
      const clips = await buildClips()
      if (clips.length === 0) { toast('Nothing approved to export yet.', 'bad'); return }

      const player = new EpisodePlayer(project.music_duck_db)
      let done = 0
      await player.prepare(clips, (d, t) => { done = d; setStep(`Downloading ${d} of ${t}`) })
      void done

      // Decode once here so the render and the transport use the same buffers.
      const buffers = new Map<string, AudioBuffer>()
      const ctx = new AudioContext()
      const seen = new Set<string>()
      for (const c of clips) {
        if (seen.has(c.url)) continue
        seen.add(c.url)
        try {
          const res = await fetch(c.url)
          buffers.set(c.url, await ctx.decodeAudioData(await res.arrayBuffer()))
        } catch { /* skipped */ }
      }
      await ctx.close()
      player.destroy()

      const names = new Map(elements.map(e => [
        e.id,
        `${String(e.idx).padStart(7, '0')}-${(e.text_content || 'clip').slice(0, 26)
          .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.mp3`,
      ]))

      const out = await exportEpisode({
        clips, buffers, names, totalMs: total,
        duckDb: project.music_duck_db,
        targetLufs: project.mix_target_lufs,
        title: `${project.name} — ${episode.title}`,
        onStep: setStep,
      })
      setResult(out)
      toast(`Mix ready. Normalized to ${out.lufsAfter.toFixed(1)} LUFS.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'bad')
    } finally {
      setBusy(false)
      setStep('')
    }
  }

  return (
    <Modal
      title="Export episode"
      onClose={onClose}
      footer={
        result ? (
          <button className="btn" data-variant="primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button className="btn" data-variant="quiet" onClick={onClose}>Cancel</button>
            <button className="btn" data-variant="primary" disabled={busy} onClick={run}>
              {busy ? step || 'Working' : blocking.length ? 'Export anyway' : 'Export'}
            </button>
          </>
        )
      }
    >
      {!result && (
        <>
          {checks.length === 0 ? (
            <p>Nothing to flag. {formatMs(total)}, everything approved.</p>
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
          <p className="notice" style={{ marginTop: 12 }}>
            The mix is normalized to {project.mix_target_lufs} LUFS, the Spotify and Apple reference.
            Rendering happens in this tab, so leave it open.
          </p>
        </>
      )}

      {result && (
        <>
          <p>
            {formatMs(total)} · measured {result.lufsBefore.toFixed(1)} LUFS,
            delivered at {result.lufsAfter.toFixed(1)}.
          </p>
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <button className="btn" data-variant="primary"
              onClick={() => download(result.mix, `${slug}.wav`)}>
              Mix
            </button>
            <button className="btn" onClick={() => download(result.stems.voice, `${slug}-voice.wav`)}>Voice stem</button>
            <button className="btn" onClick={() => download(result.stems.music, `${slug}-music.wav`)}>Music stem</button>
            <button className="btn" onClick={() => download(result.stems.effects, `${slug}-effects.wav`)}>Effects stem</button>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => download(
              new Blob([result.project], { type: 'text/plain' }), `${slug}.rpp`)}>
              Reaper project
            </button>
            <button className="btn" onClick={() => download(
              new Blob([result.cues], { type: 'text/plain' }), `${slug}-cues.txt`)}>
              Cue sheet
            </button>
          </div>
          <ManualNote topic="mastering" />
        </>
      )}
    </Modal>
  )
}
