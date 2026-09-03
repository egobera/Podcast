import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Close } from './icons'

/* ---------- toasts ---------- */

type Toast = { id: number; text: string; tone: 'info' | 'bad' }
const ToastCtx = createContext<(text: string, tone?: 'info' | 'bad') => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: 'info' | 'bad' = 'info') => {
    const id = Date.now() + Math.random()
    setItems(t => [...t, { id, text, tone }])
    setTimeout(() => setItems(t => t.filter(x => x.id !== id)), 5200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(t => (
          <div className="toast" data-tone={t.tone} key={t.id}>
            {t.text}
            <button onClick={() => setItems(x => x.filter(i => i.id !== t.id))} aria-label="Dismiss">
              <Close size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------- modal ---------- */

export function Modal({
  title, children, onClose, footer,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('input, textarea, button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** Replaces window.prompt. Returns the value through onSubmit. */
export function AskText({
  title, label, initial = '', submitLabel = 'Save', onSubmit, onClose,
}: {
  title: string
  label: string
  initial?: string
  submitLabel?: string
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" data-variant="quiet" onClick={onClose}>Cancel</button>
          <button className="btn" data-variant="primary" disabled={!value.trim()}
            onClick={() => { onSubmit(value.trim()); onClose() }}>
            {submitLabel}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{label}</label>
        <input value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) { onSubmit(value.trim()); onClose() } }} />
      </div>
    </Modal>
  )
}

/** Replaces window.confirm, with room to explain what is about to happen. */
export function Confirm({
  title, body, confirmLabel, onConfirm, onClose, destructive,
}: {
  title: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
  destructive?: boolean
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" data-variant="quiet" onClick={onClose}>Cancel</button>
          <button className="btn" data-variant={destructive ? undefined : 'primary'}
            onClick={() => { onConfirm(); onClose() }}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {body}
    </Modal>
  )
}

/**
 * Deleting something with a lot inside it should take a moment of deliberate effort.
 * Typing the name is that moment: it is impossible to do by accident.
 */
export function ConfirmTyped({
  title, body, phrase, confirmLabel, onConfirm, onClose,
}: {
  title: string
  body: ReactNode
  phrase: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const ok = typed.trim().toLowerCase() === phrase.trim().toLowerCase()
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" data-variant="quiet" onClick={onClose}>Cancel</button>
          <button className="btn danger" disabled={!ok}
            onClick={() => { onConfirm(); onClose() }}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {body}
      <div className="field">
        <label>Type <strong>{phrase}</strong> to confirm</label>
        <input value={typed} onChange={e => setTyped(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && ok) { onConfirm(); onClose() } }} />
      </div>
    </Modal>
  )
}

/* ---------- keyboard hint ---------- */

export function Keys({ children }: { children: string }) {
  return <kbd className="key">{children}</kbd>
}
