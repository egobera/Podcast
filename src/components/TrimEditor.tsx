import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { signedUrl, uploadAudio } from '../lib/supabase'
import { extractPeaks } from '../lib/player'
import { toWav } from '../lib/export'
import { Modal, useToast } from './ui'
import { Play, Pause, SkipBack } from './icons'

function tc(sec: number) {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 100).toString().padStart(2, '0')}`
}

const ZOOMS = [1, 2, 4, 8]

/**
 * Trimming, with somewhere to listen from.
 *
 * The first version had two handles and a preview button that always started at the in
 * point, which is useless for finding the exact moment a phrase ends. This one has a
 * playhead you can put anywhere, plays from it, loops the selection, zooms in, and takes
 * the keyboard, because trimming is done by ear and by ear means listening to the same
 * half second twenty times.
 */
export default function TrimEditor({
  path, title, userId, projectId, expectedMs, onSaved, onClose,
}: {
  path: string
  title: string
  userId: string
  projectId: string
  expectedMs?: number | null
  onSaved: (newPath: string, durationMs: number) => void
  onClose: () => void
}) {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [inSec, setInSec] = useState(0)
  const [outSec, setOutSec] = useState(0)
  const [head, setHead] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [scroll, setScroll] = useState(0)
  const [loop, setLoop] = useState(false)
  const [fade, setFade] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [saving, setSaving] = useState(false)

  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const startedAt = useRef(0)
  const startedFrom = useRef(0)
  const raf = useRef(0)
  const [width, setWidth] = useState(600)
  const toast = useToast()

  const duration = buffer?.duration ?? 0
  const view = duration / zoom
  const viewStart = Math.min(scroll, Math.max(duration - view, 0))

  /* ---------- load ---------- */

  useEffect(() => {
    let dead = false
    ;(async () => {
      const url = await signedUrl(path)
      if (!url) { toast('Could not open that file.', 'bad'); return }
      const ctx = new AudioContext()
      ctxRef.current = ctx
      const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer())
      if (dead) return
      setBuffer(buf)
      setPeaks(extractPeaks(buf, 4000))
      setOutSec(buf.duration)
    })()
    return () => {
      dead = true
      cancelAnimationFrame(raf.current)
      srcRef.current?.stop()
      ctxRef.current?.close()
    }
  }, [path, toast])

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [buffer])

  /* ---------- drawing ---------- */

  const draw = useCallback(() => {
    const cv = canvas.current
    if (!cv || !peaks || !buffer) return
    const h = 132
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    cv.width = width * dpr
    cv.height = h * dpr
    cv.style.height = `${h}px`
    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, h)

    const secToX = (s: number) => ((s - viewStart) / view) * width
    const mid = h / 2 + 8

    // Waveform
    for (let x = 0; x < width; x++) {
      const sec = viewStart + (x / width) * view
      const p = peaks[Math.min(Math.floor((sec / buffer.duration) * peaks.length), peaks.length - 1)]
      const inside = sec >= inSec && sec <= outSec
      g.fillStyle = inside ? '#3f86c4' : '#c9d3de'
      const bar = Math.max(p * (h / 2 - 22), 1)
      g.fillRect(x, mid - bar, 1, bar * 2)
    }

    // The parts being cut away, dimmed
    g.fillStyle = 'rgba(250, 251, 252, .55)'
    if (inSec > viewStart) g.fillRect(0, 16, secToX(inSec), h - 16)
    if (outSec < viewStart + view) {
      g.fillRect(secToX(outSec), 16, width - secToX(outSec), h - 16)
    }

    // Ruler
    const step = view > 40 ? 10 : view > 12 ? 5 : view > 4 ? 1 : 0.5
    g.fillStyle = '#8494a5'
    g.font = '9px "IBM Plex Mono", monospace'
    for (let s = Math.ceil(viewStart / step) * step; s < viewStart + view; s += step) {
      const x = secToX(s)
      g.fillRect(x, 0, 1, 6)
      g.fillText(tc(s).slice(0, -3), x + 3, 9)
    }

    // Handles
    for (const [sec, side] of [[inSec, 'in'], [outSec, 'out']] as const) {
      const x = secToX(sec)
      if (x < -8 || x > width + 8) continue
      g.fillStyle = '#16558f'
      g.fillRect(side === 'in' ? x : x - 2, 12, 2, h - 12)
      g.fillRect(side === 'in' ? x : x - 9, 12, 9, 12)
    }

    // Playhead
    const px = secToX(head)
    if (px >= 0 && px <= width) {
      g.fillStyle = '#a13c3c'
      g.fillRect(px, 12, 1, h - 12)
      g.beginPath()
      g.arc(px, 16, 4, 0, Math.PI * 2)
      g.fill()
    }
  }, [peaks, buffer, width, viewStart, view, inSec, outSec, head])

  useEffect(() => { draw() }, [draw])

  /* ---------- transport ---------- */

  const stop = useCallback(() => {
    srcRef.current?.stop()
    srcRef.current = null
    cancelAnimationFrame(raf.current)
    setPlaying(false)
  }, [])

  const play = useCallback((from: number, until?: number) => {
    if (!buffer || !ctxRef.current) return
    srcRef.current?.stop()
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    const stopAt = until ?? buffer.duration
    src.start(0, from, Math.max(stopAt - from, 0.01))
    srcRef.current = src
    startedAt.current = ctx.currentTime
    startedFrom.current = from
    setPlaying(true)

    src.onended = () => {
      if (srcRef.current !== src) return
      if (loop && until !== undefined) play(inSec, outSec)
      else { setHead(stopAt); stop() }
    }

    const tick = () => {
      const at = startedFrom.current + (ctx.currentTime - startedAt.current)
      setHead(Math.min(at, stopAt))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }, [buffer, loop, inSec, outSec, stop])

  /* ---------- pointer ---------- */

  function onPointerDown(e: React.PointerEvent) {
    if (!buffer) return
    const rect = wrap.current!.getBoundingClientRect()
    const secAt = (clientX: number) =>
      Math.min(Math.max(viewStart + ((clientX - rect.left) / rect.width) * view, 0), buffer.duration)

    const sec = secAt(e.clientX)
    const pxPerSec = width / view
    const nearIn = Math.abs(sec - inSec) * pxPerSec < 10
    const nearOut = Math.abs(sec - outSec) * pxPerSec < 10

    let mode: 'in' | 'out' | 'head' = 'head'
    if (nearIn && (!nearOut || Math.abs(sec - inSec) <= Math.abs(sec - outSec))) mode = 'in'
    else if (nearOut) mode = 'out'

    const apply = (s: number) => {
      if (mode === 'in') setInSec(Math.min(s, outSec - 0.02))
      else if (mode === 'out') setOutSec(Math.max(s, inSec + 0.02))
      else { setHead(s); if (playing) play(s, undefined) }
    }
    apply(sec)

    const move = (ev: PointerEvent) => apply(secAt(ev.clientX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function onWheel(e: React.WheelEvent) {
    if (!buffer) return
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      setScroll(s => Math.min(Math.max(s + (e.deltaX || e.deltaY) * view * 0.002, 0), buffer.duration - view))
      return
    }
    const i = ZOOMS.indexOf(zoom)
    const next = e.deltaY < 0 ? ZOOMS[Math.min(i + 1, ZOOMS.length - 1)] : ZOOMS[Math.max(i - 1, 0)]
    if (next === zoom) return
    const centre = head
    setZoom(next)
    setScroll(Math.min(Math.max(centre - (buffer.duration / next) / 2, 0), buffer.duration - buffer.duration / next))
  }

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      const nudge = e.shiftKey ? 0.5 : 0.05

      if (e.code === 'Space') {
        e.preventDefault()
        playing ? stop() : play(head < outSec ? head : inSec, loop ? outSec : undefined)
      }
      if (e.key === 'i') { e.preventDefault(); setInSec(Math.min(head, outSec - 0.02)) }
      if (e.key === 'o') { e.preventDefault(); setOutSec(Math.max(head, inSec + 0.02)) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setHead(h => Math.max(h - nudge, 0)) }
      if (e.key === 'ArrowRight') { e.preventDefault(); setHead(h => Math.min(h + nudge, duration)) }
      if (e.key === 'l') setLoop(v => !v)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  /* ---------- save ---------- */

  async function save() {
    if (!buffer) return
    setSaving(true)
    stop()
    try {
      const rate = buffer.sampleRate
      const from = Math.floor(inSec * rate)
      const length = Math.max(Math.floor((outSec - inSec) * rate), Math.floor(rate / 10))

      const out = new OfflineAudioContext(buffer.numberOfChannels, length, rate)
      const src = out.createBufferSource()
      src.buffer = buffer
      const gain = out.createGain()

      if (fade) {
        const f = 0.025
        const dur = length / rate
        gain.gain.setValueAtTime(0, 0)
        gain.gain.linearRampToValueAtTime(1, f)
        gain.gain.setValueAtTime(1, Math.max(dur - f, f))
        gain.gain.linearRampToValueAtTime(0, dur)
      }

      src.connect(gain).connect(out.destination)
      src.start(0, from / rate, length / rate)
      const rendered = await out.startRendering()

      const blob = toWav(rendered)
      const newPath = await uploadAudio(userId, projectId, `${title}-trimmed.wav`, blob)
      onSaved(newPath, Math.round((length / rate) * 1000))
      toast(`Saved. ${tc(length / rate)}`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the trim', 'bad')
    } finally {
      setSaving(false)
    }
  }

  const selected = outSec - inSec
  const wanted = expectedMs ? expectedMs / 1000 : null

  return (
    <Modal
      title={`Trim ${title}`}
      onClose={() => { stop(); onClose() }}
      footer={
        <>
          <button className="btn" data-variant="quiet" onClick={() => { stop(); onClose() }}>Cancel</button>
          <button className="btn" data-variant="primary" disabled={!buffer || saving} onClick={save}>
            {saving ? 'Saving' : 'Save trimmed copy'}
          </button>
        </>
      }
    >
      {!buffer && <p className="notice">Loading the audio…</p>}

      {buffer && (
        <>
          <div className="trim-wrap" ref={wrap} onPointerDown={onPointerDown} onWheel={onWheel}>
            <canvas ref={canvas} className="trim-canvas" />
          </div>

          <div className="trim-bar">
            <button className="play" onClick={() => (playing ? stop() : play(head, loop ? outSec : undefined))}
              aria-label={playing ? 'Pause' : 'Play from the playhead'}>
              {playing ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <button className="tp-btn" onClick={() => { setHead(inSec); play(inSec, outSec) }}
              title="Play the selection from the start">
              <SkipBack size={14} />
            </button>
            <span className="trim-time tnum">{tc(head)}</span>

            <label className="trim-toggle">
              <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />
              Loop
            </label>

            <div className="segmented" style={{ marginLeft: 'auto' }}>
              {ZOOMS.map(z => (
                <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
                  {z === 1 ? 'Fit' : `${z}x`}
                </button>
              ))}
            </div>
          </div>

          <div className="trim-fields">
            <div className="field">
              <label htmlFor="in">Starts at</label>
              <input id="in" type="number" step={0.05} min={0} max={outSec - 0.02}
                value={inSec.toFixed(2)}
                onChange={e => setInSec(Math.min(Number(e.target.value) || 0, outSec - 0.02))} />
            </div>
            <div className="field">
              <label htmlFor="out">Ends at</label>
              <input id="out" type="number" step={0.05} min={inSec + 0.02} max={duration}
                value={outSec.toFixed(2)}
                onChange={e => setOutSec(Math.max(Number(e.target.value) || 0, inSec + 0.02))} />
            </div>
            <div className="field">
              <label>Keeps</label>
              <p className="described tnum" style={{ padding: '8px 10px' }}>
                {tc(selected)}
                {wanted && (
                  <span style={{ color: Math.abs(selected - wanted) < 1 ? 'var(--blue)' : 'var(--alert)' }}>
                    {' '}· script asks for {tc(wanted)}
                  </span>
                )}
              </p>
            </div>
          </div>

          <label className="trim-toggle">
            <input type="checkbox" checked={fade} onChange={e => setFade(e.target.checked)} />
            Fade the ends, so a loop does not click
          </label>

          <p className="notice">
            Drag the edges to trim, drag anywhere else to move the playhead.
            {' '}<kbd className="key">space</kbd> plays from it,{' '}
            <kbd className="key">i</kbd> and <kbd className="key">o</kbd> set the edges there,{' '}
            <kbd className="key">l</kbd> loops. Scroll to zoom, shift and scroll to move.
            The original stays where it is.
          </p>
        </>
      )}
    </Modal>
  )
}
