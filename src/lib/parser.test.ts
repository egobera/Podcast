import { describe, it, expect } from 'vitest'
import {
  parseScript, parseCast, estimateSpeechMs, layout, runtime, hash, formatMs,
} from './parser'
import { NO_PACING, DEFAULT_PACING, gapAfter } from './pacing'

describe('parseScript', () => {
  it('separates dialogue from sound cues', () => {
    const { elements } = parseScript(`
**NILO:** Mi mamá está en la cocina.

*(Balón rebotando en el piso.)*

**SIRA:** Eso no es un no.
`)
    expect(elements.map(e => e.kind)).toEqual(['dialogue', 'sfx', 'dialogue'])
    expect(elements[0].characterName).toBe('NILO')
    expect(elements[1].characterName).toBeNull()
  })

  it('keeps the stage direction instead of throwing it away', () => {
    const { elements } = parseScript('**NILO:** *(la voz quebrándose)* Y traté de pegarlo.')
    expect(elements[0].direction).toBe('la voz quebrándose')
    expect(elements[0].text).toBe('Y traté de pegarlo.')
  })

  it('strips markdown and stage directions from spoken text', () => {
    // This one has bitten us twice. If it regresses, ElevenLabs reads the direction aloud.
    const { elements } = parseScript('**NILO:** *(en off, tranquilo)* Diez. Nueve. Ocho.')
    expect(elements[0].text).toBe('Diez. Nueve. Ocho.')
    expect(elements[0].text).not.toContain('*')
    expect(elements[0].text).not.toContain('en off')
  })

  it('ignores separators and keeps scene headings', () => {
    const { elements } = parseScript(`
## Cocina

---

**MAMÁ:** Nilo, la abuela llega a las dos.
`)
    expect(elements).toHaveLength(1)
    expect(elements[0].scene).toBe('Cocina')
  })

  it('uses a timecode as the scene when there is no heading', () => {
    const { elements } = parseScript('**[2:00]**\n\n**SIRA:** Hola.')
    expect(elements[0].scene).toBe('2:00')
  })

  it('classifies music, ambience and impacts by their wording', () => {
    const { elements } = parseScript(`
*(SINTONÍA. 15 segundos.)*

*(Ambiente: cocina de domingo.)*

*(Vidrio rompiéndose, seco y corto.)*
`)
    expect(elements[0].kind).toBe('music')
    expect(elements[1].kind).toBe('ambience')
    expect(elements[1].anchor).toBe('scene')
    expect(elements[2].gainRole).toBe('impact')
  })

  it('turns a timing direction into silence, not a sound to generate', () => {
    // These used to become sound effects, and the generator dutifully made a file of
    // somebody's idea of silence.
    const { elements } = parseScript('*(Silencio. 3 segundos.)*\n\n**SIRA:** Hola.')
    expect(elements[0].kind).toBe('pause')
    expect(elements[0].duration_ms ?? elements[0].estimatedMs).toBe(3000)
  })

  it('reads how long a pause should be from the way it is written', () => {
    const read = (cue: string) => parseScript(`*(${cue})*`).elements[0].estimatedMs
    expect(read('Silencio. 2 segundos.')).toBe(2000)
    expect(read('Silencio largo.')).toBe(3000)
    expect(read('Pausa.')).toBe(1200)
  })

  it('keeps a cue that only mentions a character as a sound, not a pause', () => {
    const { elements } = parseScript('*(Silencio de Nilo.)*')
    expect(elements[0].kind).not.toBe('pause')
  })

  it('trusts an explicit label over the words inside the cue', () => {
    // This one read as music because it mentions a music bed in passing.
    const { elements } = parseScript(
      '*(AMBIENTE · Sala. Entra a 7:00. La cama de tensión sigue sonando desde 5:35.)*',
    )
    expect(elements[0].kind).toBe('ambience')
    expect(elements[0].gainRole).toBe('ambience')
  })

  it('skips a cue that says there is no sound', () => {
    const { elements } = parseScript(
      '*(AMBIENTE · Ninguno. Esta escena va seca a propósito.)*\n\n**SIRA:** Hola.',
    )
    expect(elements).toHaveLength(1)
    expect(elements[0].kind).toBe('dialogue')
  })

  it('keeps music beds out of the timeline push', () => {
    const { elements } = parseScript('*(MÚSICA · Cama de tensión. Entra a 5:35 en bucle.)*')
    expect(elements[0].kind).toBe('music')
    expect(elements[0].anchor).toBe('scene')
  })

  it('counts break tags towards the estimated duration', () => {
    const plain = estimateSpeechMs('Hola qué tal')
    const withBreak = estimateSpeechMs('Hola <break time="2.0s" /> qué tal')
    expect(withBreak - plain).toBe(2000)
  })
})

