import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="auth-wrap">
      <div className="auth">
        <h1>Estudio</h1>
        {sent ? (
          <p>Check {email}. The link signs you in and brings you straight back here.</p>
        ) : (
          <>
            <p>Production workspace for serialized audio fiction. Sign in with your email and we send you a link.</p>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                autoComplete="email"
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && email) send() }}
              />
            </div>
            {error && <p className="error">{error}</p>}
            <button className="btn" data-variant="primary" disabled={!email || busy} onClick={send}>
              {busy ? 'Sending' : 'Send link'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
