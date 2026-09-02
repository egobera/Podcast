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
  if (!res.ok) return json({ error: `Cloning failed: ${await res.text()}` }, 500)

  const body = await res.json() as { voice_id: string }
  return json({ voice_id: body.voice_id })
}
