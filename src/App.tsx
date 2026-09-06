import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { applyTemplate } from './lib/template'
import SignIn, { SetNewPassword } from './components/SignIn'
import Vault from './components/Vault'
import Characters from './components/Characters'
import EpisodeView from './components/EpisodeView'
import Library from './components/Library'
import TeamView from './components/TeamView'
import LibraryPanel from './components/LibraryPanel'
import { AskText, ToastHost, useToast } from './components/ui'
import ErrorBoundary, { SetupNeeded } from './components/ErrorBoundary'
import MobileTabs, { InstallPrompt, type Tab } from './components/MobileTabs'
import Shortcuts, { useShortcutsOverlay } from './components/Shortcuts'
import { usePhone } from './lib/useMedia'
import { isStandalone } from './lib/pwa'
import type { Character, Episode, Project, SeriesAsset, Team, TeamMember } from './lib/types'

type View = { kind: 'library' } | { kind: 'team' } | { kind: 'kept' } | { kind: 'vault' } | { kind: 'characters' } | { kind: 'episode'; id: string }
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
  const [userEmail, setUserEmail] = useState<string | null>(null)
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
  const phone = usePhone()
  const keys = useShortcutsOverlay()
  const [setupError, setSetupError] = useState('')
  const toast = useToast()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null)
      setUserEmail(data.session?.user.email ?? null)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setUserId(session?.user.id ?? null)
      setUserEmail(session?.user.email ?? null)
      // Arriving from a reset link signs the user in, then asks for the new password.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  /** Turns any pending invitation for this email into a real membership, then loads teams. */
  const loadTeams = useCallback(async () => {
    if (!userId) return
    setSetupError('')

    // The server decides. It claims any invitation, finds an existing team, or makes the
    // first one, all in a single call that runs above row level security.
    const bootstrap = await supabase.rpc('ensure_team', { team_name: 'My team' })
    if (bootstrap.error) { setSetupError(bootstrap.error.message); return }

    const { data: memberships, error: memberErr } = await supabase.from('team_members')
      .select('team_id, role').eq('user_id', userId)
    if (memberErr) { setSetupError(memberErr.message); return }

    const ids = [...new Set([
      bootstrap.data as string,
      ...(memberships ?? []).map(m => m.team_id),
    ].filter(Boolean))]

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
    const number = episodes.reduce((n, e) => Math.max(n, e.number), 0) + 1
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

  /*
   * The order of the work, in the order it has to happen.
   *
   * These used to be four unrelated boxes. They are a sequence: a script cannot be read
   * before an episode exists, voices cannot be assigned before a script names anybody, and
   * generating before either produces silence. Saying so, and pointing at exactly the next
   * thing, is the difference between a tool somebody learns and a tool somebody guesses at.
   */
  const steps = useMemo(() => {
    const themed = assets.some(a => (a.auto_place === 'open' || a.auto_place === 'close') && a.storage_path)
    const voiced = chars.filter(c => c.voice_id).length
    const named = chars.length

    return [
      {
        done: !!project && project.name !== 'Untitled series',
        text: 'Name the series',
        why: 'It shows on every episode and in the feed later.',
        go: () => setAsk('rename'),
        cta: 'Name it',
      },
      {
        done: episodes.length > 0,
        text: 'Create the first episode',
        why: 'Everything else hangs off an episode: the script, the cast, the timeline.',
        go: () => setAsk('episode'),
        cta: 'Create one',
      },
      {
        done: named > 0,
        text: 'Read a script into it',
        why: 'The script is what tells the app who speaks, what sounds are needed and how long it runs.',
        go: () => setView({ kind: 'library' }),
        cta: 'Open the episode',
      },
      {
        done: named > 0 && voiced === named,
        text: voiced === 0
          ? 'Give the characters a voice'
          : `Give the remaining ${named - voiced} characters a voice`,
        why: 'A character without one generates nothing at all, and the run fails on every one of their lines.',
        go: () => setView({ kind: 'characters' }),
        cta: 'Open the cast',
      },
      {
        done: themed,
        text: 'Put the themes in the vault',
        why: 'Music is uploaded, not generated. Without them an episode starts and ends in silence.',
        go: () => setView({ kind: 'vault' }),
        cta: 'Open the vault',
      },
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

  const tab: Tab =
    view.kind === 'vault' ? 'vault'
      : view.kind === 'characters' ? 'cast'
        : view.kind === 'team' ? 'team'
          : 'episodes'

  return (
    <div className="shell" data-phone={phone} data-standalone={isStandalone()}>
      <nav className="rail">
        <div className="rail-brand">
          <h1>{project ? project.name : team?.name ?? 'Canon'}</h1>
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
          <button data-active={view.kind === 'kept'} onClick={() => setView({ kind: 'kept' })}>
            Library
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
        {view.kind === 'kept' && teamId && (
          <LibraryPanel
            teamId={teamId}
            project={project}
            userId={userId}
            onChanged={loadSeries}
          />
        )}

        {view.kind === 'team' && team && (
          <TeamView team={team} userId={userId} onChanged={() => { loadTeams(); loadProjects() }} />
        )}

        {view.kind === 'library' && (
          <Library
            projects={projects}
            onOpenProject={openProject}
            onOpenEpisode={openEpisode}
            onNewProject={() => setAsk('series')}
            onDeleted={() => { loadProjects(); setView({ kind: 'library' }) }}
          />
        )}

        {project && !setupDone && view.kind !== 'episode' && (() => {
          /*
           * The one thing to do next, everywhere except inside an episode.
           *
           * A checklist tucked into one screen only helps somebody who already found that
           * screen. This follows you, names the next step, says why it matters, and offers
           * the single button that does it. The rest of the list is there for anyone who
           * wants to see the shape of the work, folded away for everyone else.
           */
          const next = steps.find(st => !st.done)!
          const done = steps.filter(st => st.done).length

          return (
            <div className="page" style={{ paddingBottom: 0 }}>
              <div className="guide">
                <div className="guide-top">
                  <span className="guide-count tnum">{done} of {steps.length}</span>
                  <div className="guide-bar">
                    <span style={{ width: `${(done / steps.length) * 100}%` }} />
                  </div>
                </div>

                <h3>{next.text}</h3>
                <p>{next.why}</p>
                <button className="btn" data-variant="primary" onClick={next.go}>{next.cta}</button>

                <details>
                  <summary>All the steps</summary>
                  {steps.map(st => (
                    <div className="step" data-done={st.done} key={st.text}>
                      <span className="step-mark">{st.done ? '●' : '○'}</span>
                      <span className="step-text">{st.text}</span>
                      {!st.done && st !== next && (
                        <button className="btn" data-variant="quiet" onClick={st.go}>Go</button>
                      )}
                    </div>
                  ))}
                </details>
              </div>
            </div>
          )
        })()}

        {project && view.kind === 'vault' && (
          <Vault
            project={project}
            userId={userId}
            teamId={teamId ?? ''}
            canDelete={myRole === 'owner'}
            onChanged={loadSeries}
            onDeleted={async () => {
              setProjectId(null)
              setView({ kind: 'library' })
              await loadProjects()
            }}
          />
        )}
        {project && view.kind === 'characters' && <Characters project={project} userId={userId} teamId={teamId ?? ''} onChanged={loadSeries} />}
        {project && episode && (
          <EpisodeView
            key={episode.id}
            project={project}
            episode={episode}
            userId={userId}
            userEmail={userEmail}
            onDeleted={async () => { setView({ kind: 'vault' }); await loadSeries() }}
          />
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
        <AskText title="New episode" label="Episode title"
          initial={`Episode ${episodes.reduce((n, e) => Math.max(n, e.number), 0) + 1}`}
          submitLabel="Create" onSubmit={createEpisode} onClose={() => setAsk(null)} />
      )}
    </div>
  )
}
