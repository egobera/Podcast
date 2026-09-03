import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from './ui'
import { Check, Close } from './icons'
import type { Comment } from '../lib/types'

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Notes attached to one line.
 *
 * The only thing a viewer can write. A psychologist reviewing scripts should be able to
 * say "this line is too fast" without being able to change the audio, and the note has to
 * live on the line itself, not in a separate document nobody opens again.
 */
export default function Comments({
  elementId, episodeId, userId, userEmail, comments, onChanged,
}: {
  elementId: string
  episodeId: string
  userId: string
  userEmail: string | null
  comments: Comment[]
  onChanged: () => void
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const toast = useToast()

  const open = comments.filter(c => !c.resolved)
  const done = comments.filter(c => c.resolved)
  const shown = showResolved ? comments : open

  async function add() {
    const text = body.trim()
    if (!text) return
    setBusy(true)
    const { error } = await supabase.from('comments').insert({
      element_id: elementId, episode_id: episodeId,
      author: userId, author_email: userEmail, body: text,
    })
    setBusy(false)
    if (error) { toast(error.message, 'bad'); return }
    setBody('')
    onChanged()
  }

  async function resolve(c: Comment) {
    await supabase.from('comments').update({ resolved: !c.resolved }).eq('id', c.id)
    onChanged()
  }

  async function remove(c: Comment) {
    await supabase.from('comments').delete().eq('id', c.id)
    onChanged()
  }

  return (
    <div className="ip-section">
      <span className="ip-label">
        Notes{open.length > 0 && ` · ${open.length} open`}
      </span>

      <div className="notes">
        {shown.map(c => (
          <div className="note" key={c.id} data-resolved={c.resolved}>
            <div className="note-head">
              <span className="note-who">{c.author_email ?? 'Someone'}</span>
              <span className="note-when">{ago(c.created_at)}</span>
            </div>
            <p className="note-body">{c.body}</p>
            <div className="note-actions">
              <button className="icon-btn" aria-label={c.resolved ? 'Reopen' : 'Mark resolved'}
                data-on={c.resolved} onClick={() => resolve(c)}>
                <Check size={12} />
              </button>
              {c.author === userId && (
                <button className="icon-btn" aria-label="Delete note" onClick={() => remove(c)}>
                  <Close size={12} />
                </button>
              )}
            </div>
          </div>
        ))}

        {shown.length === 0 && <p className="notice">No notes on this line.</p>}
      </div>

      <textarea
        className="note-input"
        placeholder="Leave a note on this line"
        value={body}
        rows={2}
        onChange={e => setBody(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add() }
        }}
      />
      <div className="btn-row">
        <button className="btn" disabled={!body.trim() || busy} onClick={add}>
          {busy ? 'Saving' : 'Add note'}
        </button>
        {done.length > 0 && (
          <button className="btn" data-variant="quiet" onClick={() => setShowResolved(v => !v)}>
            {showResolved ? 'Hide' : `Show ${done.length} resolved`}
          </button>
        )}
      </div>
    </div>
  )
}
