/**
 * Storage keys reject spaces and most punctuation, and accented characters travel badly
 * between systems. So a file called "Cama emocional  - Casi Superpoderes.mp3" becomes
 * "cama-emocional-casi-superpoderes.mp3" before it is ever sent.
 */
export function safeName(filename: string): string {
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : 'bin'

  const clean = stem
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/[^a-zA-Z0-9]+/g, '-')     // anything else becomes a single dash
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)

  const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'
  return `${clean || 'audio'}.${safeExt}`
}
