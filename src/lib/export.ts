import { GAIN_TABLE, type GainRole } from './types'
import type { Clip } from './player'

const dbToGain = (db: number) => Math.pow(10, db / 20)
const DUCK_RAMP_S = 0.18
const DUCK_LEAD_S = 0.12

export type StemName = 'voice' | 'music' | 'effects'

function stemOf(role: Exclude<GainRole, 'auto'>): StemName {
  if (role === 'voice') return 'voice'
  if (role === 'bed' || role === 'theme') return 'music'
  return 'effects'
}

function voiceWindows(clips: Clip[]): [number, number][] {
  const raw = clips
    .filter(c => c.role === 'voice')
    .map(c => [c.startMs / 1000, (c.startMs + c.durationMs) / 1000] as [number, number])
    .sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const w of raw) {
    const last = merged[merged.length - 1]
    if (last && w[0] - last[1] < 0.6) last[1] = Math.max(last[1], w[1])
    else merged.push([...w])
  }
  return merged
}

/**
 * Renders a set of clips offline. Faster than real time and sample accurate, which is why
 * the mix that comes out is exactly what you heard in the transport.
 */
async function render(
  clips: Clip[],
  buffers: Map<string, AudioBuffer>,
  totalMs: number,
  duckDb: number,
  sampleRate = 44100,
): Promise<AudioBuffer> {
  const length = Math.ceil((totalMs / 1000 + 3) * sampleRate)
  const ctx = new OfflineAudioContext(2, length, sampleRate)
  const windows = voiceWindows(clips)

  for (const clip of clips) {
    const buffer = buffers.get(clip.url)
    if (!buffer) continue

    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gain = ctx.createGain()
    const base = dbToGain(GAIN_TABLE[clip.role])
    const ducks = clip.role === 'bed' || clip.role === 'ambience'
    const at = clip.startMs / 1000

    if (!ducks) {
      gain.gain.value = base
    } else {
      const ducked = dbToGain(GAIN_TABLE[clip.role] - duckDb + 8)
      gain.gain.setValueAtTime(base, 0)
      for (const [ws, we] of windows) {
        const inAt = Math.max(ws - DUCK_LEAD_S, 0)
        gain.gain.setValueAtTime(base, Math.max(inAt - 0.01, 0))
        gain.gain.linearRampToValueAtTime(ducked, inAt + DUCK_RAMP_S)
        gain.gain.setValueAtTime(ducked, Math.max(we, inAt + DUCK_RAMP_S + 0.01))
        gain.gain.linearRampToValueAtTime(base, we + DUCK_RAMP_S * 2)
      }
    }

    src.connect(gain).connect(ctx.destination)
    src.start(at)
  }

  return ctx.startRendering()
}

/** Integrated loudness, close enough to LUFS for a normalization target. */
function measureLufs(buffer: AudioBuffer): number {
  let sum = 0
  let count = 0
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i += 8) { sum += data[i] * data[i]; count++ }
  }
  const rms = Math.sqrt(sum / Math.max(count, 1))
  return 20 * Math.log10(Math.max(rms, 1e-9)) - 0.691
}

function applyGain(buffer: AudioBuffer, gain: number) {
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i++) {
      const v = data[i] * gain
      data[i] = v > 1 ? 1 : v < -1 ? -1 : v   // hard ceiling, no compression
    }
  }
}

export function toWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  const bytes = 44 + frames * channels * 2
  const view = new DataView(new ArrayBuffer(bytes))

  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  text(0, 'RIFF')
  view.setUint32(4, bytes - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, frames * channels * 2, true)

  let offset = 44
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}

export interface ExportResult {
  mix: Blob
  stems: Record<StemName, Blob>
  lufsBefore: number
  lufsAfter: number
  project: string
  cues: string
}

/**
 * Builds a Reaper project file. Every clip lands on its own track at the exact position
 * it holds here, so the fine work can start without rebuilding anything.
 */
function reaperProject(clips: Clip[], names: Map<string, string>, title: string): string {
  const lanes: Record<StemName, Clip[]> = { voice: [], music: [], effects: [] }
  for (const c of clips) lanes[stemOf(c.role)].push(c)

  const tracks = (Object.keys(lanes) as StemName[]).map(lane => {
    const items = lanes[lane].map(c => {
      const file = names.get(c.id) ?? `${c.id}.mp3`
      return `    <ITEM
      POSITION ${(c.startMs / 1000).toFixed(4)}
      LENGTH ${(c.durationMs / 1000).toFixed(4)}
      NAME "${file}"
      VOLPAN ${dbToGain(GAIN_TABLE[c.role]).toFixed(4)} 0 1 -1
      <SOURCE MP3
        FILE "audio/${file}"
      >
    >`
    }).join('\n')
    return `  <TRACK
    NAME "${lane}"
    VOLPAN 1 0 -1 -1 1
${items}
  >`
  }).join('\n')

  return `<REAPER_PROJECT 0.1 "7.0"
  TEMPO 120 4 4
  NAME "${title}"
${tracks}
>
`
}

/** A plain text cue sheet, for anyone who does not use Reaper. */
function cueSheet(clips: Clip[], names: Map<string, string>, title: string): string {
  const fmt = (ms: number) => {
    const t = ms / 1000
    const m = Math.floor(t / 60)
    const s = (t % 60).toFixed(2).padStart(5, '0')
    return `${String(m).padStart(2, '0')}:${s}`
  }
  const rows = [...clips]
    .sort((a, b) => a.startMs - b.startMs)
    .map(c => [
      fmt(c.startMs),
      fmt(c.startMs + c.durationMs),
      stemOf(c.role).padEnd(7),
      `${GAIN_TABLE[c.role] >= 0 ? '+' : ''}${GAIN_TABLE[c.role]} dB`.padEnd(8),
      names.get(c.id) ?? c.id,
    ].join('  '))
  return `${title}\nstart      end        lane     level     file\n${rows.join('\n')}\n`
}

export async function exportEpisode(opts: {
  clips: Clip[]
  buffers: Map<string, AudioBuffer>
  names: Map<string, string>
  totalMs: number
  duckDb: number
  targetLufs: number
  title: string
  onStep?: (label: string) => void
}): Promise<ExportResult> {
  const { clips, buffers, names, totalMs, duckDb, targetLufs, title, onStep } = opts

  onStep?.('Rendering the mix')
  const full = await render(clips, buffers, totalMs, duckDb)
  const lufsBefore = measureLufs(full)
  applyGain(full, dbToGain(targetLufs - lufsBefore))
  const lufsAfter = measureLufs(full)

  const stems = {} as Record<StemName, Blob>
  for (const lane of ['voice', 'music', 'effects'] as StemName[]) {
    onStep?.(`Rendering the ${lane} stem`)
    const subset = clips.filter(c => stemOf(c.role) === lane)
    const rendered = await render(subset, buffers, totalMs, duckDb)
    applyGain(rendered, dbToGain(targetLufs - lufsBefore))
    stems[lane] = toWav(rendered)
  }

  onStep?.('Writing the project file')
  return {
    mix: toWav(full),
    stems,
    lufsBefore,
    lufsAfter,
    project: reaperProject(clips, names, title),
    cues: cueSheet(clips, names, title),
  }
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
