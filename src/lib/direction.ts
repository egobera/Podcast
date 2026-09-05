/**
 * Turns a stage direction into something the voice model understands.
 *
 * Scripts are written for actors: "en off, la voz quebrándose", "muy despacio, sin prisa".
 * ElevenLabs v3 reads audio tags instead, in English, in square brackets. This bridges the
 * two so a writer keeps writing for a person and the model still gets the instruction.
 *
 * Tags are a hint, not a command. Two or three land well; a pile of them makes a line
 * sound like an impression rather than a performance, so the list is capped.
 */

const TAGS: [RegExp, string][] = [
  [/\b(susurr|whisper|muy bajito|bajito|entre dientes)/i, '[whispers]'],
  [/\b(suspir|sigh)/i, '[sighs]'],
  [/\b(r[íi]e|riendo|laugh|carcajada)/i, '[laughs]'],
  [/\b(llor|crying|sollo|voz quebr|se le quiebra)/i, '[crying]'],
  [/\b(nervios|nervous|inquiet)/i, '[nervous]'],
  [/\b(asustad|scared|con miedo|p[áa]nico|aterrad)/i, '[scared]'],
  [/\b(enfad|enoj|angry|molest|furios)/i, '[angry]'],
  [/\b(emocionad|excited|entusiasm)/i, '[excited]'],
  [/\b(alivi|relieved)/i, '[relieved]'],
  [/\b(cansad|tired|agotad|weary)/i, '[tired]'],
  [/\b(curios|curious|extra[ñn]ad|desconcertad|confus)/i, '[curious]'],
  [/\b(grit|shout|a voces)/i, '[shouting]'],
  [/\b(serio|seria|grave|solemne)/i, '[serious]'],
  [/\b(sarcas|ir[óo]nic)/i, '[sarcastic]'],
  [/\b(dulce|tierna|cari[ñn]os|gentle|suave)/i, '[gently]'],
  [/\b(aburrid|bored|desganad)/i, '[bored]'],
  // Wordings this project's scripts actually use.
  [/\b(rapid[íi]sim|atropellad|acelerad|de un jal[óo]n|de un tir[óo]n)/i, '[rushed]'],
  [/\b(sin fuerza|voz muy peque|voz muy chiquita|apagad|hundid)/i, '[quietly]'],
  [/\b(explotando|estallando)/i, '[shouting]'],
  [/\b(cantar[íi]n|juguet[óo]n|traviesa?)/i, '[playful]'],
  [/\b(frenando en seco|corta en seco|de golpe)/i, '[abruptly]'],
  [/\b(voz rara|con la voz rara|con la voz rota|rota)/i, '[shaky]'],
  [/\b(frustrad|harta?|exasperad)/i, '[frustrated]'],
  [/\b(demasiado r[áa]pido|m[áa]s r[áa]pido)/i, '[rushed]'],
  [/\b(para s[íi] mismo|para s[íi] misma|entre dientes|murmur)/i, '[muttering]'],
  [/\b(tranquil|calm|sereno|serena)/i, '[calm]'],
]

/** Directions about pace become pauses rather than tags, because that is what they mean. */
const PACE: [RegExp, number][] = [
  [/\b(muy despacio|lent[íi]sim|arrastrando)/i, 700],
  [/\b(despacio|lenta|pausad|sin prisa)/i, 400],
]

export interface Directed {
  /** What actually gets sent to the model. */
  text: string
  /** The tags that were applied, so the person can see what the model was told. */
  tags: string[]
}

/**
 * Only v3 understands audio tags. The older models have no idea what `[excited]` is, so
 * they say it out loud: "excited, cuatro, cinco, seis charcos". The pauses still work
 * everywhere, so a slow direction keeps doing its job on any model.
 */
export function supportsTags(modelId: string): boolean {
  return /v3/i.test(modelId)
}

export function applyDirection(line: string, direction: string, useTags = true): Directed {
  if (!direction?.trim()) return { text: line, tags: [] }

  const tags: string[] = []
  for (const [re, tag] of TAGS) {
    if (tags.length >= 3) break
    if (re.test(direction) && !tags.includes(tag)) tags.push(tag)
  }

  let text = line
  if (useTags && tags.length) text = `${tags.join(' ')} ${text}`

  // A slow direction gets breaks at the sentence joins, where an actor would breathe.
  for (const [re, ms] of PACE) {
    if (!re.test(direction)) continue
    const gap = `<break time="${(ms / 1000).toFixed(1)}s" />`
    const spaced = text.replace(/([.?!])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/g, `$1 ${gap} `)
    // A single short line has no joins to slow down, so the pause goes in front of it.
    text = spaced === text ? `${gap} ${text}` : spaced
    break
  }

  return { text, tags: useTags ? tags : [] }
}

/** The chips offered in the inspector, in the language the scripts are written in. */
export const DIRECTION_HINTS = [
  'susurrando', 'suspira', 'riendo', 'llorando', 'nervioso', 'asustado',
  'enfadado', 'emocionado', 'aliviado', 'cansado', 'extrañado', 'gritando',
  'serio', 'irónico', 'con dulzura', 'muy despacio',
]

/**
 * What a line should actually be told, given the character it belongs to.
 *
 * A script directs the lines that break from the norm, not every line. The narrator's
 * baseline warmth is written once in the cast list, so a line with no direction of its own
 * inherits it instead of being read flat.
 *
 * A line's own direction wins outright rather than stacking: a script that says "gritando"
 * means gritando, not gritando on top of calm.
 */
export function effectiveDirection(
  lineDirection: string | null | undefined,
  characterNotes?: string | null,
  characterDescription?: string | null,
): { text: string; fromCharacter: boolean } {
  const own = (lineDirection ?? '').trim()
  if (own) return { text: own, fromCharacter: false }

  const base = (characterNotes ?? '').trim() || (characterDescription ?? '').trim()
  return { text: base, fromCharacter: !!base }
}
