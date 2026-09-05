import { useEffect, useState } from 'react'

/** True while the viewport matches. Kept in sync so rotating a phone is handled. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    setMatches(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/**
 * A phone is not a small desktop.
 *
 * Nothing on a timeline can be dragged accurately with a thumb, so the editing surface
 * stays on the machine that has a pointer. What a phone is good at is the part that
 * happens on a sofa: listening to what came back and saying yes or no to it.
 */
export const usePhone = () => useMedia('(max-width: 760px)')
