import type { SupabaseClient } from '@supabase/supabase-js'
import { catalogIdentity, isCatalogNoiseTitle, mergeCatalogUpdate, sameCatalogTitle } from '../catalogImport'
import { safeUrl } from '../urls'
import { titleKey, type CatalogItem, type ItemInput } from '../types'
import { validSeasonNumbers } from '../seasonSelection'

export function cleanItemInput(input: ItemInput): ItemInput {
  const mediaType = input.category === 'anime' ? 'anime' : input.category === 'dramas' ? input.media_type : null
  return {
    category: input.category, genres: [...input.genres], title: input.title.trim(), media_type: mediaType,
    media_format: input.category === 'anime' && input.media_format === 'film' ? 'film' : null,
    title_key: titleKey(input.category, mediaType, input.title, input.category === 'anime' ? input.media_format ?? null : null),
    synopsis: input.synopsis?.trim() || null, poster_url: safeUrl(input.poster_url) ?? null,
    source_url: safeUrl(input.source_url) ?? null,
    source: input.source, source_id: input.source_id, year: input.year, active: input.active,
    seasons_count: input.category === 'games' || (input.category === 'anime' && input.media_format === 'film') ? null : input.seasons_count,
    game_size_gb: input.category === 'games' ? input.game_size_gb : null,
    ...('available_seasons' in input ? { available_seasons: input.available_seasons?.length ? validSeasonNumbers(input.available_seasons) : null } : {}),
  }
}

export function duplicateItem(items: CatalogItem[], clean: ItemInput, id?: string) {
  return items.find(item => item.id !== id && (item.title_key === clean.title_key || sameCatalogTitle(item, clean)
    || (clean.source_id && item.source === clean.source && item.source_id === clean.source_id)))
}

export function itemWriteLocks(items: CatalogItem[], input: ItemInput, id?: string) {
  const clean = cleanItemInput(input)
  const duplicate = duplicateItem(items, clean, id)
  return [...(id ? [`id:${id}`] : []), ...(duplicate ? [`id:${duplicate.id}`] : []),
    `title:${clean.title_key}`, `identity:${catalogIdentity(clean.category, clean.media_type, clean.title)}:${clean.media_format === 'film' ? 'film' : 'series'}`,
    ...(clean.source_id ? [`source:${clean.source}:${clean.source_id}`] : [])]
}

export interface CatalogCommit { item: CatalogItem; removedIds: string[]; field?: 'synopsis' | 'poster_url'; expected?: string }

export async function saveCatalogItem(client: SupabaseClient, input: ItemInput, id: string | undefined, items: CatalogItem[], commit: (change: CatalogCommit) => void, authorized: () => boolean = () => true, manual = false) {
  if (!authorized()) throw new Error('La session administrateur a changé. Reconnectez-vous.')
  const clean = cleanItemInput(input)
  if (!clean.title || isCatalogNoiseTitle(clean.title)) throw new Error('Le nom du dossier ne correspond pas à un titre exploitable.')
  const duplicate = duplicateItem(items, clean, id)
  const target = duplicate?.id ?? id
  const existing = items.find(item => item.id === target)
  const edited = id ? items.find(item => item.id === id) : undefined
  if (id && !edited) throw new Error('Cette fiche n’est plus disponible. Vérifiez le catalogue avant de la recréer.')
  const payload = { ...mergeCatalogUpdate(clean, existing, id && duplicate ? edited : undefined),
    title: duplicate ? duplicate.title : manual ? clean.title : existing ? existing.title : clean.title,
    title_key: duplicate ? duplicate.title_key : manual ? clean.title_key : existing?.title_key ?? clean.title_key,
  }
  if (existing && (payload.seasons_count !== existing.seasons_count || ('available_seasons' in clean && JSON.stringify(clean.available_seasons) !== JSON.stringify(existing.available_seasons)))) {
    payload.season_details_checked_at = null
    if (!('available_seasons' in clean)) payload.available_seasons = null
  }
  if (manual) {
    payload.metadata_preferences = { ...edited?.metadata_preferences, ...existing?.metadata_preferences, title: payload.title }
    if (clean.seasons_count) { payload.metadata_preferences.seasons_manual = clean.seasons_count; payload.metadata_preferences.seasons_auto = false }
    else { delete payload.metadata_preferences.seasons_manual; payload.metadata_preferences.seasons_auto = false }
    const changedIdentity = clean.source !== existing?.source || clean.source_id !== existing?.source_id
    if (clean.source_id && !['manual', 'scan', 'pdf-list'].includes(clean.source) && (!payload.metadata_preferences.rejected || changedIdentity) && (!payload.metadata_preferences.match || clean.source !== payload.metadata_preferences.match.source || clean.source_id !== payload.metadata_preferences.match.source_id)) {
      payload.metadata_preferences.rejected = false
      payload.metadata_preferences.match = { key: `${clean.source}:${clean.source_id}`, title: clean.title, aliases: [], category: clean.category, format: clean.media_format ?? null,
        year: clean.year, poster_url: clean.poster_url, synopsis: clean.synopsis, genres: clean.genres, source: clean.source, source_id: clean.source_id, source_url: clean.source_url, sources: [clean.source], score: 1, notes: [], identities: [{ source: clean.source, id: clean.source_id }] }
    }
  }
  const response = target ? await client.from('catalog_items').update(payload).eq('id', target).select('*').single()
    : await client.from('catalog_items').insert(payload).select('*').single()
  if (response.error) throw new Error(saveErrorMessage(response.error))
  if (!response.data?.id) throw new Error('Supabase n’a confirmé aucune fiche enregistrée.')
  if (!authorized()) throw new Error('La session administrateur a changé pendant l’enregistrement.')
  const item = response.data as CatalogItem
  commit({ item, removedIds: [] })
  if (id && duplicate && duplicate.id !== id) {
    const removed = await client.from('catalog_items').delete().eq('id', id).select('id').maybeSingle()
    if (removed.error || !removed.data) throw new Error(`La fiche « ${duplicate.title} » a été mise à jour, mais l’ancienne fiche n’a pas pu être retirée. Réessayez depuis le suivi des enregistrements.`)
    if (authorized()) commit({ item, removedIds: [id] })
  }
  return item
}

export function saveErrorMessage(error: unknown): string {
  const issue = error as { code?: string; message?: string; details?: string; hint?: string }
  const reason = [issue?.message, issue?.details, issue?.hint].filter(Boolean).join(' — ')
  if (issue?.code === '23505') return `Cette fiche entre en conflit avec un titre ou une correspondance déjà enregistrée. Détail Supabase : ${reason || 'contrainte unique'}`
  if (issue?.code === '42501' || issue?.code === 'PGRST301') return `Supabase a refusé la modification pour cette session. Vérifiez les droits administrateur. ${reason}`.trim()
  return reason ? `Enregistrement impossible : ${reason}` : 'Enregistrement impossible. Supabase n’a pas fourni de détail exploitable.'
}
