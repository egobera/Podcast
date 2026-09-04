/**
 * One thing plays at a time.
 *
 * Every play button in the app used to make its own Audio element and start it, which
 * meant no way to stop, and two clips talking over each other the moment you clicked
 * twice. This keeps a single element, hands out its state, and lets any button both
 * start and stop.
 */

type Listener = (playingPath: string | null) => void

let current: HTMLAudioElement | null = null
let currentKey: string | null = null
const listeners = new Set<Listener>()

function announce() {
  for (const l of listeners) l(currentKey)
}

export function onPlaybackChange(listener: Listener): () => void {
  listeners.add(listener)
  listener(currentKey)
  return () => { listeners.delete(listener) }
}

export function stopPreview() {
  current?.pause()
  current = null
  currentKey = null
  announce()
}

/** Starts a clip, or stops it if it is the one already playing. */
export function togglePreview(key: string, url: string) {
  if (currentKey === key) { stopPreview(); return }

  current?.pause()
  const audio = new Audio(url)
  audio.onended = () => { if (currentKey === key) stopPreview() }
  audio.onerror = () => { if (currentKey === key) stopPreview() }
  current = audio
  currentKey = key
  announce()
  void audio.play().catch(() => stopPreview())
}

export function isPlaying(key: string) {
  return currentKey === key
}
