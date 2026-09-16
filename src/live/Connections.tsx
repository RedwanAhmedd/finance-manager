import { useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Source } from './client'

export default function Connection({ source, client, onSession }: { source: Source; client: SupabaseClient | null; onSession: (user: string | null) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!client) return
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user.email ?? null)
      onSession(session?.user.id ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [client, onSession])
  async function signIn(event: FormEvent) {
    event.preventDefault(); if (!client) return
    setBusy(true); setError('')
    try {
      const { error } = await client.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } catch { setError('Could not reach the source. Please try again.') }
    finally { setPassword(''); setBusy(false) }
  }
  async function signOut() {
    if (!client) return
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) setError(error.message)
  }
  return <article className="panel connection">
    <div className="panel-heading"><h2>{source}</h2><span className="system-tag">{user ? 'SIGNED IN' : 'CONNECT'}</span></div>
    {!client ? <p>Connection not configured. Add the source URL and publishable key in .env.local.</p> : user ?
      <div className="connected-row"><span>{user}</span><button onClick={() => void signOut()}>Disconnect</button></div> :
      <form onSubmit={signIn} className="connection-form">
        <label>Email<input aria-label={`${source} email`} type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Password<input aria-label={`${source} password`} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button type="submit" disabled={busy}>{busy ? 'Connecting…' : `Connect ${source}`}</button>
      </form>}
    {error && <p role="alert" className="error">{error}</p>}
  </article>
}
