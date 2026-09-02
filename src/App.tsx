import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { applyTemplate } from './lib/template'
import SignIn, { SetNewPassword } from './components/SignIn'
import Vault from './components/Vault'
import Characters from './components/Characters'
import EpisodeView from './components/EpisodeView'
import Library from './components/Library'
import TeamView from './components/TeamView'
import { AskText, ToastHost, useToast } from './components/ui'
import ErrorBoundary, { SetupNeeded } from './components/ErrorBoundary'
import type { Character, Episode, Project, SeriesAsset, Team, TeamMember } from './lib/types'

type View = { kind: 'library' } | { kind: 'team' } | { kind: 'vault' } | { kind: 'characters' } | { kind: 'episode'; id: string }
type Ask = null | 'series' | 'rename' | 'episode'

export default function App() {
  return (
    <ErrorBoundary>
      <ToastHost>
        <Workspace />
      </ToastHost>
    </ErrorBoundary>
  )
}

function Workspace() {
  const [userId, setUserId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<TeamMember['role']>('editor')
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [assets, setAssets] = useState<SeriesAsset[]>([])
  const [chars, setChars] = useState<Character[]>([])
  const [view, setView] = useState<View>({ kind: 'library' })
  const [ask, setAsk] = useState<Ask>(null)
  const [setupError, setSetupError] = useState('')
  const toast = useToast()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setUserId(session?.user.id ?? null)
      // Arriving from a reset link signs the user in, then asks for the new password.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  /** Turns any pending invitation for this email into a real membership, then loads teams. */
  const loadTeams = useCallback(async () => {
    if (!userId) return
    setSetupError('')

    const claimed = await supabase.rpc('claim_invites')
    if (claimed.error && /does not exist|schema cache/i.test(claimed.error.message)) {
      setSetupError(claimed.error.message)
      return
    }

    const { data: memberships, error: memberErr } = await supabase.from('team_members')
      .select('team_id, role').eq('user_id', userId)
    if (memberErr) { setSetupError(memberErr.message); return }

    let ids = (memberships ?? []).map(m => m.team_id)

    // First run: nobody has a team yet, so make one.
    if (ids.length === 0) {
      const { data: created, error } = await supabase.from('teams')
        .insert({ name: 'My team', created_by: userId }).select().single()
      if (error) { setSetupError(error.message); return }
      if (created) ids = [created.id]
    }

    const { data: ts, error: teamErr } = await supabase.from('teams')
      .select('*').in('id', ids).order('created_at')
    if (teamErr) { setSetupError(teamErr.message); return }

    const list = (ts ?? []) as Team[]
    setTeams(list)
    setTeamId(id => (id && list.some(t => t.id === id) ? id : list[0]?.id ?? null))
  }, [userId])

  useEffect(() => { loadTeams() }, [loadTeams])

  const loadProjects = useCallback(async () => {
    if (!userId || !teamId) return
    const [{ data }, { data: mine }] = await Promise.all([
      supabase.from('projects').select('*').eq('team_id', teamId).order('created_at'),
      supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).maybeSingle(),
    ])
    const list = (data ?? []) as Project[]
    setProjects(list)
    setMyRole((mine?.role ?? 'editor') as TeamMember['role'])
    setProjectId(id => (id && list.some(p => p.id === id) ? id : list[0]?.id ?? null))
  }, [userId, teamId])

  useEffect(() => { loadProjects() }, [loadProjects])

  const loadSeries = useCallback(async () => {
    if (!projectId) { setEpisodes([]); setAssets([]); setChars([]); return }
    const [{ data: eps }, { data: sa }, { data: cs }] = await Promise.all([
      supabase.from('episodes').select('*').eq('project_id', projectId).order('number'),
      supabase.from('series_assets').select('*').eq('project_id', projectId),
      supabase.from('characters').select('*').eq('project_id', projectId),
    ])
    setEpisodes((eps ?? []) as Episode[])
    setAssets((sa ?? []) as SeriesAsset[])
    setChars((cs ?? []) as Character[])
  }, [projectId])

  useEffect(() => { loadSeries() }, [loadSeries])

  const project = projects.find(p => p.id === projectId) ?? null
  const team = teams.find(t => t.id === teamId) ?? null

  async function createProject(name: string) {
    if (!userId) return
    if (!teamId) {
      toast('No team yet. Run migration 003 in Supabase and reload.', 'bad')
      return
    }
    const { data, error } = await supabase.from('projects')
      .insert({ owner: userId, team_id: teamId, name }).select().single()
    if (error) { toast(`Could not create the series: ${error.message}`, 'bad'); return }
    if (!data) { toast('The series was not created and the database said nothing.', 'bad'); return }

    await loadProjects()
    setProjectId((data as Project).id)
    setView({ kind: 'vault' })
    toast(`${name} created. Start by putting your themes in the vault.`)
  }

  async function renameProject(name: string) {
    if (!project) return
    await supabase.from('projects').update({ name }).eq('id', project.id)
    loadProjects()
  }

  async function createEpisode(title: string) {
    if (!project) return
    const number = episodes.length + 1
    const { data, error } = await supabase.from('episodes').insert({
      project_id: project.id, number, title,
      target_min_ms: 420000, target_max_ms: 540000,
    }).select().single()
    if (error) { toast(`Could not create the episode: ${error.message}`, 'bad'); return }
    if (!data) return
    const placed = await applyTemplate((data as Episode).id, project.id)
    await loadSeries()
    setView({ kind: 'episode', id: (data as Episode).id })
    toast(placed > 0
      ? `${title} created with ${placed} vault ${placed === 1 ? 'asset' : 'assets'} already in place.`
      : `${title} created. Paste the script to see what it needs.`)
  }

  const steps = useMemo(() => {
    void 0
    const themed = assets.some(a => a.auto_place === 'open' && a.storage_path)
    const voiced = chars.some(c => c.voice_id)
    return [
      { done: !!project && project.name !== 'Untitled series', text: 'Name the series', go: () => setAsk('rename') },
      { done: themed, text: 'Put the opening theme in the vault', go: () => setView({ kind: 'vault' }) },
      { done: episodes.length > 0, text: 'Create the first episode', go: () => setAsk('episode') },
      { done: voiced, text: 'Give a character a voice', go: () => setView({ kind: 'characters' }) },
    ]
  }, [project, assets, chars, episodes])

  const setupDone = steps.every(s => s.done)

  if (!ready) return null
  if (recovering) return <SetNewPassword onDone={() => setRecovering(false)} />
  if (!userId) return <SignIn />
  if (setupError) return <SetupNeeded message={setupError} />

  const episode = view.kind === 'episode' ? episodes.find(e => e.id === view.id) : undefined

  function openProject(id: string) {
    setProjectId(id)
    setView({ kind: 'vault' })
  }

  function openEpisode(pid: string, eid: string) {
    setProjectId(pid)
    setView({ kind: 'episode', id: eid })
  }

  return (
    <div className="shell">
      <nav className="rail">
        <div className="rail-brand">
          <h1>{project ? project.name : team?.name ?? 'Estudio'}</h1>
        </div>

        {teams.length > 1 && (
          <select className="rail-select" value={teamId ?? ''}
            onChange={e => { setTeamId(e.target.value); setView({ kind: 'library' }) }}>
            {teams.map(t => <option key={t.id} value={t.id} style={{ color: '#000' }}>{t.name}</option>)}
          </select>
        )}

        <div className="rail-group">
          <button data-active={view.kind === 'library'} onClick={() => setView({ kind: 'library' })}>
            All series
            <span className="rail-count">{projects.length}</span>
          </button>
          <button data-active={view.kind === 'team'} onClick={() => setView({ kind: 'team' })}>
            Team
          </button>
        </div>

        {project && (
          <>
            <div className="rail-group">
              <span className="rail-label">Series</span>
              <button data-active={view.kind === 'vault'} onClick={() => setView({ kind: 'vault' })}>Vault</button>
              <button data-active={view.kind === 'characters'} onClick={() => setView({ kind: 'characters' })}>Characters</button>
            </div>

            <div className="rail-group">
              <span className="rail-label">Episodes</span>
              {episodes.map(e => (
                <button key={e.id}
                  data-active={view.kind === 'episode' && view.id === e.id}
                  onClick={() => setView({ kind: 'episode', id: e.id })}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.number}. {e.title}
                  </span>
                </button>
              ))}
              <button onClick={() => setAsk('episode')}>New episode</button>
            </div>
          </>
        )}

        <div className="rail-group" style={{ marginTop: 'auto' }}>
          <button onClick={() => setAsk('series')}>New series</button>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </nav>

      <main className="main">
        {view.kind === 'team' && team && (
          <TeamView team={team} userId={userId} onChanged={() => { loadTeams(); loadProjects() }} />
        )}

        {view.kind === 'library' && (
          <Library
            projects={projects}
            onOpenProject={openProject}
            onOpenEpisode={openEpisode}
            onNewProject={() => setAsk('series')}
          />
        )}

        {project && !setupDone && view.kind === 'vault' && (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="start">
              <h3>Start here</h3>
              {steps.map(s => (
                <div className="step" data-done={s.done} key={s.text}>
                  <span className="step-mark">{s.done ? '●' : '○'}</span>
                  <span className="step-text">{s.text}</span>
                  {!s.done && <button className="btn" data-variant="quiet" onClick={s.go}>Go</button>}
                </div>
              ))}
            </div>
          </div>
        )}

        {project && view.kind === 'vault' && <Vault project={project} userId={userId} onChanged={loadSeries} />}
        {project && view.kind === 'characters' && <Characters project={project} onChanged={loadSeries} />}
        {project && episode && (
          <EpisodeView key={episode.id} project={project} episode={episode} userId={userId} />
        )}
      </main>

      {ask === 'rename' && project && (
        <AskText title="Rename series" label="Series name" initial={project.name}
          onSubmit={renameProject} onClose={() => setAsk(null)} />
      )}
      {ask === 'series' && (
        <AskText title="New series" label="What is it called?" submitLabel="Create"
          onSubmit={createProject} onClose={() => setAsk(null)} />
      )}
      {ask === 'episode' && (
        <AskText title="New episode" label="Episode title" initial={`Episode ${episodes.length + 1}`}
          submitLabel="Create" onSubmit={createEpisode} onClose={() => setAsk(null)} />
      )}
    </div>
  )
}
