import { admin, userFrom, json, monid, storeTake } from './_shared'

/** Generates one take for one element. Synchronous, so it must stay under 10 seconds. */
export default async function handler(req: Request) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const userId = await userFrom(req)
  if (!userId) return json({ error: 'Not signed in' }, 401)

  const { element_id } = await req.json() as { element_id: string }
  const db = admin()

  const { data: el } = await db.from('elements')
    .select('*, episodes!inner(project_id, projects!inner(owner, style_notes))')
    .eq('id', element_id).single()

  // @ts-expect-error nested select shape
  if (!el || el.episodes.projects.owner !== userId) return json({ error: 'Not found' }, 404)
  // @ts-expect-error nested select shape
  const projectId = el.episodes.project_id as string

  try {
    let audio: ArrayBuffer
    let provider: string
    let promptUsed: string

    if (el.kind === 'dialogue') {
      const { data: ch } = await db.from('characters').select('*').eq('id', el.character_id).single()
      if (!ch?.voice_id) return json({ error: 'This character has no voice set yet.' }, 400)
      promptUsed = el.text_content
      provider = 'elevenlabs'
      audio = await monid('elevenlabs.text_to_speech', {
        voice_id: ch.voice_id,
        model_id: ch.model,
        text: el.text_content,
        voice_settings: {
          stability: ch.stability,
          similarity_boost: ch.similarity,
          style: ch.style,
        },
      })
    } else {
      promptUsed = el.prompt || el.text_content
      provider = 'elevenlabs'
      audio = await monid('elevenlabs.sound_effects', {
        text: promptUsed,
        duration_seconds: Math.min(Math.max(el.duration_ms / 1000, 0.5), 22),
      })
    }

    const take = await storeTake(db, userId, projectId, element_id, audio, promptUsed, provider)
    return json({ take })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Generation failed' }, 500)
  }
}
