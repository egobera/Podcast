import { useCallback, useEffect, useRef, useState } from 'react'
import { signedUrl, uploadAudio } from '../lib/supabase'
import { extractPeaks } from '../lib/player'
import { toWav } from '../lib/export'
import { Modal, useToast } from './ui'
import { Play, Pause } from './icons'

function tc(ms: number) {
  const t = Math.max(0, ms) / 1000
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.floor((t % 1) * 10)}`
}

/**
 * Trims a clip and saves the result as a new file.
 *
 * Generated music almost never lands at the length a scene needs: Suno hands back a minute
 * when the opening theme is fifteen seconds. This cuts the ends and, for anything that has
 * to loop, fades them so the seam does not click.
 */
export default function TrimEditor({
  path, title, userId, projectId, onSaved, onClose,
}: {
  path: string
  title: string
  userId: string
  projectId: string
  onSaved: (newPath: string, durationMs: number) => void
  onClose: () => void
}) {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(1)
  const [fade, setFade] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [saving, setSaving] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const toast = useToast()

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
      setPeaks(extractPeaks(buf, 900))
    })()
    return () => {
      dead = true
      srcRef.current?.stop()
      ctxRef.current?.close()
    }
  }, [path, toast])

  const draw = useCallback(() => {
    const cv = canvas.current
    if (!cv || !peaks) return
    const w = cv.clientWidth
    const h = 108
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    cv.width = w * dpr; cv.height = h * dpr
    cv.style.height = `${h}px`
    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)

    const mid = h / 2
    for (let x = 0; x < w; x++) {
      const p = peaks[Math.floor((x / w) * peaks.length)]
      const inside = x / w >= start && x / w <= end
      g.fillStyle = inside ? '#3f86c4' : '#c9d3de'
      const bar = Math.max(p * (h / 2 - 6), 1)
      g.fillRect(x, mid - bar, 1, bar * 2)
    }

    for (const [pos, side] of [[start, 'l'], [end, 'r']] as const) {
      const x = pos * w
      g.fillStyle = '#16558f'
      g.fillRect(side === 'l' ? x : x - 2, 0, 2, h)
    }
  }, [peaks, start, end])

  useEffect(() => { draw() }, [draw])
  useEffect(() => {
    const ro = new ResizeObserver(draw)
    if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [draw])

  function grab(e: React.PointerEvent) {
    const rect = wrap.current!.getBoundingClientRect()
    const at = (x: number) => Math.min(Math.max((x - rect.left) / rect.width, 0), 1)
    const p = at(e.clientX)
    const moving: 'start' | 'end' = Math.abs(p - start) < Math.abs(p - end) ? 'start' : 'end'

    const move = (ev: PointerEvent) => {
      const v = at(ev.clientX)
      if (moving === 'start') setStart(Math.min(v, end - 0.005))
      else setEnd(Math.max(v, start + 0.005))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    move(e.nativeEvent)
  }

  function preview() {
    if (!buffer || !ctxRef.current) return
    srcRef.current?.stop()
    if (playing) { setPlaying(false); return }
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') ctx.resume()
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.onended = () => setPlaying(false)
    src.start(0, start * buffer.duration, (end - start) * buffer.duration)
    srcRef.current = src
    setPlaying(true)
  }

  async function save() {
    if (!buffer) return
    setSaving(true)
    try {
      const rate = buffer.sampleRate
      const from = Math.floor(start * buffer.length)
      const to = Math.floor(end * buffer.length)
      const length = Math.max(to - from, rate / 10)

      const out = new OfflineAudioContext(buffer.numberOfChannels, length, rate)
      const src = out.createBufferSource()
      src.buffer = buffer
      const gain = out.createGain()

      if (fade) {
        // 25 ms in and out. Enough to kill a click, short enough to be inaudible.
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
      toast(`Saved. ${tc((length / rate) * 1000)}`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the trim', 'bad')
    } finally {
      setSaving(false)
    }
  }

  const total = buffer ? buffer.duration * 1000 : 0
  const selected = (end - start) * total

  return (
    <Modal
      title={`Trim ${title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" data-variant="quiet" onClick={onClose}>Cancel</button>
          <button className="btn" data-variant="primary" disabled={!buffer || saving} onClick={save}>
            {saving ? 'Saving' : 'Save trimmed copy'}
          </button>
        </>
      }
    >
      {!buffer && <p className="notice">Loading the audio…</p>}

      {buffer && (
        <>
          <div className="trim-wrap" ref={wrap} onPointerDown={grab}>
            <canvas ref={canvas} className="trim-canvas" />
          </div>

          <div className="trim-bar">
            <button className="btn" onClick={preview}>
              {playing ? <Pause size={12} /> : <Play size={12} />}
              {playing ? 'Stop' : 'Preview'}
            </button>
            <span className="dur tnum">
              {tc(start * total)} to {tc(end * total)} · {tc(selected)} of {tc(total)}
            </span>
            <label className="trim-fade">
              <input type="checkbox" checked={fade} onChange={e => setFade(e.target.checked)} />
              Fade the ends
            </label>
          </div>

          <p className="notice">
            Drag either edge. The original stays where it is; this saves a trimmed copy and
            points the asset at it, so you can always go back.
          </p>
        </>
      )}
    </Modal>
  )
}
