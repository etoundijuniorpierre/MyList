import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { supabase } from '../supabase'
import { ItemSaveQueue } from './itemSaveQueue'
import type { CatalogItem } from '../types'
import type { CatalogCommit } from './saveCatalogItem'

interface Options {
  owner: string | null
  getItems: () => CatalogItem[]
  commit: (change: CatalogCommit) => void
  notify: (text: string) => void
}

export function useItemSaves(options: Options) {
  const session = useRef({ owner: options.owner, generation: 0 })
  if (session.current.owner !== options.owner) session.current = { owner: options.owner, generation: session.current.generation + 1 }
  const owner = options.owner ? `${options.owner}:${session.current.generation}` : null
  const runtime = useRef({ ...options, owner })
  runtime.current = { ...options, owner }
  const [queue] = useState(() => new ItemSaveQueue({
    owner: () => runtime.current.owner,
    notify: text => runtime.current.notify(text),
    save: async job => {
      if (!supabase) throw new Error('Supabase n’est pas configuré.')
      const authorized = () => runtime.current.owner === job.owner
      const { saveCatalogItem } = await import('./saveCatalogItem')
      const item = await saveCatalogItem(supabase, job.input, job.itemId, runtime.current.getItems(), change => {
        if (authorized()) runtime.current.commit(change)
      }, authorized)
      // Les enrichissements restent séparés de l'enregistrement principal.
      void import('./savedEnrichment').then(({ enrichSavedItem }) => enrichSavedItem(item, change => {
        if (authorized()) runtime.current.commit(change)
      }, authorized)).catch(() => {})
    },
  }))
  const allJobs = useSyncExternalStore(queue.subscribe, queue.snapshot)
  const jobs = allJobs.filter(job => job.owner === owner)
  const pending = jobs.filter(job => job.status === 'saving' || job.status === 'queued')
  useEffect(() => {
    if (!pending.length) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [pending.length])
  return { queue, jobs, pending }
}
