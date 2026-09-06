import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EpisodePlayer, LANES, laneOf, extractPeaks, type Clip, type Lane, type Monitor } from '../lib/player'
import { Play, Pause, SkipBack, SkipForward, ChevronDown, ChevronUp, Spinner } from './icons'
import type { AudioElement, Character, Episode, GainRole } from '../lib/types'
import { colourFor, dim, labelFor } from '../lib/palette'
import ClipCard from './ClipCard'

const LANE_LABEL: Record<Lane, string> = { voice: 'Voice', music: 'Music', effects: 'Sound' }
/* Three hues inside the blue family: cerulean for voice, indigo for music, steel for sound.
   Distinct enough to read apart at 20px tall, close enough to belong together. */
const LANE_COLOR: Record<Lane, string> = { voice: '#3f86c4', music: '#6470b4', effects: '#4a8a9e' }
const LANE_MIN = 26
const LANE_MAX = 74
const PANEL_MIN = 150
const PANEL_MAX = 620
const PANEL_KEY = 'canon.panelHeight'

/** The shortest window you can zoom into. Below this the ruler stops meaning anything. */
const MIN_SPAN_MS = 2000
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
  episode, onLaneGain, onGain, onNudge, onTrimEdges, onTrimSelected, onSplit, onFade, onMeasured,
  onFitToAudio, extraSelected, characters,
}: {
  elements: (AudioElement & { start_ms: number })[]
  total: number
  duckDb: number
  selectedId: string | null
  buildClips: () => Promise<Clip[]>
  onSelect: (id: string, additive?: boolean) => void
  extraSelected?: Set<string>
  episode: Episode
  onLaneGain: (lane: Lane, db: number) => void
  onGain: (elementId: string, db: number) => void
  onNudge: (elementId: string, offsetMs: number) => void
  onTrimEdges: (elementId: string, leadMs: number, tailMs: number) => void
  onMeasured: (m: { id: string; durationMs: number; leadMs: number; tailMs: number }[]) => void
  onTrimSelected: () => void
  onSplit: (elementId: string, atMs: number) => void
  onFitToAudio: (elementId: string) => void
  onFade: (elementId: string, inMs: number | null, outMs: number | null) => void
  characters: Character[]
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

  /*
   * The panel is where the editing happens, so it is resizable and it remembers.
   * Lane height follows it: a taller panel is only useful if the waveforms grow too.
   */
  const [panelHeight, setPanelHeight] = useState(() => {
    // The app used to be called something else; a height set then still applies.
    const saved = Number(localStorage.getItem(PANEL_KEY) ?? localStorage.getItem('estudio.panelHeight'))
    return saved >= PANEL_MIN && saved <= PANEL_MAX ? saved : 210
  })
  const laneH = Math.round(Math.min(Math.max((panelHeight - 96) / LANES.length, LANE_MIN), LANE_MAX))

  /*
   * What part of the episode is on screen.
   *
   * Showing all eight minutes at once means a line of dialogue is four pixels wide, which
   * is fine for finding your way around and useless for placing anything. The window can
   * be narrowed to a couple of seconds, and everything else measures against it.
   */
  const [view, setView] = useState<{ start: number; span: number } | null>(null)
  const span = view ? view.span : Math.max(total, 1)
  const viewStart = view ? view.start : 0

  const clampView = useCallback((start: number, wanted: number) => {
    const full = Math.max(total, 1)
    const s = Math.min(Math.max(wanted, MIN_SPAN_MS), full)
    return { start: Math.min(Math.max(start, 0), Math.max(full - s, 0)), span: s }
  }, [total])

  const zoomAround = useCallback((factor: number, atMs?: number) => {
    const full = Math.max(total, 1)
    const current = view ?? { start: 0, span: full }
    const centre = atMs ?? current.start + current.span / 2
    const wanted = current.span * factor
    if (wanted >= full) { setView(null); return }
    const ratio = (centre - current.start) / current.span
    setView(clampView(centre - wanted * ratio, wanted))
  }, [total, view, clampView])
  const [clips, setClips] = useState<Clip[]>([])
  const [width, setWidth] = useState(800)
  const raf = useRef(0)
  const laneArea = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOffset, setDragOffsetState] = useState<number | null>(null)
  const lastDelta = useRef<number | null>(null)
  const [dragEdges, setDragEdges] = useState<{ lead: number; tail: number } | null>(null)
  const peakCache = useRef(new Map<string, Float32Array>())

  /** Where each scene begins, for the band above and the dividers behind. */
  const scenes = (() => {
    const out: { name: string; startMs: number }[] = []
    for (const el of [...elements].sort((a, b) => a.idx - b.idx)) {
      if (out.length === 0 || out[out.length - 1].name !== el.scene) {
        out.push({ name: el.scene, startMs: el.start_ms })
      }
    }
    return out
  })()
  const pendingEdges = useRef<{ lead: number; tail: number } | null>(null)
  const headRef = useRef(0)
  const groupDelta = useRef<number | null>(null)
  const [popover, setPopover] = useState<{ id: string; x: number } | null>(null)
  const [hover, setHover] = useState<
    { x: number; ms: number; label: string; colour: string; length: number } | null>(null)

  /** Reading the timeline should not require clicking it. */
  function onHover(e: React.PointerEvent) {
    const rect = laneArea.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const ms = viewStart + (x / rect.width) * span
    const lane = LANES[Math.floor((e.clientY - rect.top) / laneH)]
    const under = lane && drawable.find(c =>
      c.lane === lane && ms >= c.startMs && ms <= c.startMs + c.durationMs)
    const el = under && elements.find(e => e.id === under.id)
    setHover({
      x,
      ms,
      label: under?.label ?? '',
      colour: under?.colour ?? '',
      length: el ? el.duration_ms : 0,
    })
  }
  const panelHeightRef = useRef(0)
  panelHeightRef.current = panelHeight
  const setDragOffset = (v: number | null) => {
    lastDelta.current = v === null ? null : v - (elements.find(e => e.id === dragging)?.offset_ms ?? 0)
    setDragOffsetState(v)
  }
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
    if (el) {
      const at = ((ms - viewRef.current.start) / viewRef.current.span) * widthRef.current
      el.style.transform = `translateX(${at}px)`
      el.style.opacity = at < -4 || at > widthRef.current + 4 ? '0' : '1'
    }
  }, [])
  const widthRef = useRef(800)
  widthRef.current = width
  const viewRef = useRef({ start: 0, span: 1 })
  viewRef.current = { start: viewStart, span }

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
      startMs: (dragging === e.id && dragOffset !== null)
        ? Math.max(e.start_ms + (dragOffset - (e.offset_ms ?? 0)), 0)
        : shown.current.get(e.id) ?? e.start_ms,
      durationMs: dragging === e.id && dragEdges
        ? Math.max(e.duration_ms - dragEdges.lead - dragEdges.tail, 40)
        : Math.max(e.duration_ms - (e.lead_silence_ms ?? 0) - (e.tail_silence_ms ?? 0), 40),
      url: clips.find(c => c.id === e.id)?.url,
      colour: colourFor(e, characters),
      label: labelFor(e, characters),
      // Anything that has been generated has audio, approved or not. Treating only
      // approved clips as real made a freshly generated episode look empty.
      ready: e.status === 'approved' || e.status === 'generated' || !!e.series_asset_id,
    }))

  /**
   * The timeline, drawn to be read.
   *
   * The old one was a row of anonymous rectangles: it told you where sound existed and
   * nothing else. Three things changed that. Every clip carries its speaker and its first
   * words, so a line can be found without clicking it. Every character has a colour, so
   * the voice lane shows the shape of the conversation before you read anything. And the
   * scenes are drawn as a band across the top, so an episode has visible structure instead
   * of being one long strip.
   */
  const draw = useCallback(() => {
    const cv = canvas.current
    if (!cv || width <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const h = LANES.length * laneH
    cv.width = width * dpr
    cv.height = h * dpr
    cv.style.width = `${width}px`
    cv.style.height = `${h}px`
    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, h)

    const px = (ms: number) => ((ms - viewStart) / span) * width

    LANES.forEach((lane, li) => {
      const top = li * laneH
      const barH = laneH - 6
      const y = top + 3

      // The lane bed, with a hairline so lanes read as separate rows.
      g.fillStyle = li % 2 === 0 ? '#131d28' : '#111a24'
      g.fillRect(0, top, width, laneH)
      g.strokeStyle = 'rgba(255,255,255,.035)'
      g.beginPath()
      g.moveTo(0, top + laneH - 0.5)
      g.lineTo(width, top + laneH - 0.5)
      g.stroke()

      const silenced = muted.has(lane) || (soloed.size > 0 && !soloed.has(lane))

      for (const c of drawable.filter(d => d.lane === lane)) {
        const x = px(c.startMs)
        const w = Math.max(px(c.startMs + c.durationMs) - x, 3)
        if (x + w < -40 || x > width + 40) continue

        const selected = c.id === selectedId
        const grouped = extraSelected?.has(c.id)
        g.globalAlpha = silenced ? 0.22 : 1

        // Body
        g.fillStyle = c.ready ? dim(c.colour, 0.34) : 'rgba(255,255,255,.05)'
        roundRect(g, x, y, w, barH, 3)
        g.fill()

        // A colour spine on the left edge: the fastest way to tell who is speaking.
        if (c.ready) {
          g.fillStyle = c.colour
          roundRect(g, x, y, Math.min(3, w), barH, 2)
          g.fill()
        } else {
          g.strokeStyle = 'rgba(255,255,255,.18)'
          g.setLineDash([3, 3])
          roundRect(g, x + 0.5, y + 0.5, Math.max(w - 1, 2), barH - 1, 3)
          g.stroke()
          g.setLineDash([])
        }

        // Waveform, mirrored around the middle of the clip.
        const peaks = c.url ? peakCache.current.get(c.url) : undefined
        if (peaks && w > 6) {
          const mid = y + barH / 2
          const half = (barH - 8) / 2
          g.fillStyle = c.colour
          g.globalAlpha = silenced ? 0.22 : 0.85
          const from = Math.max(x, 0)
          const to = Math.min(x + w, width)
          for (let sx = from; sx < to; sx++) {
            const t = (sx - x) / w
            const v = peaks[Math.min(Math.floor(t * peaks.length), peaks.length - 1)]
            const bar = Math.max(v * half, 0.5)
            g.fillRect(sx, mid - bar, 1, bar * 2)
          }
          g.globalAlpha = silenced ? 0.22 : 1
        }

        // Deliberate fades, drawn as the part being taken away.
        const el = elements.find(x2 => x2.id === c.id)
        const fadeIn = el?.fade_in_ms ?? 0
        const fadeOut = el?.fade_out_ms ?? 0
        if ((fadeIn > 0 || fadeOut > 0) && w > 8) {
          g.fillStyle = 'rgba(11,17,24,.82)'
          if (fadeIn > 0) {
            const fw = Math.min(((fadeIn / span) * width), w)
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + fw, y); g.lineTo(x, y + barH)
            g.closePath(); g.fill()
          }
          if (fadeOut > 0) {
            const fw = Math.min(((fadeOut / span) * width), w)
            g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w - fw, y); g.lineTo(x + w, y + barH)
            g.closePath(); g.fill()
          }
        }

        /*
         * No text on the clip.
         *
         * A label and a waveform fight for the same few pixels, and the waveform is the
         * thing you are actually reading: where the words are, where the breath is, where
         * the silence sits. The name is one hover away, and the whole clip is one click
         * away, so nothing is lost by keeping the surface quiet.
         */

        if (selected || grouped) {
          g.strokeStyle = selected ? '#ffffff' : c.colour
          g.lineWidth = selected ? 1.5 : 1
          roundRect(g, x + 0.75, y + 0.75, Math.max(w - 1.5, 2), barH - 1.5, 3)
          g.stroke()
          g.lineWidth = 1

          // Handles, so the edges announce that they can be dragged.
          if (selected && w > 14) {
            g.fillStyle = '#ffffff'
            g.fillRect(x, y + barH / 2 - 6, 2, 12)
            g.fillRect(x + w - 2, y + barH / 2 - 6, 2, 12)
          }
        }

        g.globalAlpha = 1
      }
    })

    // Scene boundaries, running the full height behind everything else.
    g.strokeStyle = 'rgba(255,255,255,.10)'
    g.setLineDash([2, 4])
    for (const s of scenes) {
      const x = px(s.startMs)
      if (x < 0 || x > width) continue
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke()
    }
    g.setLineDash([])
  }, [width, drawable, muted, soloed, selectedId, viewStart, span, laneH, elements, extraSelected, scenes])


  useEffect(() => { draw() })
  useEffect(() => { moveHead(head) }, [width, collapsed, moveHead, head, viewStart, span, panelHeight])

  /* Anything that has to stop above the panel needs to know how tall it currently is. */
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--panel-h',
      `${collapsed ? 52 : panelHeight + 8}px`,
    )
    return () => { document.documentElement.style.removeProperty('--panel-h') }
  }, [panelHeight, collapsed])

  function tick() {
    const ms = player.current?.currentMs ?? 0
    headRef.current = ms
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
      await player.current.prepare(
        list,
        (done, t) => setProgress({ done, total: t }),
        onMeasured,
      )

      // The player has the buffers; the timeline needs their shape.
      for (const clip of list) {
        if (peakCache.current.has(clip.url)) continue
        const buffer = player.current.bufferFor(clip.url)
        if (buffer) peakCache.current.set(clip.url, extractPeaks(buffer, 1200))
      }
      draw()
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
    headRef.current = clamped
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
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAround(0.6, headRef.current) }
      if (e.key === '-') { e.preventDefault(); zoomAround(1.6) }
      if (e.key === '0') { e.preventDefault(); setView(null) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  /**
   * Dragging empty lane scrubs. Dragging a clip moves it in time.
   *
   * Moving is what an editor does when something lands a beat late, and having to open a
   * panel and type a number is why nobody adjusts anything. The move is written as an
   * offset, so the rhythm engine keeps working around it.
   */
  function onPointerDown(e: React.PointerEvent) {
    const rect = laneArea.current!.getBoundingClientRect()
    const toMs = (clientX: number) => viewStart + ((clientX - rect.left) / rect.width) * span

    const y = e.clientY - rect.top
    const lane = LANES[Math.floor(y / laneH)]
    const ms = toMs(e.clientX)

    const hit = lane && drawable.find(c =>
      c.lane === lane && ms >= c.startMs && ms <= c.startMs + Math.max(c.durationMs, total * 0.004))

    if (hit) {
      const additive = e.shiftKey || e.metaKey
      onSelect(hit.id, additive)
      const el = elements.find(x => x.id === hit.id)
      if (!el) return

      /* Everything selected moves by the same amount, so a scene keeps its internal shape. */
      const group = extraSelected && extraSelected.size > 1 && extraSelected.has(hit.id)
        ? elements.filter(x => extraSelected.has(x.id))
        : [el]
      const startOffsets = new Map(group.map(g => [g.id, g.offset_ms ?? 0]))

      const pxPerMs = rect.width / span
      const nearLeft = Math.abs(ms - hit.startMs) * pxPerMs < 6
      const nearRight = Math.abs(ms - (hit.startMs + hit.durationMs)) * pxPerMs < 6
      const mode: 'move' | 'left' | 'right' =
        nearLeft ? 'left' : nearRight ? 'right' : 'move'

      /*
       * Trimming from the timeline writes the same lead and tail the silence detector
       * uses, so it is not a cut: the file is untouched and the edges can be pulled back
       * out again.
       */
      const startOffset = el.offset_ms ?? 0
      const startLead = el.lead_silence_ms ?? 0
      const startTail = el.tail_silence_ms ?? 0
      const grabbedAt = ms
      let moved = false
      setDragging(hit.id)

      /** Edges of every other clip, and the playhead, to pull towards. */
      const magnets = [
        headRef.current,
        ...drawable.filter(c => c.id !== hit.id)
          .flatMap(c => [c.startMs, c.startMs + c.durationMs]),
      ]
      const snap = (value: number) => {
        const reach = span * 0.006
        let best = value
        let closest = reach
        for (const m of magnets) {
          const d = Math.abs(m - value)
          if (d < closest) { closest = d; best = m }
        }
        return best
      }

      const move = (ev: PointerEvent) => {
        const delta = toMs(ev.clientX) - grabbedAt
        if (Math.abs(delta) < 24 && !moved) return
        moved = true

        if (mode === 'move') {
          const snapped = snap(hit.startMs + delta) - hit.startMs
          setDragOffset(Math.round(startOffset + (ev.shiftKey ? delta : snapped)))
          groupDelta.current = ev.shiftKey ? delta : snapped
        } else if (mode === 'left') {
          pendingEdges.current = {
            lead: Math.max(startLead + Math.round(delta), 0),
            tail: startTail,
          }
          setDragEdges({ ...pendingEdges.current })
        } else {
          pendingEdges.current = {
            lead: startLead,
            tail: Math.max(startTail - Math.round(delta), 0),
          }
          setDragEdges({ ...pendingEdges.current })
        }
      }

      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setDragging(null)
        if (!moved) {
          const rect2 = laneArea.current?.getBoundingClientRect()
          const at = rect2 ? ((hit.startMs + hit.durationMs / 2 - viewStart) / span) * rect2.width : 0
          setPopover({ id: hit.id, x: at })
        }
        if (moved) {
          if (mode === 'move') {
            const shift = Math.round(groupDelta.current ?? 0)
            for (const g of group) onNudge(g.id, (startOffsets.get(g.id) ?? 0) + shift)
          }
          else if (pendingEdges.current) {
            onTrimEdges(hit.id, pendingEdges.current.lead, pendingEdges.current.tail)
          }
          groupDelta.current = null
        }
        setDragOffset(null)
        setDragEdges(null)
        pendingEdges.current = null
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return
    }

    setPopover(null)
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
  /** The dB trim buttons, named apart from the timing nudge they sit next to. */
  function nudgeGain(delta: number) {
    if (selected) onGain(selected.id, Math.max(-24, Math.min(12, (selected.gain_db ?? 0) + delta)))
  }

  const step = stepFor(span, width)
  const ticks: number[] = []
  for (let t = Math.ceil(viewStart / 1000 / step) * step; t * 1000 <= viewStart + span; t += step) {
    ticks.push(t * 1000)
  }

  /** Wheel zooms around the pointer; shift or a horizontal wheel pans. */
  function onWheel(e: React.WheelEvent) {
    const rect = laneArea.current?.getBoundingClientRect()
    if (!rect) return
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const delta = (e.deltaX || e.deltaY) * span * 0.0015
      setView(clampView(viewStart + delta, span))
      return
    }
    const at = viewStart + ((e.clientX - rect.left) / rect.width) * span
    zoomAround(e.deltaY > 0 ? 1.25 : 0.8, at)
  }

  /** Drag the top edge to make the panel taller. */
  function onResize(e: React.PointerEvent) {
    e.preventDefault()
    const startY = e.clientY
    const startH = panelHeight
    const move = (ev: PointerEvent) => {
      const next = Math.min(Math.max(startH + (startY - ev.clientY), PANEL_MIN), PANEL_MAX)
      setPanelHeight(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      localStorage.setItem(PANEL_KEY, String(panelHeightRef.current))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="panel" data-collapsed={collapsed}>
      {!collapsed && <div className="panel-grip" onPointerDown={onResize} title="Drag to resize" />}
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

        <div className="zoom-tools">
          <button className="tp-btn" onClick={() => zoomAround(1.6)} title="Zoom out">−</button>
          <span className="zoom-read tnum">{(span / 1000).toFixed(span < 20000 ? 1 : 0)}s</span>
          <button className="tp-btn" onClick={() => zoomAround(0.6, head)} title="Zoom in on the playhead">+</button>
          <button className="tp-btn" onClick={() => setView(null)} title="Show the whole episode"
            disabled={!view}>Fit</button>
        </div>

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
              <div className="lane-head" key={lane} style={{ height: laneH }} data-lane={lane}>
                <span className="lane-swatch" style={{ background: LANE_COLOR[lane] }} />
                <span className="lane-name">{LANE_LABEL[lane]}</span>
                <span className="lane-count tnum">
                  {drawable.filter(c => c.lane === lane).length}
                </span>
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

          <div className="lane-area" ref={laneArea} onPointerDown={onPointerDown} onWheel={onWheel}
            onPointerMove={onHover} onPointerLeave={() => setHover(null)}>
          <div className="scene-band">
            {scenes.map((sc, i) => {
              const next = scenes[i + 1]
              const from = ((sc.startMs - viewStart) / span) * 100
              const to = next ? ((next.startMs - viewStart) / span) * 100 : 100
              if (to < 0 || from > 100) return null
              return (
                <span
                  key={`${sc.name}-${sc.startMs}`}
                  className="scene-chip"
                  style={{ left: `${Math.max(from, 0)}%`, width: `${Math.min(to, 100) - Math.max(from, 0)}%` }}
                  title={sc.name}
                >
                  {sc.name}
                </span>
              )
            })}
          </div>
            <div className="ruler">
              {ticks.map(ms => (
                <span className="tick" key={ms} style={{ left: `${((ms - viewStart) / span) * 100}%` }}>
                  <i /><b className="tnum">{tc(ms).slice(0, -2)}</b>
                </span>
              ))}
            </div>
            <canvas ref={canvas} className="lane-canvas" />

            {hover && !popover && (
              <div className="hover-tip" style={{ left: `${hover.x}px` }}>
                <span className="hover-time tnum">{tc(hover.ms)}</span>
                {hover.label && (
                  <>
                    <span className="hover-dot" style={{ background: hover.colour }} />
                    <span className="hover-label">{hover.label}</span>
                    <span className="hover-len tnum">{tc(hover.length)}</span>
                  </>
                )}
              </div>
            )}
            {popover && (() => {
              const el = elements.find(e => e.id === popover.id)
              if (!el) return null
              const inside = head > el.start_ms && head < el.start_ms + el.duration_ms
              return (
                <ClipCard
                  element={el}
                  characters={characters}
                  x={popover.x}
                  playing={false}
                  canSplit={inside}
                  onPlay={() => onSelect(el.id)}
                  onGain={db => onGain(el.id, db)}
                  onNudge={ms => onNudge(el.id, ms)}
                  onFade={(a, b) => onFade(el.id, a, b)}
                  onFit={() => onFitToAudio(el.id)}
                  onSplit={() => onSplit(el.id, head)}
                  onTrim={onTrimSelected}
                  onClose={() => setPopover(null)}
                />
              )
            })()}

            {view && (
              <div className="minimap" title="Where you are in the episode">
                <span style={{
                  left: `${(viewStart / Math.max(total, 1)) * 100}%`,
                  width: `${Math.max((span / Math.max(total, 1)) * 100, 1)}%`,
                }} />
              </div>
            )}
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
