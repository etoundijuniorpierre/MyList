import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { categories, type CatalogItem, type Category } from './types'

export interface HomeShelf { category: Category; count: number; latest: CatalogItem[] }

const columns = 'id,category,media_type,media_format,title,title_key,synopsis,poster_url,genres,year,source,source_id,source_url,active,seasons_count,game_size_gb,created_at'
let cache: HomeShelf[] | null = null

// L'accueil n'a besoin que des compteurs et de quelques affiches récentes par univers, pas du catalogue entier.
export function useHomeData(demo: CatalogItem[]) {
  const [shelves, setShelves] = useState<HomeShelf[] | null>(supabase ? cache : categories.map(({ key }) => ({ category: key, count: demo.filter(item => item.category === key).length, latest: demo.filter(item => item.category === key) })))
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!supabase || cache) return
    let cancelled = false
    void Promise.all(categories.map(async ({ key }) => {
      const [count, latest] = await Promise.all([
        supabase!.from('catalog_items').select('id', { count: 'exact', head: true }).eq('category', key).eq('active', true),
        supabase!.from('catalog_items').select(columns).eq('category', key).eq('active', true).not('poster_url', 'is', null).order('created_at', { ascending: false }).limit(16),
      ])
      if (count.error || latest.error) throw count.error ?? latest.error
      return { category: key, count: count.count ?? 0, latest: (latest.data ?? []) as CatalogItem[] }
    })).then((result) => { cache = result; if (!cancelled) setShelves(result) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])
  return { shelves, error }
}
