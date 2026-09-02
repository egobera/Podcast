import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Eye, EyeOff } from './icons'

type Mode = 'in' | 'up' | 'forgot'

/** Supabase error strings are for developers. These are for people. */
function friendly(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'That email and password do not match an account.'
  if (m.includes('email not confirmed')) return 'Check your inbox and confirm the address first.'
  if (m.includes('user already registered')) return 'There is already an account with that email. Sign in instead.'
  if (m.includes('password should be at least')) return 'Passwords need at least 8 characters.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again.'
  return message
}

export default function SignIn() {
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const canSubmit = mode === 'forgot'
    ? /.+@.+\..+/.test(email)
    : /.+@.+\..+/.test(email) && password.length >= 8

  async function submit() {
    if (!canSubmit || busy) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'up') {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        // If confirmation is off in Supabase the session starts immediately and this never shows.
        const { data } = await supabase.auth.getSession()
        if (!data.session) setSent(true)
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        })
        if (error) throw error
        setSent(true)
      }
    } catch (e) {
      setError(friendly(e instanceof Error ? e.message : 'Something went wrong'))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="auth-wrap">
        <div className="auth">
          <h1>Check your email</h1>
          <p>
            {mode === 'forgot'
              ? `We sent a reset link to ${email}. Open it and you can set a new password.`
              : `We sent a confirmation link to ${email}. Open it once and you are set.`}
          </p>
          <button className="btn" data-variant="quiet"
            onClick={() => { setSent(false); setMode('in') }}>
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-wrap">
      <div className="auth">
        <h1>Estudio</h1>
        <p>
          {mode === 'in' && 'Production workspace for serialized audio fiction.'}
          {mode === 'up' && 'Create an account. One is enough for every series you make.'}
          {mode === 'forgot' && 'Enter your email and we send a link to set a new password.'}
        </p>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} autoComplete="email"
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }} />
        </div>

        {mode !== 'forgot' && (
          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="input-wrap">
              <input
                id="password"
                type={show ? 'text' : 'password'}
                value={password}
                autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit() }}
              />
              <button type="button" className="reveal" onClick={() => setShow(s => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {mode === 'up' && (
              <span className="hint">At least 8 characters.</span>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <button className="btn" data-variant="primary" disabled={!canSubmit || busy} onClick={submit}>
          {busy ? 'Working' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}
        </button>

        <div className="auth-links">
          {mode === 'in' && (
            <>
              <button onClick={() => { setMode('up'); setError('') }}>Create an account</button>
              <button onClick={() => { setMode('forgot'); setError('') }}>Forgot password</button>
            </>
          )}
          {mode !== 'in' && (
            <button onClick={() => { setMode('in'); setError('') }}>Back to sign in</button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Shown when the user arrives from a reset link. */
export function SetNewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (password.length < 8 || busy) return
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(friendly(error.message))
    else onDone()
  }

  return (
    <div className="auth-wrap">
      <div className="auth">
        <h1>New password</h1>
        <p>Pick something you will remember. This replaces the old one everywhere.</p>
        <div className="field">
          <label htmlFor="new-password">Password</label>
          <div className="input-wrap">
            <input id="new-password" type={show ? 'text' : 'password'} value={password}
              autoComplete="new-password"
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save() }} />
            <button type="button" className="reveal" onClick={() => setShow(s => !s)}
              aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <span className="hint">At least 8 characters.</span>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn" data-variant="primary" disabled={password.length < 8 || busy} onClick={save}>
          {busy ? 'Saving' : 'Save password'}
        </button>
      </div>
    </div>
  )
}
