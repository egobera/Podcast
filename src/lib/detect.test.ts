import { describe, it, expect } from 'vitest'
import { normalize, isTimingOnly, detectRepeats, detectPairs, cueKeyword } from './detect'
import { safeName } from './files'

const cue = (id: string, idx: number, text: string, episode_id = 'ep1') =>
  ({ id, idx, kind: 'sfx', text_content: text, episode_id })

const dialogue = (id: string, idx: number) =>
  ({ id, idx, kind: 'dialogue', text_content: 'Una línea de diálogo', episode_id: 'ep1' })

describe('normalize', () => {
  it('collapses wording differences', () => {
    expect(normalize('Timbre.')).toBe(normalize('  timbre  '))
    expect(normalize('Sintonía apertura')).toBe('sintonia apertura')
  })

  it('keeps only the first few words, so a long cue still matches', () => {
    expect(normalize('Puerta abriéndose y cerrándose despacio en el pasillo de arriba'))
      .toBe('puerta abriendose y cerrandose despacio')
  })
})

describe('isTimingOnly', () => {
  it('recognises pure timing directions', () => {
    expect(isTimingOnly('Pausa.')).toBe(true)
    expect(isTimingOnly('Silencio largo.')).toBe(true)
    expect(isTimingOnly('Pausa de dos segundos')).toBe(true)
  })

  it('keeps cues that only contain a timing word in passing', () => {
    // The freeze opens with this. Filtering it would break block detection.
    expect(isTimingOnly('CHASQUIDO. SILENCIO TOTAL.')).toBe(false)
    expect(isTimingOnly('Timbre.')).toBe(false)
  })
})

describe('detectRepeats', () => {
  it('proposes a sound that repeats enough times', () => {
    const found = detectRepeats([
      cue('1', 0, 'Timbre.'), cue('2', 10, 'timbre'), cue('3', 20, 'Timbre'),
      cue('4', 30, 'Un vaso que se cae'),
    ], { minCount: 3 })
    expect(found).toHaveLength(1)
    expect(found[0].count).toBe(3)
  })

  it('never proposes timing directions', () => {
    const found = detectRepeats([
      cue('1', 0, 'Pausa.'), cue('2', 1, 'Pausa.'), cue('3', 2, 'Pausa.'),
      cue('4', 3, 'Silencio.'), cue('5', 4, 'Silencio.'), cue('6', 5, 'Silencio.'),
    ], { minCount: 2 })
    expect(found).toHaveLength(0)
  })

  it('ignores dialogue', () => {
    const found = detectRepeats([dialogue('a', 0), dialogue('b', 1), dialogue('c', 2)], { minCount: 2 })
    expect(found).toHaveLength(0)
  })

  it('across the series, appearing in two episodes is enough', () => {
    const found = detectRepeats([
      cue('1', 0, 'Timbre.', 'ep1'),
      cue('2', 0, 'Timbre.', 'ep2'),
    ], { minCount: 9, minEpisodes: 2 })
    expect(found).toHaveLength(1)
    expect(found[0].episodes).toBe(2)
  })
})

describe('detectPairs', () => {
  const freeze = (base: number, ep = 'ep1') => [
    cue(`${base}a`, base, 'CHASQUIDO. SILENCIO TOTAL.', ep),
    dialogue(`${base}b`, base + 1),
    dialogue(`${base}c`, base + 2),
    cue(`${base}d`, base + 3, 'GOLPE DE AIRE. Regresa el mundo.', ep),
  ]

  it('finds an opening and closing cue that repeat together', () => {
    const found = detectPairs([...freeze(0), ...freeze(100), ...freeze(200)])
    expect(found).toHaveLength(1)
    expect(found[0].occurrences).toBe(3)
    expect(found[0].openLabel).toContain('CHASQUIDO')
    expect(found[0].closeLabel).toContain('GOLPE DE AIRE')
  })

  it('needs something between the two cues', () => {
    const found = detectPairs([
      cue('1', 0, 'CHASQUIDO'), cue('2', 1, 'GOLPE DE AIRE'),
      cue('3', 10, 'CHASQUIDO'), cue('4', 11, 'GOLPE DE AIRE'),
    ])
    expect(found).toHaveLength(0)
  })

  it('collapses two openings that share one closing cue', () => {
    // CHASQUIDO then TIC then GOLPE describes one block, not two.
    const run = (base: number) => [
      cue(`${base}a`, base, 'CHASQUIDO. SILENCIO TOTAL.'),
      cue(`${base}b`, base + 1, 'TIC. TIC. TIC.'),
      dialogue(`${base}c`, base + 2),
      dialogue(`${base}d`, base + 3),
      cue(`${base}e`, base + 4, 'GOLPE DE AIRE.'),
    ]
    const found = detectPairs([...run(0), ...run(100), ...run(200)])
    expect(found).toHaveLength(1)
    expect(found[0].openLabel).toContain('CHASQUIDO')
  })

  it('says nothing when a script has no repeated structure', () => {
    expect(detectPairs([cue('1', 0, 'Timbre'), dialogue('2', 1), cue('3', 2, 'Puerta')])).toHaveLength(0)
  })
})

describe('cueKeyword', () => {
  it('takes the distinctive words a block can search for', () => {
    expect(cueKeyword('CHASQUIDO. SILENCIO TOTAL.')).toBe('chasquido silencio')
    expect(cueKeyword('GOLPE DE AIRE. Regresa el mundo.')).toBe('golpe aire')
  })
})

describe('safeName', () => {
  it('makes a storage key out of a real filename', () => {
    // This exact name was rejected by Supabase for its spaces.
    expect(safeName('Cama emocional  - Casi Superpoderes.mp3'))
      .toBe('cama-emocional-casi-superpoderes.mp3')
  })

  it('strips accents and punctuation', () => {
    expect(safeName('Sintonía apertura (final).wav')).toBe('sintonia-apertura-final.wav')
    expect(safeName('año nuevo ñandú.m4a')).toBe('ano-nuevo-nandu.m4a')
  })

  it('lowercases the extension and survives an empty name', () => {
    expect(safeName('freeze_in — versión 3.MP3')).toBe('freeze-in-version-3.mp3')
    expect(safeName('   .mp3')).toBe('audio.mp3')
  })

  it('never returns a key with a space, slash or quote', () => {
    for (const name of ['a b/c".mp3', 'Ω Ω.wav', '../../etc/passwd.mp3']) {
      expect(safeName(name)).not.toMatch(/[\s/\\'"]/)
    }
  })
})
