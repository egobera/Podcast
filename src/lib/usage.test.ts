import { describe, it, expect } from 'vitest'
import { orphanAssets, type Usage } from './usage'

const usage = (assetIds: string[], episodes = 3): Usage => ({
  assets: new Map(assetIds.map(id => [id, 1])),
  characters: new Map(),
  episodes,
})

describe('orphanAssets', () => {
  const assets = [
    { id: 'timbre' },
    { id: 'arena' },
    { id: 'theme', auto_place: 'open' },
    { id: 'outro', auto_place: 'close' },
  ]

  it('finds what no episode references any more', () => {
    // The episode that needed the sand was deleted.
    const out = orphanAssets(assets, usage(['timbre']))
    expect(out.map(a => a.id)).toEqual(['arena'])
  })

  it('never proposes deleting a theme', () => {
    // Themes are placed by the template, not asked for by a script, so they look unused
    // by this measure and are not.
    const out = orphanAssets(assets, usage([]))
    expect(out.map(a => a.id)).toEqual(['timbre', 'arena'])
  })

  it('says nothing while a series has no episodes at all', () => {
    // Right after creating a series, everything would look orphaned.
    expect(orphanAssets(assets, usage([], 0))).toEqual([])
  })

  it('counts an asset used twice in one episode as used once', () => {
    const out = orphanAssets([{ id: 'timbre' }], usage(['timbre']))
    expect(out).toEqual([])
  })
})
