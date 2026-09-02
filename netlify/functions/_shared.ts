import { createClient } from '@supabase/supabase-js'

/** Service role client. Only ever created inside a function, never in the browser. */
export function admin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/** Verifies the caller's token and returns their user id, or null. */
export async function userFrom(req: Request): Promise<string | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin().auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

/** Confirms this user owns the episode before we spend money on their behalf. */
export async function ownsEpisode(userId: string, episodeId: string) {
  const db = admin()
  const { data } = await db
    .from('episodes')
    .select('id, project_id, projects!inner(owner)')
    .eq('id', episodeId)
    .single()
  // @ts-expect-error nested select shape
  return data && data.projects.owner === userId ? data : null
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Calls a generation tool through Monid. One key, one balance, many providers.
 * Returns raw audio bytes.
 */
export async function monid(tool: string, payload: Record<string, unknown>): Promise<ArrayBuffer> {
  const res = await fetch(`https://api.monid.ai/v1/tools/${tool}/invoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MONID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Monid ${tool} failed: ${res.status} ${await res.text()}`)

  const type = res.headers.get('content-type') ?? ''
  if (type.startsWith('audio/')) return res.arrayBuffer()

  // Some tools return a JSON envelope with a URL or base64 payload.
  const body = await res.json() as Record<string, any>
  const url = body.audio_url ?? body.url ?? body.output?.url
  if (url) return (await fetch(url)).arrayBuffer()
  const b64 = body.audio_base64 ?? body.audio ?? body.output?.audio_base64
  if (b64) return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer
  throw new Error(`Monid ${tool} returned no audio`)
}

/** Rough duration from an MP3 byte length. Replaced by the real value once the browser reads it. */
export function estimateMp3Ms(bytes: number, kbps = 128) {
  return Math.round((bytes * 8) / (kbps * 1000) * 1000)
}

export async function storeTake(
  db: ReturnType<typeof admin>,
  ownerId: string,
  projectId: string,
  elementId: string,
  audio: ArrayBuffer,
  prompt: string,
  provider: string,
) {
  const path = `${ownerId}/${projectId}/${elementId}-${Date.now()}.mp3`
  const { error } = await db.storage.from('audio')
    .upload(path, audio, { contentType: 'audio/mpeg', upsert: false })
  if (error) throw error

  const { data: take } = await db.from('takes').insert({
    element_id: elementId,
    storage_path: path,
    duration_ms: estimateMp3Ms(audio.byteLength),
    prompt_used: prompt,
    provider,
  }).select().single()

  await db.from('elements').update({ status: 'generated' }).eq('id', elementId)
  return take
}
