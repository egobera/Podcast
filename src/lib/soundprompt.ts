/**
 * Turns a stage direction into a sound effect prompt.
 *
 * Sending the cue straight through was the mistake. "AMBIENTE · Cocina de domingo. Radio
 * muy bajita y alguien picando sobre una tabla. En bucle hasta que salen al balón." is
 * three different things at once: a label, a description, and an instruction to the editor.
 * The model reads all of it as sound to make, which is why the results came back sounding
 * like someone reading a script rather than a kitchen.
 *
 * So: drop the label, drop the editing instructions, translate the vocabulary, and say how
 * it should be recorded. The generator answers to English and to concrete nouns.
 */

/** Words that describe the edit, not the sound. Everything from here on is dropped. */
const EDIT_TALK = [
  /\ben bucle\b.*/i,
  /\bhasta que\b.*/i,
  /\bsustituye al?\b.*/i,
  /\bsigue sonando\b.*/i,
  /\bentra (a|bajo|con)\b.*/i,
  /\bsale con\b.*/i,
  /\btermina en\b.*/i,
  /\bdesde aqu[íi]\b.*/i,
  /\b\d+\s*dB\b.*/i,
  /\ba nivel pleno\b.*/i,
  /\bpor debajo\b.*/i,
  /\bcorte seco\b.*/i,
]

/**
 * The vocabulary these scripts actually use.
 *
 * These are not translations to substitute in place: doing that word by word produced
 * Spanglish, which reads worse to the model than either language alone. Each entry is a
 * concept to recognise. Whatever matches is collected in English, and everything else is
 * dropped, because a word the generator does not know becomes a noise nobody asked for.
 */
const CONCEPTS: [RegExp, string][] = [
  [/\btimbre\b/i, 'doorbell ringing'],
  [/\bpuerta\b/i, 'a door opening and closing'],
  [/\bpasos\b/i, 'footsteps on a hard floor'],
  [/\bbal[óo]n\b/i, 'a ball bouncing on a hard floor'],
  [/\b(vidrio|cristal)\b/i, 'glass breaking, dry and short'],
  [/\barena\b/i, 'fine sand pouring onto a hard surface'],
  [/\bsilla\b/i, 'a wooden chair creaking'],
  [/\b(madera|objeto de madera)\b/i, 'a wooden object falling on a hard floor'],
  [/\bpegamento\b/i, 'a glue bottle cap and squeeze'],
  [/\bcocina\b/i, 'a quiet kitchen'],
  [/\bradio\b/i, 'a distant muffled radio'],
  [/\bpicando\b/i, 'someone chopping vegetables on a board'],
  [/\btono de llamada\b/i, 'a landline phone ringing'],
  [/\btel[ée]fono\b/i, 'a telephone handset'],
  [/\bbolsas\b/i, 'plastic and fabric bags rustling'],
  [/\bbast[óo]n\b/i, 'a walking cane tapping the floor'],
  [/\b(libros|repisa|librero)\b/i, 'books sliding on a shelf'],
  [/\bsill[óo]n\b/i, 'someone sitting into an armchair'],
  [/\brespiraci[óo]n\b/i, 'close nervous breathing'],
  [/\bwhoosh\b/i, 'a fast whoosh of a thrown object'],
  [/\bgolpe de aire\b/i, 'a low air burst'],
  [/\bchasquido\b/i, 'a single sharp click'],
  [/\bcuarto\b/i, 'a small closed bedroom'],
  [/\bsala\b/i, 'a quiet living room'],
  [/\bpasillo\b/i, 'a hallway'],
  [/\bcae\b/i, 'something falling'],
  [/\bdomingo\b/i, 'a still sunday morning'],
  [/\btarde\b/i, 'late afternoon'],
  [/\bnoche\b/i, 'night'],
]

/** Ambiences want room and length; single hits want to be dry and isolated. */
/*
 * The generator will read a prompt aloud if the prompt reads like a sentence somebody
 * might say. Saying so explicitly, every time, is the difference between a chair creaking
 * and an actor announcing that a chair creaks.
 */
const NO_VOICE = 'sound effect only, no voice, no narration, no words, no music'
const AMBIENCE_TAIL = `continuous background room tone, recorded quietly. ${NO_VOICE}`
const SPOT_TAIL = `single isolated sound, dry, close microphone, no reverb tail. ${NO_VOICE}`

export interface SoundPrompt {
  prompt: string
  seconds: number
  isAmbience: boolean
  /** False when nothing in the cue was recognised, so the prompt needs a human. */
  described: boolean
}

export function buildSoundPrompt(cue: string, expectedMs?: number | null): SoundPrompt {
  const labelled = cue.match(/^(m[úu]sica|ambiente|sonido|sound|sfx|efecto)\s*[·:-]\s*/i)
  const isAmbience = /^ambiente/i.test(labelled?.[1] ?? '') || /\bambiente\b/i.test(cue)

  let body = labelled ? cue.slice(labelled[0].length) : cue

  // Cut everything from the first instruction to the editor onwards.
  for (const re of EDIT_TALK) body = body.replace(re, '')
  body = body.replace(/\([^)]*\)/g, ' ').replace(/\d{1,2}:\d{2}/g, ' ')

  // Collect what is recognised, in the order it appears, and throw the rest away.
  const found: string[] = []
  for (const [re, english] of CONCEPTS) {
    if (re.test(body) && !found.includes(english)) found.push(english)
  }

  const described = found.length > 0
  const body_en = described
    ? found.join(', ')
    // Nothing recognised. Send the words through rather than nothing, and let the person
    // see that this one needs rewriting by hand.
    : body.replace(/\s+/g, ' ').trim()

  const seconds = expectedMs
    ? Math.min(Math.max(expectedMs / 1000, 0.5), 22)
    : isAmbience ? 12 : 3

  const prompt = `${body_en || 'quiet room tone'}. ${isAmbience ? AMBIENCE_TAIL : SPOT_TAIL}.`

  return { prompt, seconds, isAmbience, described }
}

/** Sensible starting lengths, so a vault entry is never blank about how long it should be. */
export function defaultLengthMs(kind: string): number {
  switch (kind) {
    case 'theme_open': return 15000
    case 'theme_close': return 30000
    case 'bed': return 120000
    case 'freeze_in': return 4000
    case 'freeze_pulse': return 700
    case 'freeze_out': return 1000
    case 'villain': return 5000
    default: return 3000
  }
}

/**
 * True when a stored prompt is really just the cue from the script, saved by an older
 * version of the app or by someone clicking through the field. Those go to the generator
 * as Spanish prose, and Spanish prose is what it reads out loud.
 */
export function looksLikeRawCue(prompt: string, cue: string): boolean {
  const strip = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (strip(prompt) === strip(cue)) return true
  // Or it never went through the builder: the builder always ends with this.
  return !/no voice, no narration/i.test(prompt)
}
