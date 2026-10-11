import { useCallback, useEffect, useState } from 'react'
import {
  createOutbox,
  memoryOutboxStore,
  type FlushResult,
  type Outbox,
  type OutboxJob,
  type OutboxSend,
  type OutboxStore,
} from '@ai-tutor/lms-client'
import { api, backend } from '@/lib/backend'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Work waiting for the internet, kept on this phone (lms-client outbox.ts).
 * One outbox per child: what one child left waiting is sent only when that
 * child is signed in, never under somebody else's sign-in on the same phone.
 * Kept in IndexedDB, which holds photos; where the phone keeps nothing
 * (some private windows), in memory until the app closes.
 */
function phoneStore(userId: string): OutboxStore {
  const fallback = memoryOutboxStore()
  const key = `jobs:${userId}`
  const run = <T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      const opening = indexedDB.open('qrie-outbox', 1)
      opening.onupgradeneeded = () => opening.result.createObjectStore('jobs')
      opening.onerror = () => reject(opening.error)
      opening.onsuccess = () => {
        const db = opening.result
        const tx = db.transaction('jobs', mode)
        const request = act(tx.objectStore('jobs'))
        tx.oncomplete = () => {
          db.close()
          resolve(request.result)
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
      }
    })
  return {
    async load() {
      try {
        return ((await run('readonly', (s) => s.get(key))) as OutboxJob[] | undefined) ?? []
      } catch {
        return fallback.load()
      }
    },
    async save(jobs) {
      try {
        await run('readwrite', (s) => s.put(jobs, key))
      } catch {
        await fallback.save(jobs)
      }
    },
  }
}

const boxes = new Map<string, Outbox>()
export function outboxFor(userId: string): Outbox {
  let box = boxes.get(userId)
  if (!box) {
    box = createOutbox(phoneStore(userId))
    boxes.set(userId, box)
  }
  return box
}

/** The school, as the outbox reaches it. */
export const outboxSend: OutboxSend = {
  saveTestAnswer: (a, item, chosen) => api.saveTestAnswer(a, item, chosen),
  submitMcq: (a, answers, key, activeMs) => api.submitMcq(a, answers, key, activeMs),
  uploadWork: (name, file) => backend.uploadWork(name, file),
  submitPhotos: (a, names, key) => api.submitPhotos(a, names, key),
}

/** The signed-in child's waiting jobs, kept up to date, and a way to send them now. */
export function useOutbox(): { jobs: OutboxJob[]; flush: () => Promise<FlushResult | null>; box: Outbox | null } {
  const userId = useAuthStore((s) => s.me?.userId ?? null)
  const box = userId ? outboxFor(userId) : null
  const [jobs, setJobs] = useState<OutboxJob[]>([])
  useEffect(() => {
    if (!box) return setJobs([])
    let live = true
    const reload = () => void box.pending().then((j) => live && setJobs(j))
    reload()
    const stop = box.subscribe(reload)
    return () => {
      live = false
      stop()
    }
  }, [box])
  const flush = useCallback(async () => (box ? box.flush(outboxSend) : null), [box])
  return { jobs, flush, box }
}
