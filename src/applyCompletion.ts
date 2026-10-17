import { cachePosterUrl, isCachedPosterUrl, type Completion } from './metadata'
import { safeUrl, translateSynopsisToFrench } from './media'
import { supabase } from './supabase'
import type { CatalogItem } from './types'
import { completionPatch } from './completionPlan'

/**
 * Écrit les champs trouvés sans jamais écraser une valeur existante, puis copie l'affiche sur Supabase
 * et traduit la description en français. Les changements imposés par l'administrateur (titre, format) passent par `extra`.
 */
export async function applyCompletion(item: CatalogItem, found: Completion, authorized: () => boolean = () => true, extra: Record<string, unknown> = {}): Promise<{ updated: number; stored: number; stillMissing: boolean; item?: CatalogItem }> {
  if (!supabase) throw new Error('Supabase n’est pas configuré.')
  if (!authorized()) throw new Error('Session interrompue')
  const current = await supabase.from('catalog_items').select('*').eq('id', item.id).maybeSingle()
  if (current.error) throw current.error
  if (!current.data) throw new Error('Cette fiche n’existe plus.')
  const live = current.data as CatalogItem
  if (!extra.metadata_preferences && (live.metadata_preferences?.rejected || live.title !== item.title || live.metadata_preferences?.match?.key !== item.metadata_preferences?.match?.key)) return { updated: 0, stored: 0, stillMissing: false }
  const poster = found.poster_url ? safeUrl(found.poster_url) : undefined
  const patch = completionPatch(live, { ...found, poster_url: poster, source_url: safeUrl(found.source_url ?? null) ?? null }, extra)
  if (!Object.keys(patch).length) return { updated: 0, stored: 0, stillMissing: false }
  if (!authorized()) throw new Error('Session interrompue')
  let write = supabase.from('catalog_items').update(patch).eq('id', item.id)
  if (live.updated_at) write = write.eq('updated_at', live.updated_at)
  const saved = await write.select('*').maybeSingle()
  if (saved.error) throw saved.error.code === '23505' ? new Error('Une autre fiche porte déjà ce titre : fusionnez-les depuis « Modifier la fiche ».') : saved.error
  if (!saved.data) throw new Error('La fiche a changé pendant la complétion. Relancez : vos modifications ont été conservées.')
  let completedItem = saved.data as CatalogItem
  const [cachedPoster, translated] = await Promise.allSettled([
    poster && patch.poster_url ? cachePosterUrl(poster) : Promise.resolve(null),
    patch.synopsis && !found.synopsisInFrench ? translateSynopsisToFrench(found.synopsis!) : Promise.resolve(null),
  ])
  const followUp: Record<string, unknown> = {}
  if (cachedPoster.status === 'fulfilled' && cachedPoster.value && isCachedPosterUrl(cachedPoster.value) && cachedPoster.value !== poster) followUp.poster_url = cachedPoster.value
  if (translated.status === 'fulfilled' && translated.value && translated.value !== found.synopsis) followUp.synopsis = translated.value
  if (authorized()) for (const field of ['poster_url', 'synopsis'] as const) {
    if (followUp[field] && typeof patch[field] === 'string') {
      const result = await supabase.from('catalog_items').update({ [field]: followUp[field] }).eq('id', item.id).eq(field, patch[field] as string).select('*').maybeSingle()
      if (!result.error && result.data) completedItem = result.data as CatalogItem
    }
  }
  const stillMissing = !completedItem.poster_url || !completedItem.synopsis?.trim() || !completedItem.genres.length || !completedItem.year
    || (completedItem.category !== 'games' && completedItem.media_format !== 'film' && !completedItem.seasons_total)
  return { updated: 1, stored: Number(Boolean(followUp.poster_url)), stillMissing, item: completedItem }
}
