/**
 * The lock screen.
 *
 * An episode is seven minutes and people listen to it while doing something else, so the
 * phone screen goes off. Without this, the audio stops being reachable: no title, no
 * artwork, no pause from headphones. With it, the thing behaves like every other audio app
 * on the device, which is most of what "feels native" actually means.
 */
export function announce(opts: {
  title: string
  series: string
  onPlay: () => void
  onPause: () => void
  onSeek?: (toMs: number) => void
}) {
  if (!('mediaSession' in navigator)) return

  navigator.mediaSession.metadata = new MediaMetadata({
    title: opts.title,
    artist: opts.series,
    album: 'Canon',
    artwork: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  })

  navigator.mediaSession.setActionHandler('play', opts.onPlay)
  navigator.mediaSession.setActionHandler('pause', opts.onPause)
  navigator.mediaSession.setActionHandler('seekbackward', () =>
    opts.onSeek?.(Math.max(position - 10000, 0)))
  navigator.mediaSession.setActionHandler('seekforward', () =>
    opts.onSeek?.(position + 10000))
}

let position = 0

/** Keeps the scrubber on the lock screen honest. */
export function reportPosition(ms: number, totalMs: number, playing: boolean) {
  position = ms
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  try {
    navigator.mediaSession.setPositionState({
      duration: Math.max(totalMs / 1000, 0.1),
      position: Math.min(Math.max(ms / 1000, 0), Math.max(totalMs / 1000, 0.1)),
      playbackRate: 1,
    })
  } catch { /* some browsers refuse odd values; the title still works */ }
}

export function clearSession() {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.playbackState = 'none'
  navigator.mediaSession.metadata = null
}
