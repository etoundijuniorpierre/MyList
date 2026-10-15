import { cachePosterUrl, completeMetadata, isCachedPosterUrl, searchMetadata } from './metadata'
import { uniqueExactMatch } from './titleMatch'
import { safeUrl, translateSynopsisToFrench } from './media'
import { supabase } from './supabase'
import { readPosterJob, savePosterJob, type PosterJob } from './posterJobState'
import { isLandscapePoster } from './posterDimensions'
import { selectAnimePoster } from './animePosterMatch'
import type { CatalogItem } from './types'

export async function resumePosterJob(initial: PosterJob, authorized: () => boolean, publish: (job: PosterJob) => void) {
  async function work() {
    const saved = readPosterJob()
    if (!supabase || !authorized() || saved?.id !== initial.id || saved.result || saved.error) return
    let job = saved
    publish(job)
    try {
      // Keep the free metadata APIs within a moderate request burst while
      // doubling throughput over the original three-title search batches.
      while (authorized()) {
       while (job.completed < job.total && authorized()) {
        const size = job.kind === 'repair-games' && job.phase === 'scan' ? 24 : job.kind === 'cache' ? 8 : job.kind === 'translate' ? 2 : job.kind === 'complete' ? 4 : 6
        const ids = job.ids.slice(job.completed, job.completed + size)
        const { data, error } = await supabase.from('catalog_items').select('*').in('id', ids)
        if (error) throw new Error(error.message)
        if (!authorized()) return
        if (job.kind === 'repair-games' && job.phase === 'scan') {
          const landscape = await Promise.all((data as CatalogItem[]).map(async item =>
            item.category === 'games' && item.poster_url && await isLandscapePoster(item.poster_url) ? item.id : null))
          if (!authorized()) return
          const candidateIds = [...new Set([...(job.candidateIds ?? []), ...landscape.filter((id): id is string => Boolean(id))])]
          const completed = job.completed + ids.length
          if (completed >= job.total) {
            job = { ...job, ids: candidateIds, candidateIds: undefined, phase: 'search', completed: 0, total: candidateIds.length, label: `Recherche des jaquettes à remplacer · ${candidateIds.length} fiche(s)` }
          } else {
            job = { ...job, candidateIds, completed }
          }
          savePosterJob(job); publish(job)
          continue
        }
        const outcomes = await Promise.all((data as CatalogItem[]).map(async item => {
          try {
            if (job.kind === 'translate') {
              if (!item.synopsis?.trim()) return { id: item.id, updated: 0, stored: 0, missing: 0 }
              const translated = await translateSynopsisToFrench(item.synopsis)
              if (!translated || translated === item.synopsis.trim()) return { id: item.id, updated: 0, stored: 0, missing: 0 }
              if (!authorized()) throw new Error('Session interrompue')
              const saved = await supabase!.from('catalog_items').update({ synopsis: translated }).eq('id', item.id).eq('synopsis', item.synopsis).select('id').maybeSingle()
              if (saved.error) throw saved.error
              if (!saved.data) throw new Error('La traduction a été faite, mais la fiche a changé entre-temps. Relancez la traduction.')
              return { id: item.id, updated: 1, stored: 0, missing: 0 }
            }
            if (job.kind === 'cache') {
              if (isCachedPosterUrl(item.poster_url)) return { id: item.id, updated: 0, stored: 0, missing: 0 }
              const poster = await cachePosterUrl(item.poster_url)
              if (!poster || !isCachedPosterUrl(poster)) return { id: item.id, updated: 0, stored: 0, missing: 1 }
              if (!authorized()) throw new Error('Session interrompue')
              const result = await supabase!.from('catalog_items').update({ poster_url: poster }).eq('id', item.id).select('id').maybeSingle()
              if (result.error) throw result.error
              if (!result.data) return { id: item.id, updated: 0, stored: 0, missing: 1 }
              return { id: item.id, updated: 1, stored: 1, missing: 0 }
            }
            if (job.kind === 'complete') {
              // Toutes les sources sont consultées ; seuls les champs encore vides sont écrits.
              const found = await completeMetadata(item)
              if (!found) return { id: item.id, updated: 0, stored: 0, missing: 1 }
              if (!authorized()) throw new Error('Session interrompue')
              const patch: Record<string, unknown> = {}
              const poster = found.poster_url ? safeUrl(found.poster_url) : undefined
              if (poster && !item.poster_url) patch.poster_url = poster
              if (found.genres?.length && !item.genres.length) patch.genres = found.genres
              if (found.year && !item.year) patch.year = found.year
              if (found.synopsis && !item.synopsis?.trim()) patch.synopsis = found.synopsis
              if (found.source) { patch.source = found.source; patch.source_id = found.source_id ?? null; patch.source_url = safeUrl(found.source_url ?? null) ?? null }
              if (!Object.keys(patch).length) return { id: item.id, updated: 0, stored: 0, missing: 1 }
              const saved = await supabase!.from('catalog_items').update(patch).eq('id', item.id).select('id').maybeSingle()
              if (saved.error) throw saved.error
              if (!saved.data) throw new Error('La fiche trouvée n’a pas été enregistrée. Vérifiez les droits de modification dans Supabase.')
              const [cachedPoster, translated] = await Promise.allSettled([
                poster && patch.poster_url ? cachePosterUrl(poster) : Promise.resolve(null),
                patch.synopsis && !found.synopsisInFrench ? translateSynopsisToFrench(found.synopsis!) : Promise.resolve(null),
              ])
              const followUp: Record<string, unknown> = {}
              if (cachedPoster.status === 'fulfilled' && cachedPoster.value && isCachedPosterUrl(cachedPoster.value) && cachedPoster.value !== poster) followUp.poster_url = cachedPoster.value
              if (translated.status === 'fulfilled' && translated.value && translated.value !== found.synopsis) followUp.synopsis = translated.value
              if (Object.keys(followUp).length && authorized()) await supabase!.from('catalog_items').update(followUp).eq('id', item.id)
              const stillMissing = (!item.poster_url && !patch.poster_url) || (!item.synopsis?.trim() && !patch.synopsis)
              return { id: item.id, updated: 1, stored: Number(Boolean(followUp.poster_url)), missing: Number(stillMissing) }
            }
            if (job.kind === 'repair-games') {
              if (item.category !== 'games' || !item.poster_url || !(await isLandscapePoster(item.poster_url))) return { id: item.id, updated: 0, stored: 0, missing: 0 }
            }
            // Reload the current row before resuming: completed writes are never overwritten.
            // Ordinary enrichment only searches records without an image; the repair job is
            // limited to game images already measured as landscape.
            if (item.poster_url && job.kind !== 'repair-games') return { id: item.id, updated: 0, stored: 0, missing: 0 }
            const matches = await searchMetadata(item.title, item.category, item.media_type, item.media_format, item.year)
            const match = item.category === 'anime' ? selectAnimePoster(item, matches) : uniqueExactMatch(matches)
            if (!match || (job.kind === 'repair-games' || item.category === 'anime' ? !match.poster_url : (!match.poster_url && !match.genres.length))) return { id: item.id, updated: 0, stored: 0, missing: 1 }
            if (!authorized()) throw new Error('Session interrompue')
            // Save the match first. If translation or image caching later fails,
            // the next scan sees this poster/genre data and does not search again.
            const poster = job.kind === 'repair-games' ? safeUrl(match.poster_url) ?? null : item.poster_url ?? safeUrl(match.poster_url) ?? null
            if (job.kind === 'repair-games' && (!poster || poster === item.poster_url)) return { id: item.id, updated: 0, stored: 0, missing: 1 }
            // Only replace a game image with a readable portrait cover. Steam
            // headers and RAWG screenshots are landscapes and make the cards
            // look cropped even when the source match is correct.
            if (job.kind === 'repair-games' && await isLandscapePoster(poster, 0.82)) return { id: item.id, updated: 0, stored: 0, missing: 1 }
            const result = await supabase!.from('catalog_items').update({ poster_url: poster,
              genres: item.genres.length ? item.genres : match.genres, year: item.year ?? match.year,
              seasons_count: item.seasons_count ?? match.seasons_count,
              source: job.kind === 'repair-games' || ['scan', 'manual'].includes(item.source) ? match.source : item.source,
              source_id: job.kind === 'repair-games' ? match.source_id : item.source_id ?? match.source_id,
              source_url: job.kind === 'repair-games' ? safeUrl(match.source_url) : item.source_url ?? safeUrl(match.source_url),
            }).eq('id', item.id).select('id').maybeSingle()
            if (result.error) throw result.error
            if (!result.data) throw new Error('La fiche trouvée n’a pas été enregistrée. Vérifiez les droits de modification dans Supabase.')
            // These independent network steps overlap after the durable match write.
            const [cachedPoster, synopsis] = await Promise.allSettled([
              item.poster_url ? Promise.resolve(item.poster_url) : cachePosterUrl(poster),
              translateSynopsisToFrench(item.synopsis ?? match.synopsis),
            ])
            const followUp: Record<string, unknown> = {}
            if (cachedPoster.status === 'fulfilled' && cachedPoster.value && isCachedPosterUrl(cachedPoster.value) && cachedPoster.value !== poster) followUp.poster_url = cachedPoster.value
            if (synopsis.status === 'fulfilled' && synopsis.value) followUp.synopsis = synopsis.value
            if (Object.keys(followUp).length && authorized()) {
              const completed = await supabase!.from('catalog_items').update(followUp).eq('id', item.id).select('id').maybeSingle()
              // The cover was already saved. A failed synopsis/cache follow-up
              // must not cause this title to be searched again on resume.
              if (completed.error || !completed.data) delete followUp.poster_url
            }
            return { id: item.id, updated: 1, stored: Number(Boolean(followUp.poster_url) || job.kind === 'repair-games'), missing: 0 }
          } catch (error) { return { id: item.id, updated: 0, stored: 0, missing: 0, retry: error instanceof Error ? error.message : 'La recherche a échoué.' } }
        }))
        if (!authorized()) return // Retry this small batch after login; successful writes are idempotent.
        const retryIds = outcomes.filter(result => 'retry' in result && result.retry).map(result => result.id)
        job = { ...job, completed: job.completed + ids.length,
          updated: job.updated + outcomes.reduce((n, result) => n + result.updated, 0),
          stored: job.stored + outcomes.reduce((n, result) => n + result.stored, 0),
          missing: job.missing + outcomes.filter(result => !('retry' in result && result.retry)).reduce((n, result) => n + result.missing, 0),
          retryIds: [...new Set([...(job.retryIds ?? []), ...retryIds])],
        }
        savePosterJob(job); publish(job)
      }
      // Retry transient failures in their own small pass so one unavailable
      // provider cannot discard the rest of a long-running catalog job.
      if (job.completed >= job.total && authorized() && (job.retryIds?.length ?? 0) > 0) {
        const attempts = job.retryAttempts ?? 0
        if (attempts < 2) {
          job = { ...job, ids: job.retryIds!, retryIds: [], completed: 0, total: job.retryIds!.length,
            retryAttempts: attempts + 1, label: `Nouvelle tentative · ${job.retryIds!.length} fiche(s)`, error: undefined }
          savePosterJob(job); publish(job)
          await new Promise(resolve => setTimeout(resolve, 1800))
          continue
        }
        job = { ...job, missing: job.missing + job.retryIds!.length }
        savePosterJob(job); publish(job)
      }
       break
      }
      if (job.completed === job.total) {
        job = { ...job, result: job.kind === 'translate'
          ? `${job.updated} description(s) traduite(s) en français.${job.missing ? ` ${job.missing} échec(s) à relancer.` : ''}`
          : `${job.updated} fiche(s) enrichie(s), ${job.stored} affiche(s) conservée(s).${job.missing ? ` ${job.missing} fiche(s) restent à compléter (aucune source fiable).` : ''}` }
        savePosterJob(job); publish(job)
      }
    } catch (error) {
      job = { ...job, error: error instanceof Error ? error.message : 'Traitement interrompu. Vous pouvez reprendre.' }
      try { savePosterJob(job) } catch { /* The previous checkpoint remains usable. */ }
      publish(job)
    }
  }
  // One writer across tabs. Closing/reloading the tab automatically releases its lock.
  if (navigator.locks) await navigator.locks.request(`mylist-posters:${initial.userId}`, work)
  else await work()
}
