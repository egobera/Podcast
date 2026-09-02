import { GAIN_TABLE, type GainRole } from './types'

export type Lane = 'voice' | 'music' | 'effects'
export const LANES: Lane[] = ['voice', 'music', 'effects']

export interface Clip {
  id: string
  url: string
  startMs: number
  durationMs: number
  role: Exclude<GainRole, 'auto'>
  anchor: 'line' | 'scene'
}

export function laneOf(role: Exclude<GainRole, 'auto'>): Lane {
  if (role === 'voice') return 'voice'
  if (role === 'bed' || role === 'theme') return 'music'
  return 'effects'
}

export type Monitor = 'studio' | 'phone'

const dbToGain = (db: number) => Math.pow(10, db / 20)
const DUCK_RAMP_S = 0.18
const DUCK_LEAD_S = 0.12

/**
 * Plays the episode the way the listener will hear it.
 *
 * Clips route through one bus per lane so a lane can be muted or soloed without
 * touching anything else, and the whole mix passes through a monitor chain that can
 * imitate a phone speaker. Most of this audience listens in a car on a phone, and a mix
 * that only works on good headphones is a mix that has not been checked.
 */
export class EpisodePlayer {
  private ctx: AudioContext | null = null
  private buses = new Map<Lane, GainNode>()
  private master: GainNode | null = null
  private monitorIn: AudioNode | null = null
  private buffers = new Map<string, AudioBuffer>()
  private peaks = new Map<string, Float32Array>()
  private sources: AudioBufferSourceNode[] = []
  private startedAt = 0
  private offsetMs = 0
  private clips: Clip[] = []
  private muted = new Set<Lane>()
  private soloed = new Set<Lane>()
  playing = false

  constructor(private duckDb: number) {}

  private ensureGraph() {
    if (this.ctx) return
    const ctx = new AudioContext()
    this.ctx = ctx

    const master = ctx.createGain()
    this.master = master

    // Monitor chain. Studio is a straight wire; phone squeezes the band and thins the bass.
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'; hp.frequency.value = 20
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'; lp.frequency.value = 20000
    const presence = ctx.createBiquadFilter()
    presence.type = 'peaking'; presence.frequency.value = 2000; presence.gain.value = 0; presence.Q.value = 1
    hp.connect(lp).connect(presence).connect(master).connect(ctx.destination)
    this.monitorIn = hp
    this.filters = { hp, lp, presence }

    for (const lane of LANES) {
      const bus = ctx.createGain()
      bus.connect(hp)
      this.buses.set(lane, bus)
    }
  }

  private filters!: { hp: BiquadFilterNode; lp: BiquadFilterNode; presence: BiquadFilterNode }

  setMonitor(mode: Monitor) {
    this.ensureGraph()
    const { hp, lp, presence } = this.filters
    if (mode === 'phone') {
      hp.frequency.value = 420
      lp.frequency.value = 4200
      presence.gain.value = 4
    } else {
      hp.frequency.value = 20
      lp.frequency.value = 20000
      presence.gain.value = 0
    }
  }

  setLaneState(muted: Set<Lane>, soloed: Set<Lane>) {
    this.muted = new Set(muted)
    this.soloed = new Set(soloed)
    this.applyLaneGains()
  }