describe('block markers', () => {
  it('wraps the next line when there is no closing marker', () => {
    const { marks } = parseScript(`
**SIRA:** Aviéntala fuerte.

[[Freeze]]

**NILO:** Diez. Nueve. Ocho.

**MAMÁ:** Los pedazos.
`)
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({ name: 'Freeze', fromIdx: 1, toIdx: 1 })
  })

  it('wraps everything between an opening and a closing marker', () => {
    const { marks } = parseScript(`
[[Freeze]]
**NILO:** Diez.
**NILO:** Nueve.
**NILO:** Ocho.
[[/Freeze]]
**SIRA:** ¿Qué haces?
`)
    expect(marks[0]).toMatchObject({ fromIdx: 0, toIdx: 2 })
  })

  it('does not turn markers into spoken elements', () => {
    const { elements } = parseScript('[[Freeze]]\n**NILO:** Diez.\n[[/Freeze]]')
    expect(elements).toHaveLength(1)
    expect(elements[0].text).toBe('Diez.')
  })

  it('handles two separate blocks in one script', () => {
    const { marks } = parseScript(`
[[Freeze]]
**NILO:** Uno.
**SIRA:** Dos.
[[Freeze]]
**NILO:** Tres.
`)
    expect(marks).toHaveLength(2)
    expect(marks[1].fromIdx).toBe(2)
  })
})

describe('parseCast', () => {
  it('reads a markdown table and skips its header', () => {
    const cast = parseCast(`
| Personaje | Descripción de voz |
|---|---|
| NILO | 8 años. Rápido, impulsivo. |
| ABUELA | Voz mayor, pausada. |
`)
    expect(cast).toHaveLength(2)
    expect(cast[0]).toEqual({ name: 'NILO', description: '8 años. Rápido, impulsivo.' })
  })

  it('reads a dash list', () => {
    const cast = parseCast('- SIRA — 8 años, serena y directa\n- MAMÁ — cansada pero afectuosa')
    expect(cast.map(c => c.name)).toEqual(['SIRA', 'MAMÁ'])
    expect(cast[1].description).toBe('cansada pero afectuosa')
  })

  it('ignores lowercase names and rows without a description', () => {
    const cast = parseCast('| nilo | algo |\n| VOZ | |')
    expect(cast).toHaveLength(0)
  })
})

