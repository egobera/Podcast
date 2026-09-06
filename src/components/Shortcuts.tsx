import { useEffect, useState } from 'react'
import { Modal } from './ui'

/**
 * The keys, on demand.
 *
 * Every shortcut in here already worked; none of them were written down anywhere a person
 * would look. A shortcut nobody knows about is not a feature, it is a secret, and the
 * people who most need them are the ones reviewing a hundred lines in one sitting.
 */
const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Going through the script',
    keys: [
      ['↑ ↓', 'Move between lines'],
      ['enter', 'Open the selected line'],
      ['a', 'Approve and move on'],
      ['g', 'Generate a new take'],
      ['n', 'Jump to the next thing without audio'],
    ],
  },
  {
    title: 'The timeline',
    keys: [
      ['space', 'Play or pause'],
      ['+ −', 'Zoom in and out'],
      ['0', 'Show the whole episode'],
      ['shift + drag', 'Move without the magnet'],
      ['shift + scroll', 'Move along the episode'],
      ['shift + click', 'Add a clip to the selection'],
    ],
  },
  {
    title: 'Trimming',
    keys: [
      ['space', 'Play from the playhead'],
      ['i  o', 'Set the start or the end there'],
      ['l', 'Loop the selection'],
      ['← →', 'Move the playhead, hold shift for bigger steps'],
    ],
  },
  {
    title: 'Everywhere',
    keys: [
      ['⌘Z', 'Undo'],
      ['⇧⌘Z', 'Redo'],
      ['⌘↵', 'Save a note or a line while typing'],
      ['?', 'This list'],
      ['esc', 'Close whatever is open'],
    ],
  },
]

export default function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keys" onClose={onClose}
      footer={<button className="btn" data-variant="primary" onClick={onClose}>Got it</button>}>
      <div className="keys-grid">
        {GROUPS.map(group => (
          <section key={group.title}>
            <span className="ip-label">{group.title}</span>
            {group.keys.map(([key, what]) => (
              <div className="key-row" key={key}>
                <kbd className="key">{key}</kbd>
                <span>{what}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  )
}

/** Opens the list on `?`, from anywhere that is not a text field. */
export function useShortcutsOverlay() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.key === '?') { e.preventDefault(); setOpen(true) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return { open, show: () => setOpen(true), hide: () => setOpen(false) }
}
