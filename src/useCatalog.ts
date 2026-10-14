import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { fetchCatalogPages } from './catalogData'
import { routeCategory } from './display'
import type { CatalogItem, Category } from './types'

type Scope = Category | 'all'

export function useCatalog(path: string, isAdmin: boolean, selection: string[], demo: CatalogItem[]) {
  const [items, setItems] = useState<CatalogItem[]>(supabase ? [] : demo)
  const [ready, setReady] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [cartPending, setCartPending] = useState(false)
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const complete = useRef(new Set<string>())
  const inFlight = useRef(new Map<string, Promise<void>>())
  const requested = useRef(new Set<string>())
  const scope: Scope | undefined = path === '/admin' && isAdmin ? 'all' : routeCategory[path === '/animes-mangas' ? '/animes' : path]

  function reset() {
    generation.current++
    complete.current.clear(); inFlight.current.clear(); requested.current.clear()
    setItems(supabase ? [] : demo); setReady(new Set()); setErrors({}); setMissing(new Set())
    setRevision(value => value + 1)
  }

  function load(key: string, fetchRows: () => Promise<CatalogItem[]>, replace: (item: CatalogItem) => boolean) {
    if (!supabase || complete.current.has(key) || (key !== 'all' && complete.current.has('all'))) return Promise.resolve()
    const pending = inFlight.current.get(key)
    if (pending) return pending
    const version = generation.current
    const task = (async () => {
      try {
        const rows = await fetchRows()
        if (generation.current !== version || (key !== 'all' && complete.current.has('all'))) return
        setItems(current => [...new Map([...current.filter(item => !replace(item)), ...rows].map(item => [item.id, item])).values()])
        complete.current.add(key)
        setReady(new Set(complete.current))
        setErrors(current => { const next = { ...current }; delete next[key]; return next })
      } catch (error) {
        if (generation.current === version) setErrors(current => ({ ...current, [key]: error instanceof Error ? error.message : 'Chargement impossible.' }))
      } finally {
        if (generation.current === version) inFlight.current.delete(key)
      }
    })()
    inFlight.current.set(key, task)
    return task
  }

  function loadScope(target: Scope) {
    return load(target, () => fetchCatalogPages((from, to, withCount) => {
      let query = supabase!.from('catalog_items').select('*', withCount ? { count: 'exact' } : undefined)
      if (target !== 'all') query = query.eq('category', target).eq('active', true)
      return query.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
    }), item => target === 'all' || item.category === target)
  }

  // Le panier peut contenir des titres d'autres univers : on ne lit que ceux qui ne sont pas déjà chargés.
  const loadedIds = new Set(items.map(item => item.id))
  const toFetch = selection.filter(id => !loadedIds.has(id) && !requested.current.has(id))
  const toFetchKey = toFetch.sort().join(',')
  useEffect(() => {
    if (!supabase || !toFetch.length) return
    const version = generation.current
    toFetch.forEach(id => requested.current.add(id))
    setCartPending(true)
    void (async () => {
      try {
        const rows: CatalogItem[] = []
        for (let offset = 0; offset < toFetch.length; offset += 100) {
          const result = await supabase!.from('catalog_items').select('*').eq('active', true).in('id', toFetch.slice(offset, offset + 100))
          if (result.error) throw result.error
          rows.push(...result.data as CatalogItem[])
        }
        if (generation.current !== version) return
        const found = new Set(rows.map(row => row.id))
        setItems(current => [...new Map([...current, ...rows].map(item => [item.id, item])).values()])
        setMissing(current => new Set([...current, ...toFetch.filter(id => !found.has(id))]))
      } catch {
        toFetch.forEach(id => requested.current.delete(id))
      } finally {
        if (generation.current === version) setCartPending(false)
      }
    })()
  }, [toFetchKey, revision])

  // A privilege change invalidates pending responses and cached admin-only rows.
  useEffect(() => { reset() }, [isAdmin])
  useEffect(() => { if (scope) void loadScope(scope) }, [scope, isAdmin, revision])

  const error = scope ? errors[scope] ?? '' : ''
  const loading = Boolean(supabase && scope && !ready.has(scope) && !ready.has('all') && !error)
  async function refresh() {
    reset()
    if (scope) await loadScope(scope)
  }
  return { items, loading, error, refresh, cartPending: cartPending || Boolean(supabase && toFetch.length), missing }
}
