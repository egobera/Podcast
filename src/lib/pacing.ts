/**
 * How much air goes between two things.
 *
 * Everything used to be butted end to end, which is why an episode sounded like separate
 * recordings played in order. Real dialogue breathes, and it does not breathe evenly: a
 * different speaker needs more room than the same one continuing, a question needs more
 * than a statement, and a scene change needs more than either.
 *
 * These are the defaults. An episode can override any of them, and a single element can
 * be nudged with its own offset.
 */
export interface Pacing {
  /** Same character carrying on. */
  sameSpeaker: number
  /** One character answering another. */
  turn: number
  /** After a question. Somebody has to take it in. */
  afterQuestion: number
  /** After a line that trails off. */
  afterEllipsis: number
  /** Between scenes. */
  sceneChange: number
  /** Between a spot effect and whatever follows it. */
  afterEffect: number
  /** How far a spot effect slides under the line before it. Negative means overlap. */
  effectOverlap: number
  /** How far a music bed starts before the line it belongs to. Negative means earlier. */
  musicLead: number
}

export const DEFAULT_PACING: Pacing = {
  sameSpeaker: 140,
  turn: 300,
  afterQuestion: 420,
  afterEllipsis: 520,
  sceneChange: 900,
  afterEffect: 180,
  effectOverlap: -220,
  musicLead: -1800,
}

export function pacingFor(episode: { pacing?: Record<string, number> | null }): Pacing {
  return { ...DEFAULT_PACING, ...(episode.pacing ?? {}) }
}

/** Only the parts of an element that affect rhythm, loosely typed so the layout engine
 *  can pass plain shapes without casting. */
interface Placeable {
  kind: string
  character_id: string | null
  text_content: string
  scene: string
}

/** The gap that belongs after one element, before the next one starts. */
export function gapAfter(el: Placeable, next: Placeable | undefined, p: Pacing): number {
  if (!next) return 0
  if (el.kind === 'pause' || next.kind === 'pause') return 0

  if (el.scene !== next.scene) return p.sceneChange

  if (el.kind === 'sfx') return p.afterEffect

  // An effect coming next brings its own overlap, so it should not also wait for a turn.
  if (next.kind === 'sfx') return 0

  if (el.kind !== 'dialogue') return 0

  const text = el.text_content.trim()
  if (/\.\.\.$|…$/.test(text)) return p.afterEllipsis
  if (/\?$|\?»?$/.test(text)) return p.afterQuestion

  if (next.kind === 'dialogue') {
    return el.character_id && el.character_id === next.character_id ? p.sameSpeaker : p.turn
  }
  return p.turn
}

/**
 * Where an element starts relative to where the cursor sits.
 * A spot effect slides back under the line before it, because a doorbell that waits for
 * someone to stop talking sounds like a doorbell in a different room.
 */
export function leadFor(el: Placeable, p: Pacing): number {
  if (el.kind === 'sfx') return p.effectOverlap
  // Music that waits for a line to end announces itself. It should already be there.
  if (el.kind === 'music') return p.musicLead
  return 0
}

/** No rhythm at all. Used to test the placement itself, apart from the pacing on top. */
export const NO_PACING: Pacing = {
  sameSpeaker: 0, turn: 0, afterQuestion: 0, afterEllipsis: 0,
  sceneChange: 0, afterEffect: 0, effectOverlap: 0, musicLead: 0,
}
