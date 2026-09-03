import { useEffect, useRef, useState } from 'react'
import { supabase, callFunction } from '../lib/supabase'
import { useToast } from './ui'
import { accentsFor, labelFor } from '../lib/languages'
import VoiceDesigner from './VoiceDesigner'
import type { Character, Project } from '../lib/types'

export default function Characters({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const [chars, setChars] = useState<Character[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [cloning, setCloning] = useState<string | null>(null)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement | null>(null)
  const cloneTarget = useRef<string | null>(null)
  const toast = useToast()
  const [designing, setDesigning] = useState<Character | null>(null)

  async function load() {
    const { data } = await supabase.from('characters').select('*').eq('project_id', project.id).order('name')
    setChars(data ?? [])
  }
  useEffect(() => { load() }, [project.id])

  async function add() {
    if (!newName.trim()) return
    await supabase.from('characters').insert({ project_id: project.id, name: newName.trim().toUpperCase() })
    setNewName('')
    load()
  }

  async function patch(id: string, fields: Partial<Character>) {
    await supabase.from('characters').update(fields).eq('id', id)
    load()
    onChanged()
  }

  async function clone(charId: string, file: File) {
    setCloning(charId)
    setError('')
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res((r.result as string).split(',')[1])
        r.onerror = () => rej(new Error('Could not read file'))
        r.readAsDataURL(file)
      })
      const char = chars.find(c => c.id === charId)!
      const out = await callFunction<{ voice_id: string }>('clone-voice', {
        name: `${project.name} ${char.name}`,
        filename: file.name,
        audio_base64: b64,
      })
      await patch(charId, { voice_id: out.voice_id, source: 'cloned' })
      toast(`${char.name} now has its own voice. Every line in every season will use it.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cloning failed')
    } finally {
      setCloning(null)
    }
  }

  return (
    <div className="page">
      <h2>Characters</h2>
      <p className="lede">
        A character is a locked preset, not just a voice. Voice, model and settings travel together,
        so a line generated in season three sounds like the same person as episode one.
      </p>

      <div className="btn-row" style={{ marginBottom: 24 }}>
        <input
          placeholder="Character name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          style={{ border: '1px solid var(--rule)', borderRadius: 5, padding: '7px 10px' }}
        />
        <button className="btn" onClick={add}>Add character</button>
      </div>

      {error && <p className="error">{error}</p>}

      {chars.length === 0 && (
        <div className="empty">No characters yet. Import a script and Estudio finds them for you.</div>
      )}

      <div className="cards">
        {chars.map(c => (
          <div className="card" key={c.id}>
            <h3>{c.name}</h3>
            <p>
              {c.source === 'cloned' ? 'Cloned voice' : c.source === 'human' ? 'Recorded by a person' : 'Catalog voice'}
              {c.voice_id ? ` · ${c.voice_id.slice(0, 10)}` : ' · no voice set'}
            </p>
            <input
              className="card-desc"
              placeholder="Who they are, in one line"
              defaultValue={c.description}
              onBlur={e => patch(c.id, { description: e.target.value })}
            />
            <p>
              {labelFor(project.language_code)} · {c.accent ?? project.accent}
              {c.accent && c.accent !== project.accent && ' · differs from the series'}
            </p>

            {editing === c.id ? (
              <>
                <div className="field">
                  <label>Voice ID</label>
                  <input defaultValue={c.voice_id ?? ''} onBlur={e => patch(c.id, { voice_id: e.target.value })} />
                </div>
                <div className="field">
                  <label>Stability {c.stability}</label>
                  <input type="range" min={0} max={1} step={0.05} defaultValue={c.stability}
                    onMouseUp={e => patch(c.id, { stability: Number((e.target as HTMLInputElement).value) })} />
                </div>
                <div className="field">
                  <label>Similarity {c.similarity}</label>
                  <input type="range" min={0} max={1} step={0.05} defaultValue={c.similarity}
                    onMouseUp={e => patch(c.id, { similarity: Number((e.target as HTMLInputElement).value) })} />
                </div>
                <div className="field">
                  <label>Accent</label>
                  <select defaultValue={c.accent ?? project.accent}
                    onChange={e => patch(c.id, { accent: e.target.value })}>
                    {accentsFor(project.language_code).map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Direction notes</label>
                  <textarea defaultValue={c.direction_notes} onBlur={e => patch(c.id, { direction_notes: e.target.value })} />
                </div>
                {c.source === 'cloned' && (
                  <div className="field">
                    <label>Consent document URL</label>
                    <input defaultValue={c.consent_url ?? ''} onBlur={e => patch(c.id, { consent_url: e.target.value })} />
                  </div>
                )}
              </>
            ) : null}

            <div className="btn-row" style={{ marginTop: 'auto', paddingTop: 8 }}>
              <button className="btn" data-variant="quiet" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                {editing === c.id ? 'Done' : 'Settings'}
              </button>
              <button className="btn" data-variant={!c.voice_id && c.description ? 'primary' : undefined}
                onClick={() => setDesigning(c)}>
                {c.description ? 'Design from the script' : 'Design a voice'}
              </button>
              <button
                className="btn"
                disabled={cloning === c.id}
                onClick={() => { cloneTarget.current = c.id; fileInput.current?.click() }}
              >
                {cloning === c.id ? 'Cloning' : 'Clone from audio'}
              </button>
              <button className="btn" data-variant={c.locked ? 'primary' : undefined}
                onClick={() => patch(c.id, { locked: !c.locked })}>
                {c.locked ? 'Locked' : 'Lock'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {designing && (
        <VoiceDesigner
          characterName={designing.name}
          languageCode={project.language_code}
          accent={designing.accent ?? project.accent}
          fromScript={designing.description ?? ''}
          onSaved={(voiceId, description) => {
            patch(designing.id, { voice_id: voiceId, source: 'catalog', description })
          }}
          onClose={() => setDesigning(null)}
        />
      )}

      <input
        ref={fileInput}
        type="file"
        accept="audio/*"
        hidden
        onChange={e => {
          const f = e.target.files?.[0]
          if (f && cloneTarget.current) clone(cloneTarget.current, f)
          e.target.value = ''
        }}
      />

      <div className="manual">
        <h4>Two ways to get a voice, and they answer different questions</h4>
        <p>
          <strong>Clone from audio</strong> copies a real person. It reproduces the sample and
          takes no instructions: you cannot ask a clone to sound older, deeper or calmer. Whatever
          is in the recording is what you get, for every season.
        </p>
        <p>
          <strong>Design a voice</strong> invents one from a written description, so age, depth,
          texture and pace are exactly what you ask for. Use it when the voice in your head does
          not exist yet, or when you want an older grandmother than anyone you can record.
        </p>
        <p>
          If you cloned someone and want them deeper or older, redesigning is the honest route.
          The other option is changing the recording itself: distance to the microphone, time of
          day, how tired the speaker is. All of that lands in the clone.
        </p>
      </div>

      <div className="manual">
        <h4>Record the clone in the language and accent you will publish in</h4>
        <p>
          The model does not take an accent setting. Whatever accent is in the audio you upload is
          the accent every line will have, in every season. A voice cloned from Castilian Spanish
          will keep sounding Castilian even when the script is written in Mexican Spanish.
        </p>
        <p>
          So record the sample in the same language and accent as the series, speaking naturally,
          and check the Accent field on the character afterwards.
        </p>
      </div>

      <div className="manual">
        <h4>Cloning a child's voice needs written consent</h4>
        <p>
          ElevenLabs requires that you hold the rights to any voice you clone. For a minor that means
          a parent or guardian signing off. Store the document somewhere durable and paste the link
          into the character. It looks like paperwork until a platform licenses the series and asks.
        </p>
        <p>
          Give the cloner 1 to 3 minutes of clean speech with no music and no room echo. More audio
          does not help; cleaner audio does.
        </p>
      </div>
    </div>
  )
}
