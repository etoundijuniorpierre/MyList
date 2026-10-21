import { supabase } from './supabase'
import { displaySeasons } from './seasonSelection'
import type { CatalogItem, CatalogSeason } from './types'

const cache = new Map<string, { expires: number; version: string | null | undefined; rows: CatalogSeason[] }>()
export function forgetSeasons(id: string) { cache.delete(id) }
export async function loadSeasons(item: CatalogItem, signal?: AbortSignal): Promise<CatalogSeason[]> {
  const hit = cache.get(item.id)
  if (hit && hit.expires > Date.now() && hit.version === item.updated_at) return displaySeasons(item, hit.rows)
  if (!supabase) return displaySeasons(item, [])
  const result = await supabase.from('catalog_seasons').select('*').eq('item_id', item.id).order('number').abortSignal(signal ?? AbortSignal.timeout(8000))
  if (result.error) throw new Error('Les détails des saisons sont momentanément indisponibles. Les numéros et les quantités disponibles restent affichés.')
  const rows = result.data as CatalogSeason[]
  if (cache.size >= 80) cache.delete(cache.keys().next().value!)
  cache.set(item.id, { expires: Date.now() + 300000, version: item.updated_at, rows })
  return displaySeasons(item, rows)
}
