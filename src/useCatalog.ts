import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { BROWSE_PAGE_SIZE, catalogSort, fetchCatalogPages, filterDemoCatalog, mergeBrowseItems, type CatalogBrowseResult } from './catalogData'
import { routeCategory } from './display'
import type { CatalogItem, Category } from './types'

type Scope = Category | 'all'

export function useCatalog(path: string, search: string, isAdmin: boolean, selection: string[], demo: CatalogItem[]) {
  const [items, setItems] = useState<CatalogItem[]>(supabase ? [] : demo)
  const [ready, setReady] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [cartPending, setCartPending] = useState(false)
  const [revision, setRevision] = useState(0)
  const [browse, setBrowse] = useState<CatalogBrowseResult>({ items: [], total: 0, summary: { count: 0, seasons: 0, size: 0, genres: 0 }, years: [], genres: [] })
  const [browseLoading, setBrowseLoading] = useState(false)
  const [displayedBrowseKey, setDisplayedBrowseKey] = useState('')
  const browseCache = useRef(new Map<string, { result: CatalogBrowseResult; expiresAt: number }>())
  const generation = useRef(0)
  const lastAdmin = useRef(isAdmin)
  const complete = useRef(new Set<string>())
  const inFlight = useRef(new Map<string, Promise<void>>())
  const requested = useRef(new Set<string>())
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const scope: Scope | undefined = path === '/admin' && isAdmin ? 'all' : routeCategory[path === '/animes-mangas' ? '/animes' : path]
  const params = new URLSearchParams(search)
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const openId = params.get('titre')
  const openIdRef = useRef(openId)
  openIdRef.current = openId
  const pageQuery = {
    category: scope && scope !== 'all' ? scope : 'series', page, query: (params.get('q') ?? '').trim(), genre: params.get('genre') ?? '',
    year: params.get('annee') ?? '', origin: ['korean-drama', 'chinese-drama'].includes(params.get('origine') ?? '') ? params.get('origine')! : '',
    format: ['series', 'film'].includes(params.get('format') ?? '') ? params.get('format')! : '',
    sort: catalogSort(params.get('tri')), byYear: params.get('vue') === 'annees',
  }
  const currentBrowseKey = JSON.stringify([scope, pageQuery.page, pageQuery.query, pageQuery.genre, pageQuery.year, pageQuery.origin, pageQuery.format, pageQuery.sort, pageQuery.byYear])
  const rememberItem = useCallback((item: CatalogItem) => {
    setItems(current => [...new Map([...current, item].map(row => [row.id, row])).values()])
  }, [])

  function reset() {
    generation.current++
    complete.current.clear(); inFlight.current.clear(); requested.current.clear()
    browseCache.current.clear()
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
  const requestedIds = [...new Set([...selection, params.get('titre')].filter((id): id is string => Boolean(id)))]
  const toFetch = requestedIds.filter(id => !loadedIds.has(id) && !requested.current.has(id))
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
  useEffect(() => {
    if (lastAdmin.current !== isAdmin) { lastAdmin.current = isAdmin; reset() }
  }, [isAdmin])
  useEffect(() => { if (scope === 'all') void loadScope(scope) }, [scope, isAdmin, revision])
  useEffect(() => {
    if (!scope || scope === 'all') return
    let cancelled = false
    const controller = new AbortController()
    const version = generation.current
    const cached = browseCache.current.get(currentBrowseKey)
    function display(result: CatalogBrowseResult) {
      setBrowse(result)
      setDisplayedBrowseKey(currentBrowseKey)
      setItems(current => mergeBrowseItems(current, result.items, scope as Category, selectionRef.current, openIdRef.current, complete.current.has('all')))
    }
    if (cached) {
      display(cached.result)
      if (cached.expiresAt > Date.now()) {
        setBrowseLoading(false)
        setErrors(current => { const next = { ...current }; delete next[scope]; return next })
        return
      }
    }
    setBrowseLoading(true)
    setErrors(current => { const next = { ...current }; delete next[scope]; return next })
    void (async () => {
      try {
        let result: CatalogBrowseResult
        if (!supabase) result = filterDemoCatalog(demo, pageQuery)
        else {
          const year = pageQuery.year && pageQuery.year !== 'inconnue' ? Number(pageQuery.year) : null
          const { data, error } = await supabase.rpc('browse_catalog', {
            p_category: scope, p_page: page, p_page_size: BROWSE_PAGE_SIZE, p_query: pageQuery.query || null,
            p_genre: pageQuery.genre || null, p_year: Number.isInteger(year) ? year : null,
            p_year_unknown: pageQuery.year === 'inconnue', p_origin: pageQuery.origin || null,
            p_format: pageQuery.format || null, p_sort: pageQuery.sort, p_by_year: pageQuery.byYear,
          }).abortSignal(controller.signal)
          if (error) throw error
          result = data as CatalogBrowseResult
        }
        if (cancelled || generation.current !== version) return
        browseCache.current.delete(currentBrowseKey)
        browseCache.current.set(currentBrowseKey, { result, expiresAt: Date.now() + 60_000 })
        if (browseCache.current.size > 20) browseCache.current.delete(browseCache.current.keys().next().value!)
        display(result)
      } catch (error) {
        if (!cancelled && generation.current === version) setErrors(current => ({ ...current, [scope]: error instanceof Error ? error.message : 'Chargement impossible.' }))
      } finally {
        if (!cancelled && generation.current === version) setBrowseLoading(false)
      }
    })()
    return () => { cancelled = true; controller.abort() }
  }, [scope, isAdmin, revision, page, pageQuery.query, pageQuery.genre, pageQuery.year, pageQuery.origin, pageQuery.format, pageQuery.sort, pageQuery.byYear, currentBrowseKey])

  const error = scope ? errors[scope] ?? '' : ''
  const loading = Boolean(scope && (scope === 'all' ? supabase && !ready.has('all') : browseLoading || displayedBrowseKey !== currentBrowseKey) && !error)
  async function refresh() {
    reset()
    if (scope === 'all') await loadScope(scope)
  }
  return { items, rememberItem, browseItems: browse.items, browseTotal: browse.total, browseSummary: browse.summary, browseYears: browse.years, browseGenres: browse.genres, browsePage: page, browsePageSize: BROWSE_PAGE_SIZE, loading, error, refresh, cartPending: cartPending || Boolean(supabase && toFetch.length), missing }
}
