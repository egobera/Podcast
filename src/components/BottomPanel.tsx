import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EpisodePlayer, LANES, laneOf, type Clip, type Lane, type Monitor } from '../lib/player'
import { Play, Pause, SkipBack, SkipForward, ChevronDown, ChevronUp, Spinner } from './icons'
import type { AudioElement, Episode, GainRole } from '../lib/types'

const LANE_LABEL: Record<Lane, string> = { voice: 'Voice', music: 'Music', effects: 'Sound' }
/* Three hues inside the blue family: cerulean for voice, indigo for music, steel for sound.
   Distinct enough to read apart at 20px tall, close enough to belong together. */
const LANE_COLOR: Record<Lane, string> = { voice: '#3f86c4', music: '#6470b4', effects: '#4a8a9e' }
const LANE_H = 30
const HEAD_W = 96

function tc(ms: number) {
  const t = Math.max(0, ms) / 1000
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const d = Math.floor((t % 1) * 10)
  return `${m}:${String(s).padStart(2, '0')}.${d}`
}

function roleOf(el: AudioElement): Exclude<GainRole, 'auto'> {
  if (el.gain_role !== 'auto') return el.gain_role
  return el.kind === 'dialogue' ? 'voice' : el.kind === 'music' ? 'bed' : 'spot'
}

/** Ruler steps chosen so labels never crowd, whatever the episode length. */
function stepFor(totalMs: number, width: number) {
  const target = Math.max(width / 9, 60)
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  for (const s of candidates) {
    if ((s * 1000 / totalMs) * width >= target) return s
  }
  return 600
}

