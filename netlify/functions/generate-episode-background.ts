import { admin, userFrom, ownsEpisode, json, speak, makeSound, storeTake } from './_shared'
import { applyDirection } from '../../src/lib/direction'

/**
 * First pass generator. The -background suffix is what tells Netlify to invoke this
 * asynchronously and allow up to 15 minutes instead of 10 seconds.
 * Progress is written to the jobs table so the browser can poll it and the user can leave.
 */
export default async function handler(req: Request) {
  const userId = await userFrom(req)
  if (!userId) return json({ error: 'Not signed in' }, 401)

  const { episode_id, job_id } = await req.json() as { episode_id: string; job_id: string }
  const owned = await ownsEpisode(userId, episode_id)
  if (!owned) return json({ error: 'Not found' }, 404)

  const db = admin()
  const projectId = owned.project_id as string

  const { data: project } = await db.from('projects')
    .select('language_code').eq('id', projectId).single()
  const languageCode = project?.language_code ?? 'es'

  const { data: pending } = await db.from('elements')
    .select('*').eq('episode_id', episode_id).in('status', ['missing', 'stale']).order('idx')

  /*
   * The job row already exists: the browser created it so it has something to poll from
   * the first second. Netlify answers a background invocation with 202 and an empty body,
   * so nothing this function returns ever reaches the client.
   */
  await db.from('jobs')
    .update({ status: 'running', total: pending?.length ?? 0 })
    .eq('id', job_id)
  const job = { id: job_id }

  // Returned immediately. The work below keeps running in the background invocation.
  queueMicrotask(async () => {
    let done = 0, failed = 0
    let lastError = ''
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
            const directed = applyDirection(el.text_content, el.direction ?? '')
            prompt = directed.text
            audio = await speak({
              voiceId: ch.voice_id,
              text: directed.text,
              modelId: ch.model,
              languageCode,
              stability: ch.stability,
              similarity: ch.similarity,
              style: ch.style,
            })
          } else {
            prompt = el.prompt || el.text_content
            audio = await makeSound(prompt, el.duration_ms / 1000)
          }
          await storeTake(db, userId, projectId, el.id, audio, prompt, 'elevenlabs')
          done++
        } catch (e) {
          failed++
          lastError = e instanceof Error ? e.message : String(e)
        }
        await db.from('jobs').update({ done, failed, updated_at: new Date().toISOString() }).eq('id', job!.id)
      }
    })

    await Promise.all(workers)
    await db.from('jobs').update({
      status: 'done', done, failed, message: lastError,
      updated_at: new Date().toISOString(),
    }).eq('id', job!.id)
  })

  return json({ job_id: job!.id })
}
