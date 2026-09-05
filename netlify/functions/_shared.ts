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

const ELEVEN = 'https://api.elevenlabs.io/v1'

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY
  if (!k) throw new Error('ELEVENLABS_API_KEY is not set on the server.')
  return k
}

/** Turns an ElevenLabs error envelope into something a person can act on. */
async function elevenError(res: Response, what: string): Promise<never> {
  const raw = await res.text()
  const lower = raw.toLowerCase()

  if (res.status === 401 || lower.includes('missing_permissions') || lower.includes('unauthorized')) {
    throw new Error(
      `Your ElevenLabs key cannot ${what}. Create a key with Text to Speech and Voices ` +
      'permissions enabled and set it as ELEVENLABS_API_KEY.',
    )
  }
  if (res.status === 404) {
    throw new Error('That voice is not in your ElevenLabs account. Set a new one on the character.')
  }
  if (lower.includes('quota')) {
    throw new Error('Your ElevenLabs quota for this month is used up.')
  }
  try {
    const parsed = JSON.parse(raw) as { detail?: { message?: string } | string }
    const message = typeof parsed.detail === 'string' ? parsed.detail : parsed.detail?.message
    if (message) throw new Error(message)
  } catch (e) {
    if (e instanceof Error && !e.message.startsWith('{')) throw e
  }
  throw new Error(`${what} failed: ${res.status} ${raw.slice(0, 200)}`)
}

/**
 * Speech, straight from ElevenLabs.
 *
 * This used to go through a router that answered 404 for the tool names we were using.
 * Calling the provider directly removes a hop, a second set of credentials, and a second
 * thing that can be wrong.
 */
/*
 * v3 reads the emotion tags but refuses the neighbouring lines; the older models take the
 * neighbours but ignore the tags. Sending both to v3 fails the request outright, so the
 * choice is made here rather than left to whoever calls it.
 */
export function takesContext(modelId: string): boolean {
  return !/v3/i.test(modelId)
}

export async function speak(opts: {
  voiceId: string
  text: string
  modelId: string
  languageCode?: string
  stability: number
  similarity: number
  style: number
  speed?: number
  seed?: number | null
  /**
   * The lines either side of this one.
   *
   * Generated in isolation, every line lands in the same neutral place and the result
   * sounds like recordings played in order rather than a conversation. Given the line
   * before and after, the model carries intonation across the join: a question keeps its
   * lift, an answer starts where the question left off.
   */
  previousText?: string
  nextText?: string
}): Promise<ArrayBuffer> {
  const res = await fetch(
    `${ELEVEN}/text-to-speech/${opts.voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: opts.text,
        model_id: opts.modelId,
        language_code: opts.languageCode,
        // Only for the models that accept them. v3 rejects the whole request otherwise.
        previous_text: takesContext(opts.modelId) ? opts.previousText || undefined : undefined,
        next_text: takesContext(opts.modelId) ? opts.nextText || undefined : undefined,
        seed: opts.seed ?? undefined,
        voice_settings: {
          stability: opts.stability,
          similarity_boost: opts.similarity,
          style: opts.style,
          speed: opts.speed ?? 1,
          use_speaker_boost: true,
        },
      }),
    },
  )
  if (!res.ok) await elevenError(res, 'generate speech')
  return res.arrayBuffer()
}

/** Sound effects, same account, same key. */
export async function makeSound(
  prompt: string,
  seconds: number,
  influence = 0.4,
  loop = false,
): Promise<ArrayBuffer> {
  const res = await fetch(`${ELEVEN}/sound-generation?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: Math.min(Math.max(seconds, 0.5), 22),
      prompt_influence: Math.min(Math.max(influence, 0), 1),
      loop,
    }),
  })
  if (!res.ok) await elevenError(res, 'generate a sound')
  return res.arrayBuffer()
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
