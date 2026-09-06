import type { AudioElement, Character } from './types'

/**
 * Colour, so a timeline can be read rather than decoded.
 *
 * Anonymous rectangles tell you where sound exists and nothing else. Giving each character
 * a hue turns the voice lane into the shape of the conversation: you can see who talks
 * most, where somebody goes quiet, where two people trade quickly, all before reading a
 * word.
 *
 * The hues are spread far enough apart to stay distinct on a dark background, and they
 * skip the reds, which belong to the playhead and to anything wrong.
 */
const VOICES = [
  '#4d9de0', // blue
  '#e0994d', // amber
  '#5fc9a0', // green
  '#b07fd8', // violet
  '#e0c14d', // sand
  '#5fb8c9', // teal
  '#d88fa8', // rose
  '#8fa8d8', // slate blue
]

const KINDS: Record<string, string> = {
  music: '#7b7fd4',
  ambience: '#4fa89b',
  sfx: '#8ea3b8',
  pause: '#4a5a6b',
}

/** Stable per project: the same character keeps its colour between sessions. */
export function voiceColour(characterId: string | null, characters: Character[]): string {
  if (!characterId) return KINDS.sfx
  const i = characters.findIndex(c => c.id === characterId)
  return VOICES[(i < 0 ? 0 : i) % VOICES.length]
}

export function colourFor(el: AudioElement, characters: Character[]): string {
  if (el.kind === 'dialogue') return voiceColour(el.character_id, characters)
  return KINDS[el.kind] ?? KINDS.sfx
}

/** A dimmer version of the same colour, for the body of a clip behind its waveform. */
export function dim(hex: string, amount = 0.4): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * amount)
  const g = Math.round(((n >> 8) & 255) * amount)
  const b = Math.round((n & 255) * amount)
  return `rgb(${r} ${g} ${b})`
}

/** The label a clip carries. Short enough to fit, specific enough to identify. */
export function labelFor(el: AudioElement, characters: Character[]): string {
  if (el.kind === 'pause') return 'silence'
  if (el.kind === 'dialogue') {
    const who = characters.find(c => c.id === el.character_id)?.name ?? 'Voice'
    return `${who}  ${el.text_content}`
  }
  // Sound cues carry their label in the text; the label is noise on a clip.
  return el.text_content.replace(/^(m[úu]sica|ambiente|sonido|efecto)\s*[·:-]\s*/i, '')
}
