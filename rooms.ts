/**
 * The room everything is standing in.
 *
 * The clearest tell that audio was assembled rather than recorded is that every voice is
 * dry, centred and at the same distance. Nothing recorded sounds like that, because a real
 * recording happens somewhere, and that somewhere is audible in every source at once,
 * including the glass that breaks.
 *
 * The impulse responses are generated rather than shipped. A convolution reverb normally
 * needs a recording of a real space; building one from shaped noise gets close enough for
 * speech, costs nothing to download, and can be tuned per scene from a few numbers.
 */

export interface Room {
  id: string
  name: string
  /** Seconds of tail. The single number the ear reads as "size". */
  decay: number
  /** How bright the tail stays. Small rooms eat the top; caves keep it. */
  damping: number
  /** Milliseconds before the first reflection returns. Distance to the nearest wall. */
  preDelay: number
  /** How much room sits in the mix before distance is applied. */
  wet: number
}

export const ROOMS: Room[] = [
  { id: 'none', name: 'No room', decay: 0, damping: 1, preDelay: 0, wet: 0 },
  { id: 'bedroom', name: 'Small bedroom', decay: 0.38, damping: 0.42, preDelay: 7, wet: 0.16 },
  { id: 'living', name: 'Living room', decay: 0.62, damping: 0.5, preDelay: 11, wet: 0.2 },
  { id: 'kitchen', name: 'Kitchen, hard surfaces', decay: 0.75, damping: 0.72, preDelay: 9, wet: 0.24 },
  { id: 'hall', name: 'Hallway', decay: 1.1, damping: 0.55, preDelay: 14, wet: 0.28 },
  { id: 'outdoors', name: 'Outdoors', decay: 0.22, damping: 0.3, preDelay: 22, wet: 0.09 },
  { id: 'cavern', name: 'Somewhere enormous', decay: 3.4, damping: 0.68, preDelay: 34, wet: 0.42 },
  { id: 'underwater', name: 'Under water', decay: 1.9, damping: 0.18, preDelay: 18, wet: 0.5 },
]

export const roomById = (id: string | null | undefined) =>
  ROOMS.find(r => r.id === id) ?? ROOMS[1]

/**
 * A room, built out of noise.
 *
 * Decaying noise is most of what a real impulse response is, once the first reflections
 * have passed. Those early reflections are added by hand as a handful of discrete spikes,
 * because they are what the ear uses to judge size and pure noise has none of them.
 */
export function buildImpulse(ctx: BaseAudioContext, room: Room): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.max(Math.floor(rate * Math.max(room.decay, 0.05)), 64)
  const buffer = ctx.createBuffer(2, length, rate)
  const pre = Math.floor((room.preDelay / 1000) * rate)

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)

    for (let i = pre; i < length; i++) {
      const t = (i - pre) / Math.max(length - pre, 1)
      const envelope = Math.pow(1 - t, 2.4)
      // Damping rolls the top off as the tail decays, the way air and soft surfaces do.
      const brightness = Math.pow(room.damping, t * 3)
      data[i] = (Math.random() * 2 - 1) * envelope * brightness * 0.55
    }

    // Early reflections, offset per channel so the room has width.
    const spread = channel === 0 ? 1 : 1.17
    for (let r = 0; r < 6; r++) {
      const at = Math.floor(pre + (r + 1) * (room.preDelay / 1000) * rate * 0.7 * spread)
      if (at > 0 && at < length) {
        data[at] += (0.5 - r * 0.07) * (Math.random() > 0.5 ? 1 : -1)
      }
    }
  }

  return buffer
}

/**
 * How far away somebody is.
 *
 * Distance is not volume. Something further away is quieter, darker, and has more room in
 * it relative to direct sound. Move one without the others and it just sounds turned down.
 */
export interface Distance {
  id: string
  name: string
  gainDb: number
  /** Low pass cutoff in hertz. Air and walls eat the top first. */
  cutoff: number
  /** Multiplies the room's own wet amount. */
  wet: number
}

export const DISTANCES: Distance[] = [
  { id: 'close', name: 'Close to the mic', gainDb: 1, cutoff: 18000, wet: 0.4 },
  { id: 'normal', name: 'In the room', gainDb: 0, cutoff: 12000, wet: 1 },
  { id: 'far', name: 'Across the room', gainDb: -6, cutoff: 6000, wet: 1.9 },
  { id: 'offstage', name: 'Another room', gainDb: -11, cutoff: 3200, wet: 2.6 },
]

export const distanceById = (id: string | null | undefined) =>
  DISTANCES.find(d => d.id === id) ?? DISTANCES[1]

/**
 * Words a script already uses to say where somebody is.
 *
 * "Desde la cocina" and "en off" are blocking, and blocking is distance. The script has
 * been carrying this information all along; nothing was listening to it.
 */
export function distanceFromDirection(direction: string): string | null {
  const d = direction.toLowerCase()
  if (/\ben off\b|\bdesde (la|el) \w+|\bdesde afuera|\bdesde fuera|\botra habitaci[óo]n/.test(d)) {
    return 'offstage'
  }
  if (/\bdesde (el )?pasillo|\bde lejos|\blejos\b|\bal fondo\b/.test(d)) return 'far'
  if (/\bmuy bajito|\bsusurr|\bal o[íi]do|\bmuy cerca/.test(d)) return 'close'
  return null
}

/**
 * The last thing a mix engineer does, and the reason a record sounds like one thing.
 *
 * Gentle compression across everything makes sources recorded in different places share a
 * dynamic, and a touch of saturation adds the harmonic grit that tape and preamps add to
 * anything that passes through them. Neither is audible on its own; together they are most
 * of what "produced" means.
 */
export function buildGlue(ctx: BaseAudioContext) {
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -18
  compressor.knee.value = 24
  compressor.ratio.value = 2.2
  compressor.attack.value = 0.02
  compressor.release.value = 0.25

  const saturation = ctx.createWaveShaper()
  const curve = new Float32Array(1024)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    // Soft clipping. Gentle enough that it colours rather than distorts.
    curve[i] = Math.tanh(x * 1.35) / Math.tanh(1.35)
  }
  saturation.curve = curve
  saturation.oversample = '2x'

  const makeup = ctx.createGain()
  makeup.gain.value = 1.08

  compressor.connect(saturation).connect(makeup)
  return { input: compressor, output: makeup }
}

/**
 * Timing that is not exact.
 *
 * The pacing engine places every gap to the millisecond, which is precisely what a person
 * never does. A small deterministic wobble on each gap reads as human immediately. It has
 * to be deterministic, or the episode moves under you every time it redraws.
 */
export function humanise(elementId: string, gapMs: number, amount = 0.14): number {
  if (gapMs <= 0 || amount <= 0) return gapMs
  let hash = 0
  for (let i = 0; i < elementId.length; i++) {
    hash = (hash * 31 + elementId.charCodeAt(i)) | 0
  }
  // A stable number between -1 and 1 for this element.
  const wobble = ((hash % 1000) / 1000) * 2 - 1
  return Math.max(Math.round(gapMs * (1 + wobble * amount)), 0)
}
