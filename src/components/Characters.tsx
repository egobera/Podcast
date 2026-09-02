import { useEffect, useRef, useState } from 'react'
import { supabase, callFunction } from '../lib/supabase'
import { useToast } from './ui'
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
