import { useState } from 'react'
import { callFunction } from '../lib/supabase'
import { Modal, useToast } from './ui'
import { Play, Check, Spinner } from './icons'
import { labelFor } from '../lib/languages'

/**
 * Traits, not sliders.
 *
 * The model reads a sentence, so the job of this panel is to help write a good one.
 * Picking chips builds the sentence, and it stays editable, because a specific phrase
 * a person writes themselves almost always beats a list of tags.
 */
const TRAITS: { label: string; options: string[] }[] = [
  { label: 'Age', options: ['child', 'teenage', 'young adult', 'middle aged', 'elderly'] },
  { label: 'Voice', options: ['male', 'female', 'androgynous'] },
  { label: 'Depth', options: ['deep', 'low', 'mid range', 'high pitched'] },
  { label: 'Texture', options: ['warm', 'smooth', 'raspy', 'gravelly', 'breathy', 'nasal', 'clear'] },
  { label: 'Pace', options: ['slow and deliberate', 'measured', 'quick', 'hurried'] },
  { label: 'Mood', options: ['calm', 'gentle', 'authoritative', 'playful', 'weary', 'menacing'] },
]

/**
 * Words a script is likely to use, mapped to the trait the model understands.
 * Scripts are written in the show's language; Voice Design reads English best. This
 * bridges the two so a description written for actors becomes a usable prompt.
 */
const HINTS: [RegExp, string, string][] = [
  // An age in years is the most reliable signal a script gives.
  [/\b([1-9]|1[0-2])\s*(años|year)/i, 'Age', 'child'],
  [/\b(1[3-7])\s*(años|year)/i, 'Age', 'teenage'],
  // "le habla al niño" describes the listener, not the speaker, so a child word that
  // follows a preposition is ignored.
  [/(?<!\b(?:al|a la|para|del|de la|con el|con la|a los|a las)\s)\b(ni[ñn][oa]|child|kid)\b/i, 'Age', 'child'],
  [/\b(adolescent|teen)/i, 'Age', 'teenage'],
  [/\b(mayor|anciana?|abuel|elderly|old)/i, 'Age', 'elderly'],
  [/\b(joven|young)\b/i, 'Age', 'young adult'],
  [/\b(madura?|middle aged|mediana edad)/i, 'Age', 'middle aged'],
  [/\b(hombre|masculin|male|padre|se[ñn]or)\b/i, 'Voice', 'male'],
  [/\b(mujer|femenin|female|madre|mam[áa]|se[ñn]ora)\b/i, 'Voice', 'female'],
  [/\b(grave|deep|profunda)\b/i, 'Depth', 'deep'],
  [/\b(aguda|high pitched|chillona)\b/i, 'Depth', 'high pitched'],
  [/\b(c[áa]lida|warm|afectuosa)\b/i, 'Texture', 'warm'],
  [/\b(rasgada|ronca|raspy|rasposa)\b/i, 'Texture', 'raspy'],
  [/\b(gravelly|cascada)\b/i, 'Texture', 'gravelly'],
  [/\b(susurr|breathy|entrecortada)/i, 'Texture', 'breathy'],
  [/\b(clara|clear|n[íi]tida)\b/i, 'Texture', 'clear'],
  [/\b(pausada|lenta|slow|despacio|tranquil)/i, 'Pace', 'slow and deliberate'],
  [/\b(r[áa]pid|quick|acelerad|impulsiv)/i, 'Pace', 'quick'],
  [/\b(calm|serena|sosegada)/i, 'Mood', 'calm'],
  [/\b(autoridad|authoritative|firme|directa)\b/i, 'Mood', 'authoritative'],
  [/\b(juguetona|playful|traviesa)\b/i, 'Mood', 'playful'],
  [/\b(cansada|weary|agotada)\b/i, 'Mood', 'weary'],
  [/\b(amenaz|menacing|siniestra|oscura)/i, 'Mood', 'menacing'],
  [/\b(gentle|suave|dulce)\b/i, 'Mood', 'gentle'],
]

function traitsFrom(description: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [re, trait, value] of HINTS) {
    if (!out[trait] && re.test(description)) out[trait] = value
  }
  return out
}

const SAMPLE = 'Diez segundos alcanzan para muchas cosas. Diez segundos no alcanzan para casi nada. Todavía no sé cuáles son cuáles, pero lo voy a averiguar antes de que se acabe la tarde.'

interface Preview { generated_voice_id: string; audio_base_64: string }

