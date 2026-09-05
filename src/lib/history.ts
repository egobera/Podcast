import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Undo, as pairs of functions.
 *
 * Nothing here knows what an element is. An action registers how to put things back and
 * how to do it again, and the stack just holds them. That keeps every new editing action
 * one line of work instead of a new case in a reducer.
 *
 * Redo is dropped the moment you do something new, which is what every editor does and
 * what everyone expects without being able to say so.
 */

export interface Step {
  label: string
  undo: () => Promise<void> | void
  redo: () => Promise<void> | void
}

export const LIMIT = 60

/**
 * The stack itself, apart from React, so its rules can be tested directly.
 * Redo is dropped on any new action, which is what every editor does and what everyone
 * expects without being able to say so.
 */
export function makeStack(limit = LIMIT) {
  const past: Step[] = []
  let future: Step[] = []

  return {
    record(step: Step) {
      past.push(step)
      if (past.length > limit) past.shift()
      future = []
    },
    async undo() {
      const step = past.pop()
      if (!step) return null
      await step.undo()
      future.push(step)
      return step.label
    },
    async redo() {
      const step = future.pop()
      if (!step) return null
      await step.redo()
      past.push(step)
      return step.label
    },
    get depth() { return past.length },
    get redoDepth() { return future.length },
    get lastLabel() { return past[past.length - 1]?.label ?? '' },
    get nextLabel() { return future[future.length - 1]?.label ?? '' },
  }
}

export function useHistory(onAfter?: () => void) {
  const stack = useRef(makeStack())
  const [, bump] = useState(0)
  const busy = useRef(false)

  const refresh = useCallback(() => bump(n => n + 1), [])

  /** Call after doing something, with how to take it back. */
  const record = useCallback((step: Step) => {
    stack.current.record(step)
    refresh()
  }, [refresh])

  const undo = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      if (await stack.current.undo()) onAfter?.()
    } finally {
      busy.current = false
      refresh()
    }
  }, [onAfter, refresh])

  const redo = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      if (await stack.current.redo()) onAfter?.()
    } finally {
      busy.current = false
      refresh()
    }
  }, [onAfter, refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return {
    record,
    undo,
    redo,
    canUndo: stack.current.depth > 0,
    canRedo: stack.current.redoDepth > 0,
    lastLabel: stack.current.lastLabel,
    nextLabel: stack.current.nextLabel,
  }
}
