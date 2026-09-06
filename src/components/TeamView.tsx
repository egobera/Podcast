import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast, Confirm } from './ui'
import { Plus, Close } from './icons'
import type { Team, TeamMember, TeamInvite, Role } from '../lib/types'

const ROLE_TEXT: Record<Role, string> = {
  owner: 'Manages people and everything else',
  editor: 'Can create and change anything',
  viewer: 'Can listen and read, cannot change',
}

export default function TeamView({
  team, userId, onChanged,
}: {
  team: Team
  userId: string
  onChanged: () => void
}) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<TeamInvite[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<TeamMember | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    const [{ data: m }, { data: i }] = await Promise.all([
      supabase.from('team_members').select('*').eq('team_id', team.id).order('created_at'),
      supabase.from('team_invites').select('*').eq('team_id', team.id).order('created_at'),
    ])
    setMembers((m ?? []) as TeamMember[])
    setInvites((i ?? []) as TeamInvite[])
  }, [team.id])

  useEffect(() => { load() }, [load])

  const me = members.find(m => m.user_id === userId)
  const isOwner = me?.role === 'owner'

  async function invite() {
    const clean = email.trim().toLowerCase()
    if (!/.+@.+\..+/.test(clean)) { toast('That does not look like an email address.', 'bad'); return }
    if (members.some(m => m.email?.toLowerCase() === clean)) {
      toast('That person is already on the team.'); return
    }
    setBusy(true)
    const { error } = await supabase.from('team_invites')
      .insert({ team_id: team.id, email: clean, role, invited_by: userId })
    setBusy(false)
    if (error) { toast(error.message, 'bad'); return }
    setEmail('')
    load()
    toast(`${clean} joins the moment they sign in. No email is sent, so tell them yourself.`)
  }

  async function changeRole(member: TeamMember, next: Role) {
    if (member.role === 'owner' && members.filter(m => m.role === 'owner').length === 1) {
      toast('A team needs at least one owner.', 'bad'); return
    }
    await supabase.from('team_members').update({ role: next })
      .eq('team_id', team.id).eq('user_id', member.user_id)
    load()
  }

  async function remove(member: TeamMember) {
    await supabase.from('team_members').delete()
      .eq('team_id', team.id).eq('user_id', member.user_id)
    load()
    onChanged()
    toast(member.user_id === userId ? 'You left the team.' : 'Removed.')
  }

  return (
    <div className="page">
      <h2>{team.name}</h2>
      <p className="lede">
        Everyone here sees the same series, the same vault and the same voices. Nothing is
        duplicated and nothing is private to one person.
      </p>

      {isOwner && (
        <section className="ip-section" style={{ marginBottom: 34 }}>
          <span className="ip-label">Invite someone</span>
          <div className="invite-row">
            <input
              placeholder="name@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') invite() }}
            />
            <select className="inline" value={role} onChange={e => setRole(e.target.value as Role)}>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
            <button className="btn" data-variant="primary" disabled={busy} onClick={invite}>
              <Plus size={14} /> Invite
            </button>
          </div>
          <p className="notice">
            Canon does not send the invitation. The moment that person creates an account with
            this address, or signs in with it, they land straight in this team.
          </p>
        </section>
      )}

      <section className="ip-section" style={{ marginBottom: 30 }}>
        <span className="ip-label">People</span>
        <div className="people">
          {members.map(m => (
            <div className="person" key={m.user_id}>
              <span className="avatar">{(m.email ?? '?').slice(0, 1).toUpperCase()}</span>
              <span className="person-main">
                <span className="person-email">
                  {m.email ?? 'Unknown'}
                  {m.user_id === userId && <span className="you">you</span>}
                </span>
                <span className="person-role">{ROLE_TEXT[m.role]}</span>
              </span>
              {isOwner ? (
                <select className="inline" value={m.role}
                  onChange={e => changeRole(m, e.target.value as Role)}>
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span className="dur">{m.role}</span>
              )}
              {(isOwner || m.user_id === userId) && (
                <button className="icon-btn" aria-label="Remove"
                  onClick={() => setConfirmRemove(m)}>
                  <Close size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {invites.length > 0 && (
        <section className="ip-section">
          <span className="ip-label">Waiting to join</span>
          <div className="people">
            {invites.map(i => (
              <div className="person" data-pending="true" key={i.id}>
                <span className="avatar" data-pending="true">{i.email.slice(0, 1).toUpperCase()}</span>
                <span className="person-main">
                  <span className="person-email">{i.email}</span>
                  <span className="person-role">Joins as {i.role} on first sign in</span>
                </span>
                {isOwner && (
                  <button className="icon-btn" aria-label="Cancel invitation"
                    onClick={async () => {
                      await supabase.from('team_invites').delete().eq('id', i.id)
                      load()
                    }}>
                    <Close size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {confirmRemove && (
        <Confirm
          title={confirmRemove.user_id === userId ? 'Leave this team' : 'Remove this person'}
          confirmLabel={confirmRemove.user_id === userId ? 'Leave' : 'Remove'}
          destructive
          onClose={() => setConfirmRemove(null)}
          onConfirm={() => remove(confirmRemove)}
          body={
            confirmRemove.user_id === userId ? (
              <p>You lose access to every series in {team.name}. Someone with owner rights would have to invite you back.</p>
            ) : (
              <p>{confirmRemove.email} loses access to every series in {team.name}. Nothing they made is deleted.</p>
            )
          }
        />
      )}
    </div>
  )
}
