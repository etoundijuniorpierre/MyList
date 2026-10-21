import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogItem, CatalogSeason } from '../types'

export async function saveSeason(client: SupabaseClient, season: CatalogSeason) {
  if (!Number.isInteger(season.number) || season.number < 1 || season.number > 999) throw new Error('Le numéro de saison doit être compris entre 1 et 999.')
  for (const url of [season.poster_url, season.source_url]) {
    if (url) { let parsed: URL; try { parsed = new URL(url) } catch { throw new Error('Utilisez une adresse HTTPS valide pour l’affiche et la source.') }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Utilisez une adresse HTTPS valide pour l’affiche et la source.') }
  }
  if (season.year != null && (!Number.isInteger(season.year) || season.year < 1850 || season.year > 2200)) throw new Error('L’année doit être comprise entre 1850 et 2200.')
  const result = await client.rpc('save_catalog_season', { p_item_id: season.item_id, p_expected_updated_at: season.updated_at ?? null,
    p_values: { number: season.number, title: season.title?.trim() || `Saison ${season.number}`, synopsis: season.synopsis?.trim() || null,
      poster_url: season.poster_url?.trim() || null, year: season.year, source: season.source, source_id: season.source_id, source_url: season.source_url } }).abortSignal(AbortSignal.timeout(10000))
  if (result.error) throw new Error(result.error.code === '40001' ? 'Cette saison a changé pendant votre modification. Rechargez ses informations avant de réessayer.' : 'La saison n’a pas pu être enregistrée. Vérifiez votre connexion et votre session administrateur.')
  const data = result.data as { item?: CatalogItem; season?: CatalogSeason } | null
  if (!data?.item?.id || !data.season?.item_id) throw new Error('La confirmation d’enregistrement est incomplète. Rechargez les saisons pour vérifier.')
  return { item: data.item, season: data.season }
}
