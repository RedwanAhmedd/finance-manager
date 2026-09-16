import { useCallback, useEffect, useState } from 'react'

export function useSnapshot<T>(user: string | null, adapter: {getSnapshot(): Promise<T>} | null) {
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<{user: string | null; data: T | null; error: string; loading: boolean}>({user: null, data: null, error: '', loading: false})
  useEffect(() => {
    let active = true
    setState({user, data: null, error: '', loading: !!user && !!adapter})
    if (user && adapter) void adapter.getSnapshot().then(data => {
      if (active) setState({user, data, error: '', loading: false})
    }).catch(error => {
      if (active) setState({user, data: null, error: error instanceof Error ? error.message : 'Source read failed', loading: false})
    })
    return () => { active = false }
  }, [user, adapter, generation])
  const refresh = useCallback(() => { setState({user, data: null, error: '', loading: !!user}); setGeneration(n => n + 1) }, [user])
  // Never render a previous account's data during sign-out / account switches.
  return { ...state, data: state.user === user && user ? state.data : null, refresh }
}
