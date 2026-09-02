import { admin, userFrom, ownsEpisode, json, monid, storeTake } from './_shared'

/**
 * First pass generator. The -background suffix is what tells Netlify to invoke this
 * asynchronously and allow up to 15 minutes instead of 10 seconds.
 * Progress is written to the jobs table so the browser can poll it and the user can leave.
 */
export default async function handler(req: Request) {
  const userId = await userFrom(req)
  if (!userId) return json({ error: 'Not signed in' }, 401)

  const { episode_id } = await req.json() as { episode_id: string }
  const owned = await ownsEpisode(userId, episode_id)
  if (!owned) return json({ error: 'Not found' }, 404)

  const db = admin()
  const projectId = owned.project_id as string

  const { data: pending } = await db.from('elements')
    .select('*').eq('episode_id', episode_id).in('status', ['missing', 'stale']).order('idx')

  const { data: job } = await db.from('jobs').insert({
    episode_id, status: 'running', total: pending?.length ?? 0,
  }).select().single()

  // Returned immediately. The work below keeps running in the background invocation.
  queueMicrotask(async () => {
    let done = 0, failed = 0
    const CONCURRENCY = 3   // providers rate limit hard above this

    const chars = new Map<string, any>()
    const { data: cs } = await db.from('characters').select('*').eq('project_id', projectId)
    for (const c of cs ?? []) chars.set(c.id, c)

    const queue = [...(pending ?? [])]
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const el = queue.shift()
        if (!el) break
        try {
          const { data: fresh } = await db.from('jobs').select('status').eq('id', job!.id).single()
          if (fresh?.status === 'cancelled') return

          let audio: ArrayBuffer
          let prompt: string
          if (el.kind === 'dialogue') {
            const ch = chars.get(el.character_id)
            if (!ch?.voice_id) throw new Error('no voice')
            prompt = el.text_content
            audio = await monid('elevenlabs.text_to_speech', {
              voice_id: ch.voice_id,
              model_id: ch.model,
              text: el.text_content,
              voice_settings: { stability: ch.stability, similarity_boost: ch.similarity, style: ch.style },
            })
          } else {
            prompt = el.prompt || el.text_content
            audio = await monid('elevenlabs.sound_effects', {
              text: prompt,
              duration_seconds: Math.min(Math.max(el.duration_ms / 1000, 0.5), 22),
            })
          }
          await storeTake(db, userId, projectId, el.id, audio, prompt, 'elevenlabs')
          done++
        } catch {
          failed++
        }
        await db.from('jobs').update({ done, failed, updated_at: new Date().toISOString() }).eq('id', job!.id)
      }
    })

    await Promise.all(workers)
    await db.from('jobs').update({
      status: 'done', done, failed, updated_at: new Date().toISOString(),
    }).eq('id', job!.id)
  })

  return json({ job_id: job!.id })
}
