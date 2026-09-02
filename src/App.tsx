import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { applyTemplate } from './lib/template'
import SignIn, { SetNewPassword } from './components/SignIn'
import Vault from './components/Vault'
import Characters from './components/Characters'
import EpisodeView from './components/EpisodeView'
import Library from './components/Library'
import { AskText, ToastHost, useToast } from './components/ui'
import type { Character, Episode, Project, SeriesAsset } from './lib/types'

type View = { kind: 'library' } | { kind: 'vault' } | { kind: 'characters' } | { kind: 'episode'; id: string }
type Ask = null | 'series' | 'rename' | 'episode'

export default function App() {
  return (
    <ToastHost>
      <Workspace />
    </ToastHost>
  )
}

function Workspace() {
  const [userId, setUserId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [assets, setAssets] = useState<SeriesAsset[]>([])
  const [chars, setChars] = useState<Character[]>([])
  const [view, setView] = useState<View>({ kind: 'library' })
  const [ask, setAsk] = useState<Ask>(null)
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

  const loadProjects = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase.from('projects').select('*').eq('owner', userId).order('created_at')
    const list = (data ?? []) as Project[]
    setProjects(list)
    setProjectId(id => (id && list.some(p => p.id === id) ? id : list[0]?.id ?? null))
  }, [userId])

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

  async function createProject(name: string) {
    if (!userId) return
    const { data } = await supabase.from('projects').insert({ owner: userId, name }).select().single()
    if (data) {
      await loadProjects()
      setProjectId((data as Project).id)
      setView({ kind: 'vault' })
      toast(`${name} created. Start by putting your themes in the vault.`)
    }
  }

  async function renameProject(name: string) {
    if (!project) return
    await supabase.from('projects').update({ name }).eq('id', project.id)
    loadProjects()
  }

  async function createEpisode(title: string) {
    if (!project) return
    const number = episodes.length + 1
    const { data } = await supabase.from('episodes').insert({
      project_id: project.id, number, title,
      target_min_ms: 420000, target_max_ms: 540000,
    }).select().single()
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
          <h1>{project ? project.name : 'Estudio'}</h1>
        </div>

        <div className="rail-group">
          <button data-active={view.kind === 'library'} onClick={() => setView({ kind: 'library' })}>
            All series
            <span className="rail-count">{projects.length}</span>
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