export default function BottomPanel({
  elements, total, duckDb, buildClips, selectedId, onSelect,
  episode, onLaneGain, onGain, onTrimSelected,
}: {
  elements: (AudioElement & { start_ms: number })[]
  total: number
  duckDb: number
  selectedId: string | null
  buildClips: () => Promise<Clip[]>
  onSelect: (id: string) => void
  episode: Episode
  onLaneGain: (lane: Lane, db: number) => void
  onGain: (elementId: string, db: number) => void
  onTrimSelected: () => void
}) {
  const player = useRef<EpisodePlayer | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'playing'>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [head, setHead] = useState(0)
  const [monitor, setMonitor] = useState<Monitor>('studio')
  const [muted, setMuted] = useState<Set<Lane>>(new Set())
  const [soloed, setSoloed] = useState<Set<Lane>>(new Set())
  const [collapsed, setCollapsed] = useState(false)
  const laneGain = episode.lane_gain ?? {}
  const [clips, setClips] = useState<Clip[]>([])
  const [width, setWidth] = useState(800)
  const raf = useRef(0)
  const laneArea = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const playhead = useRef<HTMLDivElement>(null)
  const lastRead = useRef(0)

  /**
   * The playhead is written straight to the DOM sixty times a second. Routing it through
   * React would re-render a canvas and a hundred rows for every frame, which is how a
   * smooth line turns into a stuttering one. The time readout only needs ten updates a
   * second, so that is all it gets.
   */
  const moveHead = useCallback((ms: number) => {
    const el = playhead.current
    if (el) el.style.transform = `translateX(${(ms / Math.max(total, 1)) * widthRef.current}px)`
  }, [total])
  const widthRef = useRef(800)
  widthRef.current = width

  useEffect(() => () => { player.current?.destroy(); cancelAnimationFrame(raf.current) }, [])

  useLayoutEffect(() => {
    const el = laneArea.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [collapsed])

  /**
   * Positions are tweened, not read straight from the data.
   *
   * Approving a take that runs a second longer moves everything after it. Snapping to the
   * new layout leaves the eye with no idea what happened; sliding it over a third of a
   * second shows the ripple travelling down the episode, which is exactly what did happen.
   */
  const shown = useRef(new Map<string, number>())
  const tween = useRef(0)

  useEffect(() => {
    const target = new Map(elements.map(e => [e.id, e.start_ms]))
    const from = new Map(shown.current)

    // Anything new starts where it belongs; only moves are animated.
    let moves = 0
    for (const [id, to] of target) {
      if (!from.has(id)) { shown.current.set(id, to); continue }
      if (Math.abs(from.get(id)! - to) > 1) moves++
    }
    for (const id of [...shown.current.keys()]) if (!target.has(id)) shown.current.delete(id)

    // Someone who has asked for less motion gets the new layout immediately.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (moves === 0 || still) { shown.current = target; draw(); return }

    const started = performance.now()
    const DURATION = 320
    cancelAnimationFrame(tween.current)

    const step = () => {
      const t = Math.min((performance.now() - started) / DURATION, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      for (const [id, to] of target) {
        const start = from.get(id) ?? to
        shown.current.set(id, start + (to - start) * eased)
      }
      draw()
      if (t < 1) tween.current = requestAnimationFrame(step)
    }
    tween.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(tween.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements])

  /** Clips drawn from the script even before any audio has been decoded. */
  const drawable = elements
    .filter(e => e.block_role !== 'pulse' || true)
    .map(e => ({
      id: e.id,
      lane: laneOf(roleOf(e)),
      startMs: shown.current.get(e.id) ?? e.start_ms,
      durationMs: e.duration_ms,
      url: clips.find(c => c.id === e.id)?.url,
      ready: e.status === 'approved' || !!e.series_asset_id,
    }))

  const draw = useCallback(() => {
    const cv = canvas.current
    if (!cv || width <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const h = LANES.length * LANE_H
    cv.width = width * dpr
    cv.height = h * dpr
    cv.style.width = `${width}px`
    cv.style.height = `${h}px`
    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, h)

    const span = Math.max(total, 1)
    const px = (ms: number) => (ms / span) * width

    LANES.forEach((lane, li) => {
      const top = li * LANE_H
      const laneH = LANE_H - 8
      const y = top + 4

      g.fillStyle = '#15202c'
      roundRect(g, 0, y, width, laneH, 4)
      g.fill()

      const silenced = muted.has(lane) || (soloed.size > 0 && !soloed.has(lane))

      for (const c of drawable) {
        if (c.lane !== lane) continue
        const x = px(c.startMs)
        const w = Math.max(px(c.durationMs), 2)
        const base = LANE_COLOR[lane]

        g.globalAlpha = silenced ? 0.22 : c.ready ? 1 : 0.34
        g.fillStyle = base
        roundRect(g, x, y + 1, w, laneH - 2, 2)
        g.fill()

        const peaks = c.url ? player.current?.peaksFor(c.url) : null
        if (peaks && w > 4) {
          g.globalAlpha = silenced ? 0.3 : 0.85
          g.fillStyle = '#0d1620'
          const mid = y + laneH / 2
          const half = (laneH - 4) / 2
          const cols = Math.min(Math.floor(w), peaks.length)
          for (let i = 0; i < cols; i++) {
            const p = peaks[Math.floor((i / cols) * peaks.length)]
            const bh = Math.max(half * (1 - p), 0.5)
            g.fillRect(x + i, mid - half, 1, bh)
            g.fillRect(x + i, mid + half - bh, 1, bh)
          }
        }

        if (c.id === selectedId) {
          g.globalAlpha = 1
          g.strokeStyle = '#e6f0fa'
          g.lineWidth = 1
          roundRect(g, x + 0.5, y + 1.5, Math.max(w - 1, 2), laneH - 3, 2)
          g.stroke()
        }
      }
      g.globalAlpha = 1
    })
  }, [width, total, drawable, muted, soloed, selectedId])

  useEffect(() => { draw() })
  useEffect(() => { moveHead(head) }, [width, collapsed, moveHead, head])

  function tick() {
    const ms = player.current?.currentMs ?? 0
    moveHead(ms)
    // The number on screen does not need sixty updates a second; the line does.
    if (ms - lastRead.current > 100 || ms < lastRead.current) {
      lastRead.current = ms
      setHead(ms)
    }
    if (ms >= total) { pause(); return }
    raf.current = requestAnimationFrame(tick)
  }

  async function start(fromMs = head) {
    if (!player.current) {
      player.current = new EpisodePlayer(duckDb)
      player.current.setMonitor(monitor)
      player.current.setLaneState(muted, soloed, laneGain)
    }
    if (state === 'idle') {
      setState('loading')
      const list = await buildClips()
      if (list.length === 0) { setState('idle'); return }
      setClips(list)
      await player.current.prepare(list, (done, t) => setProgress({ done, total: t }))
      draw()
    }
    player.current.play(fromMs)
    setState('playing')
    raf.current = requestAnimationFrame(tick)
  }

  function pause() {
    player.current?.pause()
    cancelAnimationFrame(raf.current)
    setState(s => (s === 'idle' ? 'idle' : 'ready'))
  }

  function seek(ms: number) {
    const clamped = Math.max(0, Math.min(ms, total))
    setHead(clamped)
    lastRead.current = clamped
    moveHead(clamped)
    player.current?.seek(clamped)
  }

  function jump(dir: 1 | -1) {
    const marks = [...elements].map(e => e.start_ms).sort((a, b) => a - b)
    const next = dir === 1
      ? marks.find(m => m > head + 120)
      : [...marks].reverse().find(m => m < head - 400)
    seek(next ?? (dir === 1 ? total : 0))
  }

  function toggle(set: Set<Lane>, lane: Lane, apply: (s: Set<Lane>) => void) {
    const next = new Set(set)
    next.has(lane) ? next.delete(lane) : next.add(lane)
    apply(next)
  }

  useEffect(() => {
    player.current?.setLaneState(muted, soloed, laneGain)
    draw()
  }, [muted, soloed, laneGain, draw])

  useEffect(() => { player.current?.setMonitor(monitor) }, [monitor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.code === 'Space') { e.preventDefault(); state === 'playing' ? pause() : start() }
      if (e.key === 'ArrowLeft' && e.shiftKey) { e.preventDefault(); jump(-1) }
      if (e.key === 'ArrowRight' && e.shiftKey) { e.preventDefault(); jump(1) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  /** Dragging anywhere on the lanes scrubs, and a click on a clip selects its line. */
  function onPointerDown(e: React.PointerEvent) {
    const rect = laneArea.current!.getBoundingClientRect()
    const toMs = (clientX: number) =>
      ((clientX - rect.left) / rect.width) * total

    const y = e.clientY - rect.top
    const laneIndex = Math.floor(y / LANE_H)
    const lane = LANES[laneIndex]
    const ms = toMs(e.clientX)
    if (lane) {
      const hit = drawable.find(c =>
        c.lane === lane && ms >= c.startMs && ms <= c.startMs + Math.max(c.durationMs, total * 0.004))
      if (hit) onSelect(hit.id)
    }

    seek(ms)
    const move = (ev: PointerEvent) => seek(toMs(ev.clientX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const selected = elements.find(e => e.id === selectedId) ?? null
  function onNudge(delta: number) {
    if (selected) onGain(selected.id, Math.max(-24, Math.min(12, (selected.gain_db ?? 0) + delta)))
  }

  const span = Math.max(total, 1)
  const step = stepFor(span, width)
  const ticks: number[] = []
  for (let s = 0; s * 1000 <= span; s += step) ticks.push(s * 1000)

  return (
    <div className="panel" data-collapsed={collapsed}>
      <div className="panel-bar">
        <button className="play" onClick={() => (state === 'playing' ? pause() : start())}
          disabled={state === 'loading'} aria-label={state === 'playing' ? 'Pause' : 'Play episode'}>
          {state === 'loading' ? <Spinner size={14} /> : state === 'playing' ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button className="tp-btn" onClick={() => jump(-1)} aria-label="Previous element" title="Previous element (shift + left)">
          <SkipBack size={15} />
        </button>
        <button className="tp-btn" onClick={() => jump(1)} aria-label="Next element" title="Next element (shift + right)">
          <SkipForward size={15} />
        </button>

        <span className="tp-divider" />
        <span className="tp-time tnum">{tc(head)}</span>
        <span className="tp-sep">/</span>
        <span className="tp-total tnum">{tc(total)}</span>

        {state === 'loading' && (
          <span className="tp-status">Preparing {progress.done} of {progress.total}</span>
        )}

        {selected && (
          <div className="clip-tools">
            <span className="clip-name">{selected.text_content.slice(0, 34)}</span>
            <button className="tp-btn" onClick={() => onNudge(-1)} title="Quieter by 1 dB">−</button>
            <span className="fader-db tnum">
              {selected.gain_db > 0 ? '+' : ''}{selected.gain_db} dB
            </span>
            <button className="tp-btn" onClick={() => onNudge(1)} title="Louder by 1 dB">+</button>
            <button className="btn" data-variant="quiet" onClick={onTrimSelected}>Trim</button>
          </div>
        )}

        <div className="tp-right">
          <div className="segmented dark" role="group" aria-label="Monitoring">
            <button aria-pressed={monitor === 'studio'} onClick={() => setMonitor('studio')}>Studio</button>
            <button aria-pressed={monitor === 'phone'} onClick={() => setMonitor('phone')}>Phone speaker</button>
          </div>
          <button className="tp-btn" onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Show timeline' : 'Hide timeline'}>
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="panel-grid">
          <div className="lane-heads">
            <div className="ruler-spacer" />
            {LANES.map(lane => (
              <div className="lane-head" key={lane} style={{ height: LANE_H }}>
                <span className="lane-name">{LANE_LABEL[lane]}</span>
                <button
                  className="lane-btn" data-on={muted.has(lane)}
                  onClick={() => toggle(muted, lane, setMuted)}
                  title={`Mute ${LANE_LABEL[lane].toLowerCase()}`}
                >M</button>
                <button
                  className="lane-btn" data-on={soloed.has(lane)} data-solo="true"
                  onClick={() => toggle(soloed, lane, setSoloed)}
                  title={`Solo ${LANE_LABEL[lane].toLowerCase()}`}
                >S</button>
                <input
                  className="fader"
                  type="range" min={-24} max={12} step={1}
                  value={laneGain[lane] ?? 0}
                  onChange={e => onLaneGain(lane, Number(e.target.value))}
                  title={`${LANE_LABEL[lane]} level`}
                  aria-label={`${LANE_LABEL[lane]} level in decibels`}
                />
                <span className="fader-db tnum">
                  {(laneGain[lane] ?? 0) > 0 ? '+' : ''}{laneGain[lane] ?? 0}
                </span>
              </div>
            ))}
          </div>

          <div className="lane-area" ref={laneArea} onPointerDown={onPointerDown}>
            <div className="ruler">
              {ticks.map(ms => (
                <span className="tick" key={ms} style={{ left: `${(ms / span) * 100}%` }}>
                  <i /><b className="tnum">{tc(ms).slice(0, -2)}</b>
                </span>
              ))}
            </div>
            <canvas ref={canvas} className="lane-canvas" />
            <div className="playhead" ref={playhead} style={{ left: 0 }} />
          </div>
        </div>
      )}
    </div>
  )
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + rr, y)
  g.arcTo(x + w, y, x + w, y + h, rr)
  g.arcTo(x + w, y + h, x, y + h, rr)
  g.arcTo(x, y + h, x, y, rr)
  g.arcTo(x, y, x + w, y, rr)
  g.closePath()
}

export { HEAD_W }
