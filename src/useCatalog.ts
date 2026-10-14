import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { fetchCatalogPages } from './catalogData'
import type { CatalogItem, Category } from './types'

const routeCategories: Record<string, Category> = { '/': 'series', '/series': 'series', '/jeux-pc': 'games', '/animes': 'anime', '/animes-mangas': 'anime', '/novelas': 'novelas', '/dramas': 'dramas' }
type Scope = Category | 'all'

export function useCatalog(path: string, isAdmin: boolean, selection: string[], demo: CatalogItem[]) {
  const [items, setItems] = useState<CatalogItem[]>(supabase ? [] : demo)
  const [ready, setReady] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const complete = useRef(new Set<string>())
  const inFlight = useRef(new Map<string, Promise<void>>())
  const scope = path === '/admin' && isAdmin ? 'all' : routeCategories[path]
  const selectionKey = [...selection].sort().join(',')
  const cartScope = `cart:${selectionKey}`

  function reset() {
    generation.current++
    complete.current.clear(); inFlight.current.clear()
    setItems(supabase ? [] : demo); setReady(new Set()); setErrors({})
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

  function loadSelection() {
    return load(cartScope, async () => {
      const rows: CatalogItem[] = []
      // Read only selected IDs; a restored basket never needs every category.
      for (let offset = 0; offset < selection.length; offset += 100) {
        const result = await supabase!.from('catalog_items').select('*').eq('active', true).in('id', selection.slice(offset, offset + 100))
        if (result.error) throw result.error
        rows.push(...result.data as CatalogItem[])
      }
      return rows
    }, item => selection.includes(item.id))
  }

  // A privilege change invalidates pending responses and cached admin-only rows.
  useEffect(() => { reset() }, [isAdmin])
  useEffect(() => { if (scope) void loadScope(scope) }, [scope, isAdmin, revision])
  useEffect(() => { if (path === '/selection') void loadSelection() }, [path, selectionKey, isAdmin, revision])

  const key = path === '/selection' ? cartScope : scope
  const error = key ? errors[key] ?? '' : ''
  const loading = Boolean(supabase && key && !ready.has(key) && !ready.has('all') && !error)
  async function refresh() {
    reset()
    await Promise.all([scope ? loadScope(scope) : Promise.resolve(), path === '/selection' ? loadSelection() : Promise.resolve()])
  }
  return { items, loading, error, refresh }
}
