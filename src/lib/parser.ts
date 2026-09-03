import type { ElementKind, Anchor, GainRole } from './types'

/** A block marker found in the script, and the range of elements it wraps. */
export interface BlockMark {
  name: string
  fromIdx: number
  toIdx: number
}

export interface CastEntry {
  name: string
  description: string
}

export interface ParsedScript {
  elements: ParsedElement[]
  marks: BlockMark[]
  cast: CastEntry[]
}

export interface ParsedElement {
  idx: number
  scene: string
  kind: ElementKind
  characterName: string | null
  text: string
  anchor: Anchor
  gainRole: GainRole
  estimatedMs: number
}

/** Words per minute for children's audio drama narration. Used only for first estimates. */
const WPM = 135

export function estimateSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const breaks = [...text.matchAll(/<break\s+time="([\d.]+)s"/g)]
    .reduce((sum, m) => sum + parseFloat(m[1]) * 1000, 0)
  return Math.round((words / WPM) * 60000 + breaks)
}

function stripTags(text: string): string {
  return text
    .replace(/<break\s+time="[\d.]+s"\s*\/>/g, ' ')
    .replace(/\[[a-z ]+\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Sounds that recur across a series and should come from the Vault, not a new generation. */
const RECURRING = /timbre|doorbell|sinton|theme|congelamiento|freeze/i

/**
 * Turns a script into a manifest.
 *
 * Recognised shapes, in order of precedence:
 *   ## Scene heading        -> sets the current scene name
 *   **[12:30]** or [12:30]  -> sets the current scene name if no heading is present
 *   NAME: line of dialogue  -> a dialogue element for that character
 *   (something happens)     -> a candidate sound element
 *   *(something happens)*   -> same, markdown emphasis tolerated
 */
/**
 * Reads the cast list a script already carries.
 *
 * Two shapes are understood, because both are how people actually write them:
 *
 *   | NARRADORA | Cálida, cercana, ritmo tranquilo |      a markdown table
 *   - NILO — 8 años, impulsivo, voz clara y rápida       a dash list
 *
 * The first column is the name, everything after it is the description. Header rows and
 * separator rows are skipped.
 */
export function parseCast(script: string): CastEntry[] {
  const out = new Map<string, string>()
  const NAME = /^[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s.]{1,30}$/

  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim()

    const row = line.match(/^\|(.+)\|$/)
    if (row) {
      const cells = row[1].split('|').map(c => c.replace(/[*`]/g, '').trim())
      if (cells.length < 2) continue
      if (/^:?-{2,}/.test(cells[0])) continue
      const name = cells[0]
      const desc = cells.slice(1).filter(Boolean).join('. ')
      if (NAME.test(name) && desc && !/personaje|character/i.test(name)) {
        out.set(name, desc)
      }
      continue
    }

    const item = line.match(/^[-*]\s+\*{0,2}([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s.]{1,30}?)\*{0,2}\s*[—–:-]\s*(.+)$/)
    if (item) {
      const name = item[1].trim()
      if (NAME.test(name)) out.set(name, item[2].replace(/[*`]/g, '').trim())
    }
  }

  return [...out.entries()].map(([name, description]) => ({ name, description }))
}

export function parseScript(script: string): ParsedScript {
  const out: ParsedElement[] = []
  const openMarks: (BlockMark & { closed: boolean })[] = []
  const lines = script.split(/\r?\n/)
  let scene = 'Opening'
  let idx = 0

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const heading = line.match(/^#{1,4}\s+(.*)$/)
    if (heading) {
      scene = heading[1].replace(/[*_`]/g, '').trim()
      continue
    }

    const timecode = line.match(/^\*{0,2}\[(\d{1,2}:\d{2})\]\*{0,2}$/)
    if (timecode) {
      scene = timecode[1]
      continue
    }

    if (/^[-*_]{3,}$/.test(line)) continue

    // [[Freeze]] wraps the next line. [[Freeze]] … [[/Freeze]] wraps everything between.
    const marker = line.match(/^\*{0,2}\[\[\s*(\/?)\s*([^\]]+?)\s*\]\]\*{0,2}$/)
    if (marker) {
      const closing = marker[1] === '/'
      const name = marker[2].trim()
      if (closing) {
        for (let i = openMarks.length - 1; i >= 0; i--) {
          if (openMarks[i].name.toLowerCase() === name.toLowerCase() && !openMarks[i].closed) {
            openMarks[i].toIdx = idx - 1
            openMarks[i].closed = true
            break
          }
        }
      } else {
        openMarks.push({ name, fromIdx: idx, toIdx: -1, closed: false })
      }
      continue
    }

    const cue = line.match(/^\*?\(([^)]+)\)\*?$/)
    if (cue) {
      const desc = cue[1].trim()
      const isMusic = /sinton|m[uú]sica|theme|cama|music/i.test(desc)
      out.push({
        idx: idx++,
        scene,
        kind: isMusic ? 'music' : /ambiente|ambience/i.test(desc) ? 'ambience' : 'sfx',
        characterName: null,
        text: desc,
        anchor: /ambiente|ambience/i.test(desc) ? 'scene' : 'line',
        gainRole: isMusic
          ? 'bed'
          : /ambiente|ambience/i.test(desc)
            ? 'ambience'
            : /crac|romp|break|golpe de aire|glass/i.test(desc)
              ? 'impact'
              : 'spot',
        estimatedMs: RECURRING.test(desc) ? 2000 : 3000,
      })
      continue
    }

    const speech = line.match(/^\*{0,2}([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s.]{1,30}?)\*{0,2}\s*:\s*(.+)$/)
    if (speech) {
      const name = speech[1].replace(/[*_]/g, '').trim()
      // "**NILO:** *(en off, tranquilo)* Diez..." leaves markdown and a stage direction
      // in front of the words. Both have to go, or they get spoken out loud.
      const body = speech[2]
        .replace(/^\*+/, '')
        .replace(/\*+$/, '')
        .trim()
        .replace(/^\*{0,2}\([^)]*\)\*{0,2}\s*/, '')
        .trim()
      const clean = stripTags(body)
      if (!clean) continue
      out.push({
        idx: idx++,
        scene,
        kind: 'dialogue',
        characterName: name,
        text: body,
        anchor: 'line',
        gainRole: 'voice',
        estimatedMs: estimateSpeechMs(body),
      })
    }
  }

  // A marker with no closing tag wraps the single element that followed it.
  const marks: BlockMark[] = openMarks.map(m => ({
    name: m.name,
    fromIdx: m.fromIdx,
    toIdx: m.closed ? m.toIdx : m.fromIdx,
  })).filter(m => m.toIdx >= m.fromIdx)

  return { elements: out, marks, cast: parseCast(script) }
}

export function uniqueCharacters(elements: ParsedElement[]): string[] {
  return [...new Set(elements.filter(e => e.characterName).map(e => e.characterName!))]
}

/** Spacing between script elements, so blocks can be inserted in the gaps. */
export const IDX_STEP = 100
export const IDX_SCRIPT_START = 1000
export const IDX_TEMPLATE_OPEN = 0
export const IDX_TEMPLATE_CLOSE = 9_000_000

export interface Placeable {
  id: string
  idx: number
  anchor: Anchor
  duration_ms: number
  block_id?: string | null
  block_role?: 'entry' | 'pulse' | 'return' | null
  block_seq?: number
}

/**
 * Lays everything out on one timeline.
 *
 * Line anchored elements sit end to end and push whatever follows. That is the ripple:
 * regenerate one line a second longer and the rest of the episode moves by itself.
 *
 * Scene anchored elements are placed but take no time, so ambiences and beds can sit
 * under a scene without shifting anything.
 *
 * Freeze pulses are a special case. They are spread across the speech that happens inside
 * frozen time, so their spacing follows the rhythm of the monologue rather than the clock.
 * The last pulse lands just before the return.
 */
export function layout<T extends Placeable>(elements: T[]): Map<string, number> {
  const starts = new Map<string, number>()
  const ordered = [...elements].sort((a, b) => a.idx - b.idx)

  let cursor = 0
  for (const el of ordered) {
    if (el.block_role === 'pulse') continue // placed in the second pass
    starts.set(el.id, cursor)
    if (el.anchor === 'line') cursor += el.duration_ms
  }

  // Second pass: distribute the pulses of each block across the gap it wraps.
  const blocks = new Map<string, T[]>()
  for (const el of ordered) {
    if (!el.block_id) continue
    if (!blocks.has(el.block_id)) blocks.set(el.block_id, [])
    blocks.get(el.block_id)!.push(el)
  }

  for (const members of blocks.values()) {
    const entry = members.find(m => m.block_role === 'entry')
    const ret = members.find(m => m.block_role === 'return')
    const pulses = members.filter(m => m.block_role === 'pulse').sort((a, b) => (a.block_seq ?? 0) - (b.block_seq ?? 0))
    if (!entry || !ret || pulses.length === 0) continue

    const from = (starts.get(entry.id) ?? 0) + entry.duration_ms
    const to = starts.get(ret.id) ?? from
    const span = Math.max(to - from, 0)
    // Leave the last pulse a beat of room before the world comes back.
    const usable = Math.max(span - ret.duration_ms, 0)
    const gap = pulses.length > 1 ? usable / (pulses.length - 1) : 0
    pulses.forEach((p, i) => starts.set(p.id, Math.round(from + gap * i)))
  }

  return starts
}

/** Total running time. Only line anchored elements advance the clock. */
export function runtime<T extends Placeable>(elements: T[], starts: Map<string, number>): number {
  let max = 0
  for (const el of elements) {
    const start = starts.get(el.id) ?? 0
    const end = el.anchor === 'line' ? start + el.duration_ms : start
    if (end > max) max = end
  }
  return max
}

export function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
