/**
 * Pulls a duration out of the words a script uses.
 *
 * "4 segundos", "15 seg", "1:30", "unos 20 s". Producers write it a dozen ways and every
 * one of them is a promise the audio has to keep, so it is worth reading rather than
 * asking someone to type it twice.
 */
export function expectedMsFrom(text: string): number | null {
  const clean = text.toLowerCase()

  const clock = clean.match(/\b(\d{1,2}):([0-5]\d)\b/)
  if (clock) return (Number(clock[1]) * 60 + Number(clock[2])) * 1000

  const minutes = clean.match(/\b(\d{1,2})(?:[.,](\d))?\s*(?:minutos?|mins?\b|m\b)/)
  if (minutes) {
    const whole = Number(minutes[1])
    const tenths = minutes[2] ? Number(minutes[2]) / 10 : 0
    return Math.round((whole + tenths) * 60000)
  }

  const seconds = clean.match(/\b(\d{1,3})\s*(?:segundos?|segs?\b|s\b)/)
  if (seconds) return Number(seconds[1]) * 1000

  return null
}

/** How far off an upload is, and whether that is worth saying out loud. */
export function lengthMismatch(actualMs: number, expectedMs: number) {
  const diff = actualMs - expectedMs
  const ratio = Math.abs(diff) / expectedMs
  // Under a fifth off, or under a second, is close enough for a bed or an effect.
  if (ratio < 0.2 || Math.abs(diff) < 1000) return null
  return { diff, longer: diff > 0 }
}
