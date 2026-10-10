'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { entriesOpenFrom, type Entries } from './contest-config'

/**
 * Whether the contest takes entries, from public.app_config (the platform's
 * switches; nothing about the visitor is sent). Reads the switch when the form
 * opens and on "Try again". A failed read is 'unknown', never 'open'.
 */
export function useEntriesOpen(): { entries: Entries; retry: () => void } {
  const [entries, setEntries] = useState<Entries>('checking')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    const db = supabase()
    if (!db) {
      setEntries('unknown')
      return
    }
    setEntries('checking')
    db.rpc('app_config', { p_school: null }).then(
      ({ data, error }) => {
        if (live) setEntries(error ? 'unknown' : entriesOpenFrom(data))
      },
      () => {
        if (live) setEntries('unknown')
      },
    )
    return () => {
      live = false
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { entries, retry }
}
