import { useCallback, useEffect, useRef, useState } from 'react'

interface Loaded<T> {
  key: string
  data: T | undefined
  error: Error | undefined
}

// Fetch on mount and whenever `key` changes. `pollMs` refetches quietly in the background.
export function useLoad<T>(fn: () => Promise<T>, key: string, pollMs?: number) {
  const [loaded, setLoaded] = useState<Loaded<T> | undefined>()
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })

  const run = useCallback(async (forKey: string) => {
    try {
      const data = await fnRef.current()
      setLoaded({ key: forKey, data, error: undefined })
    } catch (e) {
      // a failed background poll shouldn't wipe what's already on screen
      setLoaded((prev) =>
        prev?.key === forKey && prev.data !== undefined ? prev : { key: forKey, data: undefined, error: e as Error },
      )
    }
  }, [])

  useEffect(() => {
    void run(key)
    if (!pollMs) return
    const t = setInterval(() => void run(key), pollMs)
    return () => clearInterval(t)
  }, [key, pollMs, run])

  // a result for a previous key is stale: show the spinner instead
  const current = loaded?.key === key ? loaded : undefined
  const reload = useCallback(() => run(key), [run, key])
  const setData = useCallback((data: T) => setLoaded({ key, data, error: undefined }), [key])

  return { data: current?.data, error: current?.error, loading: !current, reload, setData }
}

// Current time that ticks, for UI that depends on a pickup window opening or closing.
export function useNow(everyMs = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}
