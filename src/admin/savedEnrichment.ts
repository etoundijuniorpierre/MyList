import { cachePosterUrl, isCachedPosterUrl } from '../metadata'
import { translateSynopsisToFrench } from '../media'
import { supabase } from '../supabase'
import type { CatalogItem } from '../types'
import type { CatalogCommit } from './saveCatalogItem'

export async function enrichSavedItem(item: CatalogItem, commit: (change: CatalogCommit) => void, authorized: () => boolean) {
  const enrich = async (field: 'synopsis' | 'poster_url', value: string, replacement: () => Promise<string | null>) => {
    try {
      const next = await replacement()
      if (!next || next === value || !authorized() || !supabase) return
      const result = await supabase.from('catalog_items').update({ [field]: next }).eq('id', item.id).eq(field, value).select('*').maybeSingle()
      if (!result.error && result.data && authorized()) commit({ item: result.data as CatalogItem, removedIds: [], field, expected: value })
    } catch { /* La saisie est déjà enregistrée ; l'enrichissement pourra être relancé. */ }
  }
  // Séquentiel : les deux réponses complètes ne doivent pas s'écraser entre elles.
  if (item.synopsis?.trim()) await enrich('synopsis', item.synopsis, () => translateSynopsisToFrench(item.synopsis))
  if (item.poster_url) await enrich('poster_url', item.poster_url, async () => {
    const cached = await cachePosterUrl(item.poster_url!)
    return cached && isCachedPosterUrl(cached) ? cached : null
  })
}
