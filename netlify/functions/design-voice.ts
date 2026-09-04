import { userFrom, json } from './_shared'

/**
 * Voice Design. Turns a written description into a voice.
 *
 * Two steps in one function. `design` asks ElevenLabs for three candidates and returns
 * them as audio the browser can play. `create` takes the one the user picked and adds it
 * to the account, which is what gives us a permanent voice_id.
 *
 * This is the answer to "I want it to sound older": you cannot ask a clone to change,
 * but you can describe the voice you actually want and have one made.
 */
/**
 * ElevenLabs speaks in JSON envelopes. People do not.
 *
 * Two of these come up constantly and both have a specific fix, so they are worth naming
 * instead of dumping the raw payload on screen.
 */
function explain(raw: string, step: 'design' | 'save'): string {
  const lower = raw.toLowerCase()

  if (lower.includes('blocked_generation') || lower.includes('safety guidelines')) {
    return 'ElevenLabs blocked that description. Designed voices cannot be made to sound like ' +
      'children, so a child character has to come from the voice library or from a clone of a ' +
      'real child with written consent from a parent. Try describing an adult, or pick a ' +
      'catalog voice instead.'
  }

  if (lower.includes('voices_write') || lower.includes('missing_permissions')) {
    return 'Your ElevenLabs API key cannot create voices. Make a new key with the ' +
      '"Voices: Write" permission enabled and put it in ELEVENLABS_API_KEY.'
  }

  if (lower.includes('quota') || lower.includes('limit')) {
    return 'Your ElevenLabs account has run out of quota for this month.'
  }

  try {
    const parsed = JSON.parse(raw) as { detail?: { message?: string } }
    if (parsed.detail?.message) return parsed.detail.message
  } catch { /* not JSON */ }

  return step === 'design' ? `Could not design the voice: ${raw}` : `Could not save the voice: ${raw}`
}

export default async function handler(req: Request) {
  const userId = await userFrom(req)
  if (!userId) return json({ error: 'Not signed in' }, 401)

  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return json({ error: 'No ElevenLabs key configured on the server.' }, 500)

  const body = await req.json() as {
    action: 'design' | 'create'
    description?: string
    text?: string
    name?: string
    generated_voice_id?: string
  }

  try {
    if (body.action === 'design') {
      const description = (body.description ?? '').trim()
      if (description.length < 20) {
        return json({ error: 'The description needs at least 20 characters.' }, 400)
      }

      const res = await fetch('https://api.elevenlabs.io/v1/text-to-voice/design', {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_description: description.slice(0, 1000),
          text: (body.text ?? '').slice(0, 1000),
          model_id: 'eleven_multilingual_ttv_v2',
          auto_generate_text: !body.text,
        }),
      })
      if (!res.ok) return json({ error: explain(await res.text(), 'design') }, 400)

      const out = await res.json() as {
        previews: { generated_voice_id: string; audio_base_64: string }[]
      }
      return json({ previews: out.previews ?? [] })
    }

    if (body.action === 'create') {
      if (!body.generated_voice_id || !body.name) {
        return json({ error: 'Pick a preview first.' }, 400)
      }
      const res = await fetch('https://api.elevenlabs.io/v1/text-to-voice', {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_name: body.name.slice(0, 60),
          voice_description: (body.description ?? 'Designed in Estudio').slice(0, 500),
          generated_voice_id: body.generated_voice_id,
        }),
      })
      if (!res.ok) return json({ error: explain(await res.text(), 'save') }, 400)

      const out = await res.json() as { voice_id: string }
      return json({ voice_id: out.voice_id })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Voice design failed' }, 500)
  }
}
