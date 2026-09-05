import { describe, it, expect } from 'vitest'
import { makeStack } from './history'

const step = (log: string[], label: string) => ({
  label,
  undo: () => { log.push(`undo ${label}`) },
  redo: () => { log.push(`redo ${label}`) },
})

describe('the undo stack', () => {
  it('takes back the most recent thing first', async () => {
    const log: string[] = []
    const s = makeStack()
    s.record(step(log, 'move'))
    s.record(step(log, 'trim'))
    await s.undo()
    await s.undo()
    expect(log).toEqual(['undo trim', 'undo move'])
  })

  it('puts things back in the order they happened', async () => {
    const log: string[] = []
    const s = makeStack()
    s.record(step(log, 'move'))
    s.record(step(log, 'trim'))
    await s.undo()
    await s.undo()
    log.length = 0
    await s.redo()
    await s.redo()
    expect(log).toEqual(['redo move', 'redo trim'])
  })

  it('drops the redo when you do something new', async () => {
    // Undoing then editing means the future no longer exists. Keeping it would let a
    // later redo overwrite work that was done after it.
    const s = makeStack()
    s.record(step([], 'move'))
    await s.undo()
    expect(s.redoDepth).toBe(1)
    s.record(step([], 'trim'))
    expect(s.redoDepth).toBe(0)
  })

  it('does nothing when there is nothing to undo', async () => {
    const s = makeStack()
    expect(await s.undo()).toBeNull()
    expect(await s.redo()).toBeNull()
  })

  it('forgets the oldest steps rather than growing forever', async () => {
    const s = makeStack(3)
    for (const label of ['a', 'b', 'c', 'd']) s.record(step([], label))
    expect(s.depth).toBe(3)
    expect(await s.undo()).toBe('d')
  })
})