export default function VoiceDesigner({
  characterName, languageCode, accent, fromScript = '', onSaved, onClose,
}: {
  characterName: string
  languageCode: string
  accent: string
  /** The description the script carries. Everything below starts from it. */
  fromScript?: string
  /** The design prompt, kept apart from the character's own description. */
  onSaved: (voiceId: string, designPrompt: string) => void
  onClose: () => void
}) {
  const [picked, setPicked] = useState<Record<string, string>>(() => traitsFrom(fromScript))
  const [extra, setExtra] = useState(fromScript)
  const [text, setText] = useState(SAMPLE)
  const [previews, setPreviews] = useState<Preview[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [busy, setBusy] = useState<'design' | 'save' | null>(null)
  const toast = useToast()

  const description = [
    Object.values(picked).join(', '),
    `${accent} ${labelFor(languageCode)} accent`,
    extra.trim(),
  ].filter(Boolean).join('. ')

  const longEnough = description.length >= 20

  async function design() {
    setBusy('design')
    setPreviews([])
    setChosen(null)
    try {
      const out = await callFunction<{ previews: Preview[] }>('design-voice', {
        action: 'design', description, text: text.length >= 100 ? text : undefined,
      })
      setPreviews(out.previews)
      if (out.previews.length === 0) toast('No previews came back. Try a more specific description.', 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not design the voice', 'bad')
    } finally {
      setBusy(null)
    }
  }

  function playPreview(p: Preview) {
    const audio = new Audio(`data:audio/mpeg;base64,${p.audio_base_64}`)
    audio.play()
  }

  async function save() {
    if (!chosen) return
    setBusy('save')
    try {
      const out = await callFunction<{ voice_id: string }>('design-voice', {
        action: 'create',
        generated_voice_id: chosen,
        name: `${characterName} (designed)`,
        description,
      })
      onSaved(out.voice_id, description)
      toast(`${characterName} has a voice. It is locked to this character from now on.`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the voice', 'bad')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      title={`Design a voice for ${characterName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" data-variant="quiet" onClick={onClose}>Cancel</button>
          {previews.length > 0 && (
            <button className="btn" data-variant="primary" disabled={!chosen || busy === 'save'} onClick={save}>
              {busy === 'save' ? 'Saving' : 'Use this voice'}
            </button>
          )}
        </>
      }
    >
      <div className="traits">
        {TRAITS.map(t => (
          <div className="trait" key={t.label}>
            <span className="ip-label">{t.label}</span>
            <div className="chips">
              {t.options.map(o => (
                <button
                  key={o}
                  className="chip"
                  aria-pressed={picked[t.label] === o}
                  onClick={() => setPicked(p => ({ ...p, [t.label]: p[t.label] === o ? '' : o }))}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="field">
        <label>{fromScript ? 'From the script, edit freely' : 'Anything else'}</label>
        <textarea
          placeholder="sounds like someone who has told this story before"
          value={extra}
          onChange={e => setExtra(e.target.value)}
          style={{ minHeight: 56 }}
        />
        {fromScript && (
          <span className="hint">
            Taken from the cast list. The traits above were picked from it; change any of them.
          </span>
        )}
      </div>

      <div className="field">
        <label>What the description says</label>
        <p className="described">{description || 'Pick a few traits above.'}</p>
      </div>

      <details>
        <summary style={{ cursor: 'pointer', color: 'var(--text-2)', fontSize: 'var(--t-sm)' }}>
          Preview text
        </summary>
        <div className="field" style={{ marginTop: 8 }}>
          <textarea value={text} onChange={e => setText(e.target.value)} />
          <span className="hint">
            {text.length} characters. Under 100 and ElevenLabs writes its own.
          </span>
        </div>
      </details>

      <button className="btn" data-variant={previews.length ? undefined : 'primary'}
        disabled={!longEnough || busy === 'design'} onClick={design}>
        {busy === 'design' ? <><Spinner size={13} /> Generating three</> : previews.length ? 'Try again' : 'Generate three voices'}
      </button>

      {previews.length > 0 && (
        <div className="previews">
          {previews.map((p, i) => (
            <div className="preview" key={p.generated_voice_id} data-chosen={chosen === p.generated_voice_id}>
              <button className="icon-btn" aria-label="Play" onClick={() => playPreview(p)}>
                <Play size={12} />
              </button>
              <span className="preview-name">Voice {i + 1}</span>
              <button className="btn" data-variant={chosen === p.generated_voice_id ? 'primary' : undefined}
                onClick={() => setChosen(p.generated_voice_id)}>
                {chosen === p.generated_voice_id ? <><Check size={12} /> Chosen</> : 'Choose'}
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="notice">
        A designed voice is invented, so it is yours to use without anyone's consent. It is also
        less consistent than a clone of a real person. For the characters that carry an episode,
        a recorded voice still wins.
      </p>
    </Modal>
  )
}
