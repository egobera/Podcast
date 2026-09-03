import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * A white screen tells the user nothing. This catches anything that escapes a
 * component and shows what broke, so a bug is reportable instead of mysterious.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Estudio crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="auth-wrap">
        <div className="auth" style={{ width: 'min(520px, 92vw)' }}>
          <h1>Something broke</h1>
          <p>
            This is a bug, not something you did. The message below says what happened.
          </p>
          <pre className="crash">{this.state.error.message}</pre>
          <div className="btn-row">
            <button className="btn" data-variant="primary" onClick={() => location.reload()}>
              Reload
            </button>
            <button className="btn" onClick={() => this.setState({ error: null })}>
              Try to continue
            </button>
          </div>
        </div>
      </div>
    )
  }
}

/** Shown when the database is missing the tables a migration should have created. */
export function SetupNeeded({ message }: { message: string }) {
  return (
    <div className="auth-wrap">
      <div className="auth" style={{ width: 'min(560px, 92vw)' }}>
        <h1>One more migration to run</h1>
        <p>
          The database is missing something the app needs, or a migration stopped halfway. Open
          your Supabase project, go to the SQL editor, and run these files in order. They are safe
          to run again: anything already in place is left alone.
        </p>
        <ol className="setup-list">
          <li><code>schema.sql</code></li>
          <li><code>migration-002-template-and-blocks.sql</code></li>
          <li><code>migration-003-teams.sql</code></li>
          <li><code>migration-004-language.sql</code></li>
          <li><code>migration-005-ensure-team.sql</code></li>
        </ol>
        <pre className="crash">{message}</pre>
        <button className="btn" data-variant="primary" onClick={() => location.reload()}>
          I have run them, reload
        </button>
      </div>
    </div>
  )
}
