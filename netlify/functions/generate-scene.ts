import { admin, userFrom, json } from './_shared'
import { applyDirection, effectiveDirection } from '../../src/lib/direction'

/**
 * A whole scene, in one performance.
 *
 * Every line used to be generated alone and then butted against its neighbours, which is
 * why an episode sounded like recordings in a row. Here the model receives the exchange as
 * an exchange: it decides where somebody comes in early, where a pause belongs, and how an
 * answer should sit against the question that caused it.
 *
 * What comes back is a single file covering many lines. That is the trade, and it is why
 * this runs per scene rather than per episode: a scene is the largest thing worth redoing
 * in one piece.
 */
export default async function handler(req: Request) {
  const userId = await userFrom(req)
  if (!userId) return json({ error: 'Not signed in' }, 401)

  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return json({ error: 'No ElevenLabs key configured on the server.' }, 500)

  const { episode_id, scene, seed } = await req.json() as
    { episode_id: string; scene: string; seed?: number }

  const db = admin()

  const { data: episode } = await db.from('episodes')
    .select('id, project_id, projects!inner(owner, language_code)')
    .eq('id', episode_id).single()
  // @ts-expect-error nested select shape
  if (!episode || episode.projects.owner !== userId) {
    return json({ error: 'That episode is not yours.' }, 404)
  }

  const { data: rows, error: readError } = await db.from('elements')
    .select('*')
    .eq('episode_id', episode_id)
    .eq('scene', scene)
    .eq('kind', 'dialogue')
    .order('idx')
  if (readError) return json({ error: readError.message }, 400)

  const lines = rows ?? []
  if (lines.length < 2) {
    return json({ error: 'A scene needs at least two lines to be worth performing together.' }, 400)
  }

  const { data: characters } = await db.from('characters')
    .select('*').eq('project_id', episode.project_id)
  const cast = new Map((characters ?? []).map(c => [c.id, c]))

  const missingVoice = lines.find(l => !cast.get(l.character_id)?.voice_id)
  if (missingVoice) {
    const who = cast.get(missingVoice.character_id)?.name ?? 'Someone'
    return json({ error: `${who} has no voice yet.` }, 400)
  }

  /*
   * Each turn carries its own voice and its own text, and the audio tags go inside the
   * text of the turn they affect. So a direction written for one line stays attached to
   * that line even though everything is generated together.
   */
  const turns = lines.map(el => {
    const ch = cast.get(el.character_id)!
    const tone = effectiveDirection(el.direction, ch.direction_notes, ch.description)
    return {
      voice_id: ch.voice_id as string,
      text: applyDirection(el.text_content, tone.text, true).text,
    }
  })

  // The endpoint takes 3,000 characters. A scene that exceeds it is a scene, not a request.
  const size = turns.reduce((n, t) => n + t.text.length, 0)
  if (size > 2900) {
    return json({
      error: `This scene is ${size} characters and the limit is 3,000. Split it with a scene break.`,
    }, 400)
  }

  try {
    const res = await fetch(
      'https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128',
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: turns,
          model_id: 'eleven_v3',
          // @ts-expect-error nested select shape
          language_code: episode.projects.language_code ?? 'es',
          seed: seed ?? undefined,
          settings: { stability: 0.5, use_speaker_boost: true },
        }),
      },
    )

    if (!res.ok) {
      const raw = await res.text()
      if (/not.*(available|enabled)|403/i.test(raw)) {
        return json({
          error: 'Your ElevenLabs account does not have Text to Dialogue enabled yet. '
            + 'It is part of v3; contact their sales team for access.',
        }, 400)
      }
      try {
        const parsed = JSON.parse(raw) as { detail?: { message?: string } | string }
        const message = typeof parsed.detail === 'string' ? parsed.detail : parsed.detail?.message
        if (message) return json({ error: message }, 400)
      } catch { /* not JSON */ }
      return json({ error: `The scene could not be generated: ${raw.slice(0, 200)}` }, 400)
    }

    const audio = await res.arrayBuffer()
    const path = `${userId}/${episode.project_id}/scene-${episode_id}-${Date.now()}.mp3`
    const { error: uploadError } = await db.storage.from('audio')
      .upload(path, audio, { contentType: 'audio/mpeg', upsert: false })
    if (uploadError) throw uploadError

    const { data: take, error: takeError } = await db.from('scene_takes').insert({
      episode_id,
      scene,
      storage_path: path,
      duration_ms: 0,           // measured in the browser, where the audio gets decoded
      element_ids: lines.map(l => l.id),
      seed: seed ?? null,
    }).select().single()
    if (takeError) throw takeError

    // The lines now belong to one performance and have nothing of their own to generate.
    await db.from('elements').update({
      scene_take_id: take.id,
      status: 'generated',
    }).in('id', lines.map(l => l.id))

    return json({ take_id: take.id, storage_path: path, lines: lines.length })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'The scene could not be generated' }, 500)
  }
}