describe('layout', () => {
  const line = (id: string, idx: number, duration: number) =>
    ({ id, idx, anchor: 'line' as const, duration_ms: duration })

  it('places line anchored elements end to end', () => {
    const els = [line('a', 0, 1000), line('b', 100, 2000), line('c', 200, 500)]
    const starts = layout(els, NO_PACING)
    expect(starts.get('a')).toBe(0)
    expect(starts.get('b')).toBe(1000)
    expect(starts.get('c')).toBe(3000)
    expect(runtime(els, starts)).toBe(3500)
  })

  it('ripples: one longer take moves everything after it', () => {
    const before = layout([line('a', 0, 1000), line('b', 100, 2000), line('c', 200, 500)], NO_PACING)
    const after = layout([line('a', 0, 1000), line('b', 100, 5000), line('c', 200, 500)], NO_PACING)
    expect(after.get('c')! - before.get('c')!).toBe(3000)
  })

  it('scene anchored elements take no time', () => {
    const els = [
      line('a', 0, 1000),
      { id: 'amb', idx: 50, anchor: 'scene' as const, duration_ms: 60000 },
      line('b', 100, 1000),
    ]
    const starts = layout(els, NO_PACING)
    expect(starts.get('b')).toBe(1000)
    expect(runtime(els, starts)).toBe(2000)
  })

  it('spreads block repeats across what they cover, ending before the return', () => {
    const els = [
      { id: 'in', idx: 90, anchor: 'line' as const, duration_ms: 4000,
        block_id: 'b', block_role: 'entry' as const, block_seq: 0 },
      line('mono', 100, 30000),
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`, idx: 101 + i, anchor: 'scene' as const, duration_ms: 600,
        block_id: 'b', block_role: 'pulse' as const, block_seq: i,
      })),
      { id: 'out', idx: 190, anchor: 'line' as const, duration_ms: 1000,
        block_id: 'b', block_role: 'return' as const, block_seq: 10 },
    ]
    const starts = layout(els, NO_PACING)
    const first = starts.get('p0')!
    const last = starts.get('p9')!
    const ret = starts.get('out')!

    expect(first).toBe(4000)          // right after the entry
    expect(last).toBeLessThan(ret)    // the tenth lands before the world comes back
    expect(ret - last).toBeGreaterThanOrEqual(1000)

    // Evenly spread, not clustered
    const gaps = Array.from({ length: 9 }, (_, i) => starts.get(`p${i + 1}`)! - starts.get(`p${i}`)!)
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1)
  })

  it('repositions the repeats when the line inside gets longer', () => {
    const build = (monologue: number) => layout([
      { id: 'in', idx: 90, anchor: 'line' as const, duration_ms: 4000,
        block_id: 'b', block_role: 'entry' as const, block_seq: 0 },
      line('mono', 100, monologue),
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`, idx: 101 + i, anchor: 'scene' as const, duration_ms: 600,
        block_id: 'b', block_role: 'pulse' as const, block_seq: i,
      })),
      { id: 'out', idx: 190, anchor: 'line' as const, duration_ms: 1000,
        block_id: 'b', block_role: 'return' as const, block_seq: 10 },
    ], NO_PACING)
    const short = build(20000)
    const long = build(40000)
    expect(long.get('p9')!).toBeGreaterThan(short.get('p9')!)
    expect(long.get('p0')!).toBe(short.get('p0')!)   // the first one does not move
  })
})

describe('helpers', () => {
  it('hashes the same text to the same key', () => {
    expect(hash('Fui yo.')).toBe(hash('Fui yo.'))
    expect(hash('Fui yo.')).not.toBe(hash('Fui yo!'))
  })

  it('formats milliseconds as minutes and seconds', () => {
    expect(formatMs(0)).toBe('0:00')
    expect(formatMs(65000)).toBe('1:05')
    expect(formatMs(-500)).toBe('0:00')
  })
})

