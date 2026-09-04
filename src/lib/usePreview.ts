import { useEffect, useState } from 'react'
import { onPlaybackChange, togglePreview, stopPreview } from './audio'

/** Returns which clip is playing and a way to start or stop one. */
export function usePreview() {
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => onPlaybackChange(setPlaying), [])
  return { playing, toggle: togglePreview, stop: stopPreview }
}
