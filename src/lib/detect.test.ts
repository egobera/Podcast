import { describe, it, expect } from 'vitest'
import { normalize, isTimingOnly, detectRepeats, detectPairs, cueKeyword, countUnlinked } from './detect'

import { safeName } from './files'
import { expectedMsFrom, lengthMismatch } from './duration'
import { applyDirection, effectiveDirection, supportsTags } from './direction'
import { buildSoundPrompt, defaultLengthMs, looksLikeRawCue } from './soundprompt'

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

  it('reads a stated length as timing, not as a sound', () => {
    // The digit used to break the check, so these were proposed as vault sounds.
    expect(isTimingOnly('Silencio. 1 segundo.')).toBe(true)
    expect(isTimingOnly('Silencio. 2 segundos.')).toBe(true)
    expect(isTimingOnly('Pausa. 3 segundos.')).toBe(true)
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

  it('never proposes something already classified as a pause', () => {
    const pause = (id: string, idx: number, text: string) =>
      ({ id, idx, kind: 'pause', text_content: text, episode_id: 'ep1' })
    const found = detectRepeats([
      pause('1', 0, 'Silencio. 1 segundo.'),
      pause('2', 10, 'Silencio. 1 segundo.'),
      pause('3', 20, 'Silencio. 1 segundo.'),
    ], { minCount: 2 })
    expect(found).toHaveLength(0)
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

describe('expectedMsFrom', () => {
  it('reads the ways a script states a length', () => {
    expect(expectedMsFrom('MÚSICA · Motivo del Coleccionista. 4 segundos.')).toBe(4000)
    expect(expectedMsFrom('Sintonía de apertura, 15 seg')).toBe(15000)
    expect(expectedMsFrom('Cama emocional, 2 minutos en bucle')).toBe(120000)
    expect(expectedMsFrom('Corte de 1:30')).toBe(90000)
  })

  it('says nothing when the script does not state one', () => {
    expect(expectedMsFrom('Timbre.')).toBeNull()
    expect(expectedMsFrom('AMBIENTE · Cocina de domingo, en bucle')).toBeNull()
  })
})

describe('lengthMismatch', () => {
  it('stays quiet when the audio is close enough', () => {
    expect(lengthMismatch(15400, 15000)).toBeNull()
    expect(lengthMismatch(4300, 4000)).toBeNull()
  })

  it('speaks up when a generated track runs long', () => {
    // Suno hands back a minute when the theme needs fifteen seconds.
    const off = lengthMismatch(62000, 15000)
    expect(off?.longer).toBe(true)
    expect(off?.diff).toBe(47000)
  })

  it('speaks up when it runs short too', () => {
    expect(lengthMismatch(8000, 15000)?.longer).toBe(false)
  })
})

describe('applyDirection', () => {
  it('leaves a line alone when there is no direction', () => {
    const out = applyDirection('Fui yo.', '')
    expect(out.text).toBe('Fui yo.')
    expect(out.tags).toEqual([])
  })

  it('turns a feeling into an audio tag', () => {
    expect(applyDirection('Y traté de pegarlo.', 'la voz quebrándose').tags).toEqual(['[crying]'])
    expect(applyDirection('Otra vez no.', 'suspirando').tags).toEqual(['[sighs]'])
    expect(applyDirection('Bueno. No.', 'muy bajito').tags).toEqual(['[whispers]'])
  })

  it('ignores a direction that only says where the actor is', () => {
    // "desde la cocina" is blocking, not performance. Tagging it would be inventing.
    expect(applyDirection('Nilo, la abuela llega a las dos.', 'desde la cocina').tags).toEqual([])
  })

  it('caps the tags so a line does not become an impression', () => {
    const out = applyDirection('Hola.', 'nervioso, asustado, llorando, gritando, enfadado')
    expect(out.tags.length).toBeLessThanOrEqual(3)
  })

  it('turns a slow direction into pauses rather than a tag', () => {
    const out = applyDirection('Diez. Nueve. Ocho.', 'muy despacio, sin prisa')
    expect(out.text).toContain('<break time="0.7s" />')
    expect(out.text.match(/<break/g)?.length).toBe(2)
  })

  it('puts the tags in front of the words, where the model reads them', () => {
    expect(applyDirection('Sí.', 'aliviado').text).toBe('[relieved] Sí.')
  })
})

describe('buildSoundPrompt', () => {
  it('drops the label and the instructions to the editor', () => {
    const out = buildSoundPrompt(
      'AMBIENTE · Cocina de domingo. Radio muy bajita. En bucle hasta que salen al balón.',
    )
    expect(out.prompt).not.toContain('AMBIENTE')
    expect(out.prompt).not.toContain('bucle')
    expect(out.prompt).toContain('kitchen')
    expect(out.prompt).toContain('distant muffled radio')
  })

  it('never sends half translated Spanish', () => {
    // Substituting word by word produced Spanglish, which reads worse than either language.
    const out = buildSoundPrompt('Timbre.')
    expect(out.described).toBe(true)
    expect(out.prompt).toBe(
      'doorbell ringing. single isolated sound, dry, close microphone, no reverb tail. ' +
      'sound effect only, no voice, no narration, no words, no music.',
    )
  })

  it('asks an ambience for room and a spot effect for none', () => {
    expect(buildSoundPrompt('AMBIENTE · Cocina.').prompt).toContain('continuous background room tone')
    expect(buildSoundPrompt('Timbre.').prompt).toContain('no reverb tail')
  })

  it('gives an ambience longer than a single hit by default', () => {
    expect(buildSoundPrompt('AMBIENTE · Cocina.').seconds).toBe(12)
    expect(buildSoundPrompt('Timbre.').seconds).toBe(3)
  })

  it('honours a length the script stated', () => {
    expect(buildSoundPrompt('Timbre.', 8000).seconds).toBe(8)
  })

  it('flags a cue it did not understand instead of pretending', () => {
    const out = buildSoundPrompt('Un ruido difícil de describir')
    expect(out.described).toBe(false)
  })
})

describe('defaultLengthMs', () => {
  it('starts every kind of vault entry with a sensible length', () => {
    expect(defaultLengthMs('theme_open')).toBe(15000)
    expect(defaultLengthMs('theme_close')).toBe(30000)
    expect(defaultLengthMs('bed')).toBe(120000)
    expect(defaultLengthMs('sfx')).toBe(3000)
  })
})

describe('looksLikeRawCue', () => {
  const cue = 'SONIDO · Silla de madera que se tambalea. 2 seg'

  it('spots the cue itself saved as a prompt', () => {
    expect(looksLikeRawCue(cue, cue)).toBe(true)
  })

  it('spots a Spanish stage direction left over from an old import', () => {
    // Sending this made the generator read the direction aloud.
    expect(looksLikeRawCue('La silla se tambalea. Nilo cae.', cue)).toBe(true)
  })

  it('keeps a prompt that went through the builder', () => {
    expect(looksLikeRawCue(buildSoundPrompt(cue).prompt, cue)).toBe(false)
  })

  it('keeps a prompt written by hand that says no voice', () => {
    expect(looksLikeRawCue('wooden chair wobbling, dry, no voice, no narration', cue)).toBe(false)
  })
})

describe('the built prompt always forbids speech', () => {
  it('says so for a spot effect and for an ambience', () => {
    expect(buildSoundPrompt('Timbre.').prompt).toContain('no voice, no narration')
    expect(buildSoundPrompt('AMBIENTE · Cocina.').prompt).toContain('no voice, no narration')
  })
})

describe('countUnlinked', () => {
  const el = (id: string, kind: string, text: string) => ({
    id, episode_id: 'e', idx: 0, kind, text_content: text,
    series_asset_id: null,
  }) as never

  it('never counts a pause as a sound the vault needs', () => {
    // These became vault entries called "Silencio. 1 segundo" with a Generate button.
    const n = countUnlinked(
      [el('1', 'pause', 'Silencio. 1 segundo.'), el('2', 'pause', 'Silencio. 3 segundos.')],
      [],
    )
    expect(n).toBe(0)
  })

  it('counts a real sound the vault does not have', () => {
    expect(countUnlinked([el('1', 'sfx', 'Timbre de casa.')], [])).toBe(1)
  })
})

describe('effectiveDirection', () => {
  it('uses the line direction when there is one', () => {
    const out = effectiveDirection('gritando', 'cálida, tranquila')
    expect(out.text).toBe('gritando')
    expect(out.fromCharacter).toBe(false)
  })

  it('falls back to the character when the line has none', () => {
    // Most narrator lines carry no direction. Without this they were read flat.
    const out = effectiveDirection('', 'cálida, cercana, ritmo tranquilo')
    expect(out.text).toBe('cálida, cercana, ritmo tranquilo')
    expect(out.fromCharacter).toBe(true)
  })

  it('never stacks the two', () => {
    // "gritando" on top of "tranquila" would be a contradiction, not a nuance.
    expect(effectiveDirection('gritando', 'tranquila').text).toBe('gritando')
  })

  it('uses the cast description when there are no notes', () => {
    expect(effectiveDirection('', '', 'Voz mayor, pausada').text).toBe('Voz mayor, pausada')
  })

  it('reports nothing when neither exists', () => {
    const out = effectiveDirection('', '', '')
    expect(out.text).toBe('')
    expect(out.fromCharacter).toBe(false)
  })
})

describe('audio tags by model', () => {
  it('only v3 gets them', () => {
    expect(supportsTags('eleven_v3')).toBe(true)
    expect(supportsTags('eleven_multilingual_v2')).toBe(false)
    expect(supportsTags('eleven_turbo_v2_5')).toBe(false)
  })

  it('leaves the tag out for a model that would read it aloud', () => {
    // v2 has no idea what [excited] is, so it says it: "excited, cuatro, cinco, seis".
    const out = applyDirection('Cuatro. Cinco. Seis charcos.', 'emocionada', false)
    expect(out.text).toBe('Cuatro. Cinco. Seis charcos.')
    expect(out.tags).toEqual([])
  })

  it('keeps the pauses on every model, because those always work', () => {
    const out = applyDirection('Diez. Nueve. Ocho.', 'muy despacio', false)
    expect(out.text).toContain('<break')
    expect(out.text).not.toContain('[')
  })
})

describe('loudness matching', () => {
  const tone = (amplitude: number, seconds = 1, rate = 8000) => {
    const length = seconds * rate
    const data = new Float32Array(length)
    for (let i = 0; i < length; i++) data[i] = Math.sin((i / rate) * 440 * 2 * Math.PI) * amplitude
    return {
      getChannelData: () => data,
      length,
      sampleRate: rate,
      duration: seconds,
      numberOfChannels: 1,
    } as unknown as AudioBuffer
  }

  it('measures a loud clip as louder than a quiet one', async () => {
    const { loudness } = await import('./player')
    expect(loudness(tone(0.5))).toBeGreaterThan(loudness(tone(0.1)))
  })

  it('ignores the silence at the ends', async () => {
    // Averaging across the whole file would be dragged down by the dead air, which is
    // exactly what makes two takes of the same line measure differently.
    const { loudness } = await import('./player')
    const rate = 8000
    const padded = new Float32Array(rate * 3)
    for (let i = rate; i < rate * 2; i++) padded[i] = Math.sin((i / rate) * 440 * 2 * Math.PI) * 0.3
    const buffer = {
      getChannelData: () => padded, length: padded.length, sampleRate: rate,
      duration: 3, numberOfChannels: 1,
    } as unknown as AudioBuffer

    expect(loudness(buffer)).toBeCloseTo(loudness(tone(0.3)), 1)
  })

  it('reports nothing for silence', async () => {
    const { loudness } = await import('./player')
    expect(loudness(tone(0))).toBe(0)
  })
})
