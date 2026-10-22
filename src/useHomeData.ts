import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { categories, type CatalogItem } from './types'
import { currentReleaseYear, demoHomeShelves, HOME_RELEASE_LIMIT, makeHomeShelf, type HomeShelf } from './homeData'

const columns = 'id,category,media_type,media_format,title,title_key,synopsis,poster_url,genres,year,source,source_id,source_url,active,seasons_count,seasons_total,game_size_gb,created_at,metadata_preferences'
let cache: { year: number; expiresAt: number; shelves: HomeShelf[] } | null = null

// Les nouveautés utilisent l'année de sortie. Les affiches décoratives restent séparées.
export function useHomeData(demo: CatalogItem[]) {
  const releaseYear = currentReleaseYear()
  const [shelves, setShelves] = useState<HomeShelf[] | null>(() => supabase
    ? cache?.year === releaseYear && cache.expiresAt > Date.now() ? cache.shelves : null
    : demoHomeShelves(demo, releaseYear))
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!supabase) { setShelves(demoHomeShelves(demo, releaseYear)); return }
    if (cache?.year === releaseYear && cache.expiresAt > Date.now()) { setShelves(cache.shelves); return }
    let cancelled = false
    const controller = new AbortController()
    void Promise.all(categories.map(async ({ key }) => {
      const [count, latest] = await Promise.all([
        supabase!.from('catalog_items').select('id', { count: 'exact', head: true }).eq('category', key).eq('active', true).abortSignal(controller.signal),
        supabase!.from('catalog_items').select(columns).eq('category', key).eq('active', true).eq('year', releaseYear).order('title').order('id').limit(HOME_RELEASE_LIMIT).abortSignal(controller.signal),
      ])
      if (count.error || latest.error) throw count.error ?? latest.error
      const releases = (latest.data ?? []) as CatalogItem[]
      let featured: CatalogItem[] = []
      if (!releases.some(item => item.poster_url)) {
        const covers = await supabase!.from('catalog_items').select(columns).eq('category', key).eq('active', true).not('poster_url', 'is', null)
          .order('year', { ascending: false, nullsFirst: false }).order('title').limit(3).abortSignal(controller.signal)
        featured = (covers.data ?? []) as CatalogItem[]
      }
      return makeHomeShelf(key, count.count ?? 0, releases, featured, releaseYear)
    })).then((result) => { if (!cancelled) { cache = { year: releaseYear, expiresAt: Date.now() + 60_000, shelves: result }; setShelves(result); setError(false) } })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true; controller.abort() }
  }, [releaseYear, demo])
  return { shelves, error, releaseYear }
}
