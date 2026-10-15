import { cachePosterUrl, isCachedPosterUrl, type Completion } from './metadata'
import { safeUrl, translateSynopsisToFrench } from './media'
import { supabase } from './supabase'
import type { CatalogItem } from './types'

/**
 * Écrit les champs trouvés sans jamais écraser une valeur existante, puis copie l'affiche sur Supabase
 * et traduit la description en français. Les changements imposés par l'administrateur (titre, format) passent par `extra`.
 */
export async function applyCompletion(item: CatalogItem, found: Completion, authorized: () => boolean = () => true, extra: Record<string, unknown> = {}) {
  if (!supabase) throw new Error('Supabase n’est pas configuré.')
  const patch: Record<string, unknown> = { ...extra }
  const poster = found.poster_url ? safeUrl(found.poster_url) : undefined
  if (poster && !item.poster_url) patch.poster_url = poster
  if (found.genres?.length && !item.genres.length) patch.genres = found.genres
  if (found.year && !item.year) patch.year = found.year
  if (found.synopsis && !item.synopsis?.trim()) patch.synopsis = found.synopsis
  if (found.source) { patch.source = found.source; patch.source_id = found.source_id ?? null; patch.source_url = safeUrl(found.source_url ?? null) ?? null }
  if (!Object.keys(patch).length) return { updated: 0, stored: 0, stillMissing: true }
  if (!authorized()) throw new Error('Session interrompue')
  const saved = await supabase.from('catalog_items').update(patch).eq('id', item.id).select('id').maybeSingle()
  if (saved.error) throw saved.error.code === '23505' ? new Error('Une autre fiche porte déjà ce titre : fusionnez-les depuis « Modifier la fiche ».') : saved.error
  if (!saved.data) throw new Error('La fiche trouvée n’a pas été enregistrée. Vérifiez les droits de modification dans Supabase.')
  const [cachedPoster, translated] = await Promise.allSettled([
    poster && patch.poster_url ? cachePosterUrl(poster) : Promise.resolve(null),
    patch.synopsis && !found.synopsisInFrench ? translateSynopsisToFrench(found.synopsis!) : Promise.resolve(null),
  ])
  const followUp: Record<string, unknown> = {}
  if (cachedPoster.status === 'fulfilled' && cachedPoster.value && isCachedPosterUrl(cachedPoster.value) && cachedPoster.value !== poster) followUp.poster_url = cachedPoster.value
  if (translated.status === 'fulfilled' && translated.value && translated.value !== found.synopsis) followUp.synopsis = translated.value
  if (Object.keys(followUp).length && authorized()) await supabase.from('catalog_items').update(followUp).eq('id', item.id)
  const stillMissing = (!item.poster_url && !patch.poster_url) || (!item.synopsis?.trim() && !patch.synopsis)
  return { updated: 1, stored: Number(Boolean(followUp.poster_url)), stillMissing }
}
