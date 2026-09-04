import { admin, userFrom, json, speak, makeSound, storeTake } from './_shared'

/** Generates one take for one element. Synchronous, so it must stay under 10 seconds. */
export default async function handler(req: Request) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const userId = await userFrom(req)
  if (!userId) return json({ error: 'Not signed in' }, 401)

  const { element_id } = await req.json() as { element_id: string }
  const db = admin()

  const { data: el } = await db.from('elements')
    .select('*, episodes!inner(project_id, projects!inner(owner, style_notes, language_code))')
    .eq('id', element_id).single()

  // @ts-expect-error nested select shape
  if (!el || el.episodes.projects.owner !== userId) return json({ error: 'Not found' }, 404)
  // @ts-expect-error nested select shape
  const projectId = el.episodes.project_id as string
  // @ts-expect-error nested select shape
  const languageCode = (el.episodes.projects.language_code ?? 'es') as string

  try {
    let audio: ArrayBuffer
    let provider: string
    let promptUsed: string

    if (el.kind === 'dialogue') {
      const { data: ch } = await db.from('characters').select('*').eq('id', el.character_id).single()
      if (!ch?.voice_id) return json({ error: 'This character has no voice set yet.' }, 400)
      promptUsed = el.text_content
      provider = 'elevenlabs'
      audio = await speak({
        voiceId: ch.voice_id,
        text: el.text_content,
        modelId: ch.model,
        languageCode,
        stability: ch.stability,
        similarity: ch.similarity,
        style: ch.style,
      })
    } else {
      promptUsed = el.prompt || el.text_content
      provider = 'elevenlabs'
      audio = await makeSound(promptUsed, el.duration_ms / 1000)
    }

    const take = await storeTake(db, userId, projectId, element_id, audio, promptUsed, provider)
    return json({ take })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Generation failed' }, 500)
  }
}
