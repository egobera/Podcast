import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatMs } from '../lib/parser'
import { Plus, Close } from './icons'
import { deleteProject } from '../lib/deletion'
import { ConfirmTyped, useToast } from './ui'
import type { Episode, Project } from '../lib/types'

interface Row { episode_id: string; status: string; duration_ms: number; anchor: string }

export interface EpisodeStat {
  episode: Episode
  total: number
  approved: number
  generated: number
  missing: number
  runtime: number
}

/**
 * The spine. Every element of an episode is one segment, in order, coloured by state.
 * It is not decoration: it shows where the work is, so a producer can see at a glance
 * that episode four is nearly done and episode six has not been started.
 */
function Spine({ stat }: { stat: EpisodeStat }) {
  const { approved, generated, missing, total } = stat
  if (total === 0) return <div className="spine" data-empty="true" />
  const pc = (n: number) => `${(n / total) * 100}%`
  return (
    <div className="spine" title={`${approved} approved, ${generated} to review, ${missing} to make`}>
      <span data-s="approved" style={{ width: pc(approved) }} />
      <span data-s="generated" style={{ width: pc(generated) }} />
      <span data-s="missing" style={{ width: pc(missing) }} />
    </div>
  )
}

export default function Library({
  projects, onOpenProject, onOpenEpisode, onNewProject, onDeleted,
}: {
  projects: Project[]
  onOpenProject: (id: string) => void
  onOpenEpisode: (projectId: string, episodeId: string) => void
  onNewProject: () => void
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState<Project | null>(null)
  const toast = useToast()
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const ids = projects.map(p => p.id)
      if (ids.length === 0) { setLoading(false); return }
      const { data: eps } = await supabase.from('episodes').select('*').in('project_id', ids).order('number')
      const epIds = (eps ?? []).map(e => e.id)
      const { data: els } = epIds.length
        ? await supabase.from('elements').select('episode_id, status, duration_ms, anchor').in('episode_id', epIds)
        : { data: [] as Row[] }
      if (cancelled) return
      setEpisodes((eps ?? []) as Episode[])
      setRows((els ?? []) as Row[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [projects])

  const stats = useMemo(() => {
    const byEpisode = new Map<string, EpisodeStat>()
    for (const ep of episodes) {
      byEpisode.set(ep.id, { episode: ep, total: 0, approved: 0, generated: 0, missing: 0, runtime: 0 })
    }
    for (const r of rows) {
      const s = byEpisode.get(r.episode_id)
      if (!s) continue
      s.total++
      if (r.status === 'approved') s.approved++
      else if (r.status === 'generated') s.generated++
      else s.missing++
      if (r.anchor === 'line') s.runtime += r.duration_ms
    }
    return byEpisode
  }, [episodes, rows])

  const byProject = useMemo(() => {
    const map = new Map<string, EpisodeStat[]>()
    for (const p of projects) map.set(p.id, [])
    for (const ep of episodes) map.get(ep.project_id)?.push(stats.get(ep.id)!)
    return map
  }, [projects, episodes, stats])

  /** Episodes that are underway but not finished, most complete first. */
  const inProgress = useMemo(() => {
    return [...stats.values()]
      .filter(s => s.total > 0 && s.approved < s.total)
      .sort((a, b) => (b.approved / b.total) - (a.approved / a.total))
      .slice(0, 3)
  }, [stats])

  return (
    <div className="library">
      <header className="lib-head">
        <div>
          <h2>Your series</h2>
          <p className="lede" style={{ margin: 0 }}>
            {projects.length === 0
              ? 'Nothing here yet.'
              : `${projects.length} ${projects.length === 1 ? 'series' : 'series'} · ${episodes.length} ${episodes.length === 1 ? 'episode' : 'episodes'}`}
          </p>
        </div>
        <button className="btn" data-variant="primary" onClick={onNewProject}>
          <Plus size={14} /> New series
        </button>
      </header>

      {inProgress.length > 0 && (
        <section className="lib-section">
          <h3 className="lib-label">Pick up where you left off</h3>
          <div className="resume">
            {inProgress.map(s => {
              const project = projects.find(p => p.id === s.episode.project_id)
              return (
                <button className="resume-card" key={s.episode.id}
                  onClick={() => onOpenEpisode(s.episode.project_id, s.episode.id)}>
                  <span className="resume-series">{project?.name}</span>
                  <span className="resume-title">{s.episode.title}</span>
                  <Spine stat={s} />
                  <span className="resume-meta tnum">
                    {s.approved} of {s.total} · {formatMs(s.runtime)}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="lib-section">
        <h3 className="lib-label">All series</h3>

        {loading && projects.length === 0 && <div className="empty">Loading</div>}

        {!loading && projects.length === 0 && (
          <div className="empty">
            A series holds its own themes, voices and episodes. Everything you set once carries
            across every season.
            <div style={{ marginTop: 16 }}>
              <button className="btn" data-variant="primary" onClick={onNewProject}>
                <Plus size={14} /> Create your first series
              </button>
            </div>
          </div>
        )}

        <div className="series-grid">
          {projects.map(p => {
            const list = byProject.get(p.id) ?? []
            const total = list.reduce((n, s) => n + s.total, 0)
            const approved = list.reduce((n, s) => n + s.approved, 0)
            const runtime = list.reduce((n, s) => n + s.runtime, 0)
            const pct = total ? Math.round((approved / total) * 100) : 0
            return (
              <div className="series-card" key={p.id} role="button" tabIndex={0}
                onClick={() => onOpenProject(p.id)}
                onKeyDown={e => { if (e.key === 'Enter') onOpenProject(p.id) }}>
                <div className="series-top">
                  <h3>{p.name}</h3>
                  <span className="series-pct tnum">{total ? `${pct}%` : 'New'}</span>
                  <button className="icon-btn card-remove" aria-label={`Delete ${p.name}`}
                    onClick={e => { e.stopPropagation(); setConfirming(p) }}>
                    <Close size={13} />
                  </button>
                </div>

                <div className="series-spines">
                  {list.length === 0 && <span className="series-none">No episodes yet</span>}
                  {list.slice(0, 10).map(s => (
                    <div className="spine-row" key={s.episode.id}>
                      <span className="spine-n tnum">{s.episode.number}</span>
                      <Spine stat={s} />
                    </div>
                  ))}
                </div>

                <div className="series-meta">
                  <span>{list.length} {list.length === 1 ? 'episode' : 'episodes'}</span>
                  {runtime > 0 && <span className="tnum">{formatMs(runtime)}</span>}
                  <span className="series-lang">{p.language}</span>
                </div>
              </div>
            )
          })}

          <button className="series-card is-new" onClick={onNewProject}>
            <span className="new-mark"><Plus size={18} /></span>
            <span className="new-text">New series</span>
            <span className="new-sub">Its own vault, voices and seasons</span>
          </button>
        </div>
      </section>

      {confirming && (
        <ConfirmTyped
          title={`Delete ${confirming.name}`}
          phrase={confirming.name}
          confirmLabel="Delete the series"
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            try {
              const out = await deleteProject(confirming.id)
              toast(`${confirming.name} deleted. ${out.episodes} episodes and ${out.files} files went with it.`)
              onDeleted()
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Could not delete the series', 'bad')
            }
          }}
          body={
            <>
              <p>
                Every episode, every script, every voice preset, the whole vault and all the audio
                files. {(byProject.get(confirming.id) ?? []).length} episodes.
              </p>
              <p className="notice">
                There is no undo and no copy kept anywhere. Only an owner of the team can do this.
              </p>
            </>
          }
        />
      )}
    </div>
  )
}
