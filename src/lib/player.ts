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
  /** Per clip trim, in dB, on top of whatever its role gives it. */
  gainDb?: number
  /** Silence at the head of the file, skipped rather than played. */
  leadMs?: number
  /** Loops for as long as the episode lasts. Used for room tone. */
  loop?: boolean
  loopUntilMs?: number
  /** Deliberate fades, in milliseconds. Undefined means the short automatic one. */
  fadeInMs?: number
  fadeOutMs?: number
}

/*
 * Every clip is faded in and out.
 *
 * Butting audio against audio produces a click at the seam, and 150 of those clicks is
 * what "se escucha el corte de voz" sounds like. Twelve milliseconds is short enough that
 * nobody hears a fade and long enough that nobody hears a click. Music gets much longer
 * ones, because a bed that starts at full level announces itself.
 */
const FADE_IN = 0.012
const FADE_OUT = 0.035
const BED_FADE = 1.2

/**
 * Where the sound actually starts and stops inside a file.
 *
 * Generated speech arrives wrapped in a moment of near silence at each end. Played as is,
 * every line sits in its own little pocket of nothing and the episode stops feeling like a
 * conversation. This finds the real edges so they can be skipped.
 */
export function findEdges(buffer: AudioBuffer, floorDb = -45): { lead: number; tail: number } {
  const data = buffer.getChannelData(0)
  const floor = Math.pow(10, floorDb / 20)
  const step = Math.max(1, Math.floor(buffer.sampleRate / 1000)) // one millisecond

  let lead = 0
  for (let i = 0; i < data.length; i += step) {
    if (Math.abs(data[i]) > floor) { lead = i / buffer.sampleRate; break }
  }

  let tail = 0
  for (let i = data.length - 1; i >= 0; i -= step) {
    if (Math.abs(data[i]) > floor) { tail = (data.length - 1 - i) / buffer.sampleRate; break }
  }

  // Leave a breath at each edge rather than clipping the first consonant.
  return {
    lead: Math.max(lead - 0.03, 0),
    tail: Math.max(tail - 0.05, 0),
  }
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

  private laneGain: Record<string, number> = {}

  setLaneState(muted: Set<Lane>, soloed: Set<Lane>, gains: Record<string, number> = {}) {
    this.muted = new Set(muted)
    this.soloed = new Set(soloed)
    this.laneGain = gains
    this.applyLaneGains()
  }

  private applyLaneGains() {
    if (!this.ctx) return
    for (const lane of LANES) {
      const bus = this.buses.get(lane)
      if (!bus) continue
      const silencedBySolo = this.soloed.size > 0 && !this.soloed.has(lane)
      const on = !this.muted.has(lane) && !silencedBySolo
      const trim = dbToGain(this.laneGain[lane] ?? 0)
      bus.gain.setTargetAtTime(on ? trim : 0, this.ctx.currentTime, 0.02)
    }
  }

  /**
   * Decodes everything, and reports what it found.
   *
   * Until a take is approved its duration is a guess from the word count, so a freshly
   * generated episode plays with every line in slightly the wrong place. The buffers are
   * already here; measuring them is free, and it is the difference between a timeline
   * built on arithmetic and one built on the audio.
   */
  async prepare(
    clips: Clip[],
    onProgress?: (done: number, total: number) => void,
    onMeasured?: (measurements: { id: string; durationMs: number; leadMs: number; tailMs: number }[]) => void,
  ) {
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

    if (onMeasured) {
      const measured = clips.flatMap(clip => {
        const buffer = this.buffers.get(clip.url)
        if (!buffer) return []
        const edges = findEdges(buffer)
        return [{
          id: clip.id,
          durationMs: Math.round(buffer.duration * 1000),
          leadMs: Math.round(edges.lead * 1000),
          tailMs: Math.round(edges.tail * 1000),
        }]
      })
      onMeasured(measured)
    }
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
      if (clip.loop) src.loop = true

      const gain = ctx.createGain()
      const offset = clip.gainDb ?? 0
      const base = dbToGain(GAIN_TABLE[clip.role] + offset)
      const ducks = clip.role === 'bed' || clip.role === 'ambience'
      const isMusic = clip.role === 'bed' || clip.role === 'theme'

      if (!ducks) {
        gain.gain.value = base
      } else {
        const ducked = dbToGain(GAIN_TABLE[clip.role] + offset - this.duckDb + 8)
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

      const when = t0 + Math.max(clipStart - fromS, 0)
      const into = Math.max(fromS - clipStart, 0) + (clip.leadMs ?? 0) / 1000

      /*
       * A bed stops when its slot ends.
       *
       * The whole file used to be scheduled regardless, so a two minute theme dropped into
       * a fifteen second opening carried on underneath the first scene. Speech is left
       * alone: cutting a line at an arbitrary point would clip a word, and the fix for a
       * line that runs long is to correct its length, not to truncate it mid sentence.
       */
      const bounded = clip.role === 'bed' || clip.role === 'ambience' || clip.role === 'theme'
      const slot = clip.durationMs / 1000
      const playFor = bounded && slot > 0.2
        ? Math.min(Math.max(buffer.duration - into, 0), slot)
        : Math.max(buffer.duration - into, 0)

      // Fade both edges so nothing clicks, and give music long enough fades to arrive.
      const fadeIn = clip.fadeInMs !== undefined ? clip.fadeInMs / 1000 : isMusic ? BED_FADE : FADE_IN
      const fadeOut = clip.fadeOutMs !== undefined ? clip.fadeOutMs / 1000 : isMusic ? BED_FADE : FADE_OUT
      const target = gain.gain.value || base
      gain.gain.setValueAtTime(0.0001, when)
      gain.gain.exponentialRampToValueAtTime(Math.max(target, 0.0002), when + fadeIn)
      if (playFor > fadeIn + fadeOut) {
        gain.gain.setValueAtTime(Math.max(target, 0.0002), when + playFor - fadeOut)
        gain.gain.exponentialRampToValueAtTime(0.0001, when + playFor)
      }

      src.start(when, into)
      if (clip.loop && clip.loopUntilMs) {
        src.stop(t0 + Math.max(clip.loopUntilMs / 1000 - fromS, 0))
      } else if (bounded && slot > 0.2 && playFor < buffer.duration - into) {
        src.stop(when + playFor)
      }
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