describe('rhythm', () => {
  const say = (id: string, idx: number, who: string, text: string, ms = 1000, scene = 'one') => ({
    id, idx, anchor: 'line' as const, duration_ms: ms,
    kind: 'dialogue', character_id: who, text_content: text, scene,
  })

  it('leaves more air between two speakers than within one', () => {
    const twoPeople = layout([say('a', 0, 'nilo', 'Mi mamá está en la cocina.'),
                              say('b', 100, 'sira', 'Eso no es un no.')])
    const onePerson = layout([say('a', 0, 'nilo', 'Mi mamá está en la cocina.'),
                              say('b', 100, 'nilo', 'Y ya sabes.')])
    expect(twoPeople.get('b')!).toBeGreaterThan(onePerson.get('b')!)
    expect(twoPeople.get('b')! - 1000).toBe(DEFAULT_PACING.turn)
  })

  it('leaves longer after a question than after a statement', () => {
    const asked = layout([say('a', 0, 'sira', '¿Qué haces en el piso?'), say('b', 100, 'nilo', 'Nada.')])
    const said = layout([say('a', 0, 'sira', 'Estás blanco.'), say('b', 100, 'nilo', 'Nada.')])
    expect(asked.get('b')!).toBeGreaterThan(said.get('b')!)
  })

  it('leaves longest when a line trails off', () => {
    const trailing = layout([say('a', 0, 'nilo', 'Espérate, espérate...'), say('b', 100, 'sira', 'Hola.')])
    expect(trailing.get('b')! - 1000).toBe(DEFAULT_PACING.afterEllipsis)
  })

  it('opens a real gap between scenes', () => {
    const across = layout([say('a', 0, 'nilo', 'Vale.', 1000, 'one'),
                           say('b', 100, 'sira', 'Hola.', 1000, 'two')])
    expect(across.get('b')! - 1000).toBe(DEFAULT_PACING.sceneChange)
  })

  it('slides a spot effect under the line before it', () => {
    // A doorbell that waits politely for someone to finish sounds like a different room.
    const withEffect = layout([
      say('a', 0, 'nilo', 'Mi mamá está en la cocina.'),
      { id: 'fx', idx: 100, anchor: 'line' as const, duration_ms: 500,
        kind: 'sfx', character_id: null, text_content: 'Timbre.', scene: 'one' },
    ])
    expect(withEffect.get('fx')!).toBeLessThan(1000)
  })

  it('skips the silence recorded into a take', () => {
    // ElevenLabs leaves a moment of nothing at each end of every file.
    const trimmed = layout([
      { id: 'a', idx: 0, anchor: 'line' as const, duration_ms: 1000,
        lead_silence_ms: 150, tail_silence_ms: 250,
        kind: 'dialogue', character_id: 'nilo', text_content: 'Hola.', scene: 'one' },
      say('b', 100, 'nilo', 'Adiós.'),
    ])
    // 1000 minus 400 of silence, plus the same speaker gap.
    expect(trimmed.get('b')!).toBe(600 + DEFAULT_PACING.sameSpeaker)
  })

  it('brings music in before the line it belongs to', () => {
    // A bed that waits for the previous line to finish announces itself as an edit.
    const withMusic = layout([
      say('a', 0, 'narradora', 'Los domingos por la mañana.', 4000),
      { id: 'bed', idx: 100, anchor: 'scene' as const, duration_ms: 120000,
        kind: 'music', character_id: null, text_content: 'Cama de tensión', scene: 'one' },
    ])
    expect(withMusic.get('bed')!).toBeLessThan(4000)
  })

  it('never puts an element before zero', () => {
    const first = layout([{ id: 'fx', idx: 0, anchor: 'line' as const, duration_ms: 500,
      kind: 'sfx', character_id: null, text_content: 'Timbre.', scene: 'one' }])
    expect(first.get('fx')).toBe(0)
  })
})

describe('gapAfter', () => {
  const shape = (kind: string, text = '', who: string | null = null, scene = 'one') =>
    ({ kind, character_id: who, text_content: text, scene })

  it('gives a pause no gap of its own, because it is already a gap', () => {
    expect(gapAfter(shape('pause'), shape('dialogue'), DEFAULT_PACING)).toBe(0)
    expect(gapAfter(shape('dialogue'), shape('pause'), DEFAULT_PACING)).toBe(0)
  })

  it('gives nothing after the last element', () => {
    expect(gapAfter(shape('dialogue'), undefined, DEFAULT_PACING)).toBe(0)
  })
})
