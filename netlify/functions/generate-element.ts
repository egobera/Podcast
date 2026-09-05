import { admin, userFrom, json, speak, makeSound, storeTake } from './_shared'
import { applyDirection, effectiveDirection } from '../../src/lib/direction'
import { buildSoundPrompt, looksLikeRawCue } from '../../src/lib/soundprompt'

/** Generates one take for one element. Synchronous, so it must stay under 10 seconds. */
export default async function handler(req: Request) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const userId = await userFrom(req)
  if (!userId) return json({ error: 'Not signed in' }, 401)

  const { element_id } = await req.json() as { element_id: string }
  const db = admin()

  const { data: el, error: readError } = await db.from('elements')
    .select('*, episodes!inner(id, project_id, projects!inner(owner, style_notes, language_code, prompt_influence, context_lines))')
    .eq('id', element_id).single()

  /*
   * A database error is not a missing element, and reporting it as one sent people looking
   * for a deleted line when the real answer was a column that does not exist yet. A single
   * unrun migration made every generation in an episode fail with "Not found".
   */
  if (readError) {
    const missingColumn = /column .* does not exist|schema cache/i.test(readError.message)
    return json({
      error: missingColumn
        ? `The database is missing something this needs: ${readError.message}. Run the migrations in supabase/ in order.`
        : `Could not read that line: ${readError.message}`,
    }, missingColumn ? 500 : 400)
  }

  // @ts-expect-error nested select shape
  if (!el || el.episodes.projects.owner !== userId) {
    return json({ error: 'That line no longer exists, or it belongs to another account.' }, 404)
  }
  // @ts-expect-error nested select shape
  const projectId = el.episodes.project_id as string
  // @ts-expect-error nested select shape
  const project = el.episodes.projects as {
    language_code?: string; prompt_influence?: number; context_lines?: boolean
  }
  const languageCode = project.language_code ?? 'es'

  try {
    let audio: ArrayBuffer
    let provider: string
    let promptUsed: string

    if (el.kind === 'dialogue') {
      const { data: ch } = await db.from('characters').select('*').eq('id', el.character_id).single()
      if (!ch?.voice_id) return json({ error: 'This character has no voice set yet.' }, 400)
      // The stage direction becomes audio tags and pauses before the words are sent.
      const tone = effectiveDirection(el.direction, ch.direction_notes, ch.description)
      const directed = applyDirection(el.text_content, tone.text)

      /*
       * The neighbours. Without them every line is generated from a standing start and
       * lands in the same neutral place, which is what makes an episode sound like takes
       * in a row rather than people talking.
       */
      let previousText = ''
      let nextText = ''
      if (project.context_lines !== false) {
        const { data: around } = await db.from('elements')
          .select('idx, kind, text_content')
          .eq('episode_id', el.episode_id)
          .eq('kind', 'dialogue')
          .order('idx')
        const list = (around ?? []) as { idx: number; text_content: string }[]
        const here = list.findIndex(x => x.idx === el.idx)
        if (here > 0) previousText = list[here - 1].text_content
        if (here >= 0 && here < list.length - 1) nextText = list[here + 1].text_content
      }
      promptUsed = directed.text
      provider = 'elevenlabs'
      audio = await speak({
        voiceId: ch.voice_id,
        text: directed.text,
        modelId: ch.model,
        languageCode,
        stability: ch.stability,
        similarity: ch.similarity,
        style: ch.style,
        speed: ch.speed ?? 1,
        seed: ch.seed,
        previousText,
        nextText,
      })
    } else {
      /*
       * A hand written prompt wins, but only if it is really one. A prompt left over from
       * an older import is the Spanish cue itself, and sending that produces a voice
       * reading the stage direction out loud.
       */
      const built = buildSoundPrompt(el.text_content, el.duration_ms)
      const stored = el.prompt?.trim() ?? ''
      promptUsed = stored && !looksLikeRawCue(stored, el.text_content) ? stored : built.prompt
      provider = 'elevenlabs'
      audio = await makeSound(
        promptUsed,
        built.seconds,
        project.prompt_influence ?? 0.4,
        built.isAmbience,
      )
    }

    const take = await storeTake(db, userId, projectId, element_id, audio, promptUsed, provider)
    return json({ take })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Generation failed' }, 500)
  }
}
