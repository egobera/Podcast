import { userFrom, json } from './_shared'

/**
 * Voice cloning goes straight to ElevenLabs rather than through the router, because
 * the cloning endpoints are not part of the proxied surface. Done once per character.
 */
export default async function handler(req: Request) {
  const userId = await userFrom(req)
  if (!userId) return json({ error: 'Not signed in' }, 401)

  const { name, filename, audio_base64 } = await req.json() as
    { name: string; filename: string; audio_base64: string }

  const bytes = Uint8Array.from(atob(audio_base64), c => c.charCodeAt(0))
  const form = new FormData()
  form.append('name', name)
  form.append('files', new Blob([bytes]), filename)

  const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! },
    body: form,
  })
  if (!res.ok) {
    const raw = await res.text()
    const lower = raw.toLowerCase()

    if (lower.includes('voices_write') || lower.includes('missing_permissions')) {
      return json({
        error: 'Your ElevenLabs API key cannot create voices. In ElevenLabs, go to your profile, ' +
          'API Keys, and make a new key with the "Voices: Write" permission enabled. Then replace ' +
          'ELEVENLABS_API_KEY in your environment variables and redeploy.',
      }, 400)
    }
    if (lower.includes('quota') || lower.includes('limit')) {
      return json({ error: 'Your ElevenLabs plan has no voice slots left. Delete an unused voice or upgrade.' }, 400)
    }

    try {
      const parsed = JSON.parse(raw) as { detail?: { message?: string } }
      if (parsed.detail?.message) return json({ error: parsed.detail.message }, 400)
    } catch { /* not JSON */ }

    return json({ error: `Cloning failed: ${raw}` }, 400)
  }

  const body = await res.json() as { voice_id: string }
  return json({ voice_id: body.voice_id })
}
