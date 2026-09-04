import { admin, userFrom, json, makeSound } from './_shared'

/**
 * Makes a vault sound without leaving the app.
 *
 * The vault could only take uploads, which meant leaving for ElevenLabs, generating,
 * downloading and coming back for every doorbell. The account is already connected; there
 * was no reason to send anyone out of the room.
 */
export default async function handler(req: Request) {
  const userId = await userFrom(req)
  if (!userId) return json({ error: 'Not signed in' }, 401)

  const { asset_id, prompt, seconds } = await req.json() as
    { asset_id: string; prompt: string; seconds?: number }

  const db = admin()
  const { data: asset } = await db.from('series_assets')
    .select('*, projects!inner(owner)').eq('id', asset_id).single()
  if (!asset) return json({ error: 'That vault entry no longer exists.' }, 404)

  try {
    const wanted = seconds ?? (asset.expected_ms ? asset.expected_ms / 1000 : 4)
    const audio = await makeSound(prompt, wanted)

    const path = `${userId}/${asset.project_id}/vault-${asset_id}-${Date.now()}.mp3`
    const { error } = await db.storage.from('audio')
      .upload(path, audio, { contentType: 'audio/mpeg', upsert: false })
    if (error) throw error

    const durationMs = Math.round(Math.min(Math.max(wanted, 0.5), 22) * 1000)
    await db.from('series_assets').update({
      storage_path: path,
      duration_ms: durationMs,
      provider: 'elevenlabs',
      version: (asset.version ?? 1) + 1,
    }).eq('id', asset_id)

    return json({ storage_path: path, duration_ms: durationMs })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not generate that sound' }, 400)
  }
}