  private applyLaneGains() {
    if (!this.ctx) return
    for (const lane of LANES) {
      const bus = this.buses.get(lane)
      if (!bus) continue
      const silencedBySolo = this.soloed.size > 0 && !this.soloed.has(lane)
      const on = !this.muted.has(lane) && !silencedBySolo
      bus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02)
    }
  }

  async prepare(clips: Clip[], onProgress?: (done: number, total: number) => void) {
    this.ensureGraph()
    this.clips = clips
    const needed = clips.filter(c => !this.buffers.has(c.url))
    let done = 0
    onProgress?.(0, needed.length)

    const queue = [...needed]
    const workers = Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const clip = queue.shift()
        if (!clip) break
        try {
          const res = await fetch(clip.url)
          const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer())
          this.buffers.set(clip.url, buf)
          this.peaks.set(clip.url, extractPeaks(buf, 240))
        } catch {
          // A clip that will not decode is skipped rather than breaking the mix.
        }
        onProgress?.(++done, needed.length)
      }
    })
    await Promise.all(workers)
    this.applyLaneGains()
  }

  /** Normalized peak envelope for drawing a waveform, or null if not decoded yet. */
  peaksFor(url: string) { return this.peaks.get(url) ?? null }
  get decoded() { return this.buffers.size > 0 }

  bufferMap() { return this.buffers }

  private voiceWindows(): [number, number][] {
    const raw = this.clips
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

  play(fromMs = 0) {
    this.ensureGraph()
    const ctx = this.ctx!
    this.stopSources()
    if (ctx.state === 'suspended') ctx.resume()

    this.offsetMs = fromMs
    const t0 = ctx.currentTime + 0.08
    this.startedAt = t0
    const windows = this.voiceWindows()
    const fromS = fromMs / 1000

    for (const clip of this.clips) {
      const buffer = this.buffers.get(clip.url)
      if (!buffer) continue
      const clipStart = clip.startMs / 1000
      if (clipStart + buffer.duration <= fromS) continue

      const src = ctx.createBufferSource()
      src.buffer = buffer

      const gain = ctx.createGain()
      const base = dbToGain(GAIN_TABLE[clip.role])
      const ducks = clip.role === 'bed' || clip.role === 'ambience'

      if (!ducks) {
        gain.gain.value = base
      } else {
        const ducked = dbToGain(GAIN_TABLE[clip.role] - this.duckDb + 8)
        gain.gain.setValueAtTime(base, t0)
        for (const [ws, we] of windows) {
          if (we < fromS) continue
          const inAt = t0 + Math.max(ws - fromS, 0) - DUCK_LEAD_S
          const outAt = t0 + Math.max(we - fromS, 0)
          if (inAt > t0) gain.gain.setValueAtTime(base, Math.max(inAt - 0.01, t0))
          gain.gain.linearRampToValueAtTime(ducked, Math.max(inAt + DUCK_RAMP_S, t0 + 0.01))
          gain.gain.setValueAtTime(ducked, Math.max(outAt, t0 + 0.02))
          gain.gain.linearRampToValueAtTime(base, Math.max(outAt + DUCK_RAMP_S * 2, t0 + 0.03))
        }
      }

      src.connect(gain).connect(this.buses.get(laneOf(clip.role))!)
      src.start(t0 + Math.max(clipStart - fromS, 0), Math.max(fromS - clipStart, 0))
      this.sources.push(src)
    }

    this.playing = true
  }

  pause() {
    this.offsetMs = this.currentMs
    this.stopSources()
    this.playing = false
  }

  seek(ms: number) {
    this.offsetMs = ms
    if (this.playing) this.play(ms)
  }

  get currentMs() {
    if (!this.ctx || !this.playing) return this.offsetMs
    return this.offsetMs + (this.ctx.currentTime - this.startedAt) * 1000
  }

  private stopSources() {
    for (const s of this.sources) { try { s.stop() } catch { /* ended */ } }
    this.sources = []
  }

  destroy() {
    this.stopSources()
    this.ctx?.close()
    this.ctx = null
    this.buffers.clear()
    this.peaks.clear()
    this.buses.clear()
  }
}

/** Reduces a buffer to a small envelope, enough to draw a clip a few pixels tall. */
export function extractPeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const data = buffer.getChannelData(0)
  const size = Math.max(1, Math.floor(data.length / buckets))
  const out = new Float32Array(buckets)
  let max = 0
  for (let i = 0; i < buckets; i++) {
    let peak = 0
    const from = i * size
    for (let j = from; j < from + size && j < data.length; j += 2) {
      const v = data[j] < 0 ? -data[j] : data[j]
      if (v > peak) peak = v
    }
    out[i] = peak
    if (peak > max) max = peak
  }
  if (max > 0) for (let i = 0; i < buckets; i++) out[i] /= max
  return out
}
