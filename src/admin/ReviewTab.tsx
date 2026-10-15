import { useEffect, useMemo, useState } from 'react'
import { Check, ExternalLink, LoaderCircle, Search, Sparkles, X } from 'lucide-react'
import { Cover, safeUrl } from '../media'
import { kindLabel, measureLabel, plural } from '../display'
import { completionFrom, findCandidates } from '../metadata'
import type { Candidate } from '../metadataMatch'
import { applyCompletion } from '../applyCompletion'
import { dismissReview, readReviews, removeReview, REVIEW_EVENT, REVIEW_KEY, saveReview, type ReviewEntry } from '../reviewStore'
import { titleKey, type CatalogItem, type Category } from '../types'
import type { PosterJobKind } from '../App'

const RENAME_KEY = 'mylist-review-rename'
const sourceNames: Record<string, string> = { anilist: 'AniList', 'jikan-anime': 'MyAnimeList', kitsu: 'Kitsu', tvmaze: 'TVMaze', tvdb: 'TheTVDB', igdb: 'IGDB', rawg: 'RAWG', steam: 'Steam', wikipedia: 'Wikipédia' }

interface Props {
  items: CatalogItem[]
  posterJobRunning: boolean
  onChanged: () => Promise<void>
  onMessage: (text: string, success?: boolean) => void
  onEdit: (item: CatalogItem) => void
  onRunPosterJob: (kind: PosterJobKind, filter: Category | 'all', ids?: string[]) => Promise<void>
}

export function useReviewCount(items: CatalogItem[]) {
  const [entries, setEntries] = useState(readReviews)
  useEffect(() => {
    const refresh = () => setEntries(readReviews())
    const storage = (event: StorageEvent) => { if (event.key === REVIEW_KEY) refresh() }
    window.addEventListener(REVIEW_EVENT, refresh)
    window.addEventListener('storage', storage)
    return () => { window.removeEventListener(REVIEW_EVENT, refresh); window.removeEventListener('storage', storage) }
  }, [])
  const ids = new Set(items.map((item) => item.id))
  return { entries, count: Object.values(entries).filter((entry) => !entry.dismissed && entry.candidates.length && ids.has(entry.itemId)).length }
}

export function ReviewTab({ items, posterJobRunning, onChanged, onMessage, onEdit, onRunPosterJob }: Props) {
  const { entries } = useReviewCount(items)
  const [rename, setRename] = useState(() => { try { return localStorage.getItem(RENAME_KEY) === '1' } catch { return false } })
  const [busy, setBusy] = useState<string | null>(null)
  const [queries, setQueries] = useState<Record<string, string>>({})
  const [shown, setShown] = useState(25)
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const pending = useMemo(() => Object.values(entries)
    .filter((entry) => !entry.dismissed && entry.candidates.length && byId.has(entry.itemId))
    .sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' })), [entries, byId])
  const dismissed = Object.values(entries).filter((entry) => entry.dismissed && byId.has(entry.itemId))
  const incomplete = items.filter((item) => item.active && (!item.poster_url || !item.synopsis?.trim() || !item.genres.length || !item.year) && !entries[item.id])

  useEffect(() => { try { localStorage.setItem(RENAME_KEY, rename ? '1' : '0') } catch { /* Préférence locale facultative. */ } }, [rename])

  async function choose(entry: ReviewEntry, candidate: Candidate) {
    const item = byId.get(entry.itemId)
    if (!item) return
    setBusy(item.id)
    try {
      const extra: Record<string, unknown> = {}
      const format = item.category === 'anime' && candidate.format && candidate.format !== (item.media_format === 'film' ? 'film' : 'series') ? candidate.format : null
      const title = rename && candidate.title.trim() ? candidate.title.trim() : item.title
      if (format) { extra.media_format = format; if (format === 'film') extra.seasons_count = null; else if (!item.seasons_count) extra.seasons_count = 1 }
      if (title !== item.title || format) {
        extra.title = title
        extra.title_key = titleKey(item.category, item.media_type, title, item.category === 'anime' ? (format ?? item.media_format ?? null) : null)
      }
      const completion = await completionFrom(item, candidate)
      await applyCompletion(item, completion, () => true, extra)
      removeReview(item.id)
      await onChanged()
      onMessage(`« ${title} » complétée depuis ${candidate.sources.map((source) => sourceNames[source] ?? source).join(', ')}.${format ? ` Format corrigé : ${format === 'film' ? 'film' : 'série'}.` : ''}`, true)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Enregistrement impossible.')
    } finally { setBusy(null) }
  }

  async function searchAgain(entry: ReviewEntry) {
    const item = byId.get(entry.itemId)
    const query = (queries[entry.itemId] ?? '').trim()
    if (!item || query.length < 2) return
    setBusy(item.id)
    try {
      const found = await findCandidates(item, query)
      if (!found.length) { onMessage(`Aucune œuvre trouvée pour « ${query} ». Essayez le titre original ou anglais.`); return }
      // Les nouveaux résultats passent devant, sans faire disparaître les propositions précédentes.
      const candidates = [...found, ...entry.candidates.filter((previous) => !found.some((candidate) => candidate.key === previous.key || (candidate.title === previous.title && candidate.year === previous.year)))].slice(0, 6)
      saveReview(item.id, item.title, candidates, query)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Recherche impossible.')
    } finally { setBusy(null) }
  }

  // Raccourcis sur la première fiche de la file : 1 à 5 pour choisir, 0 pour « aucune ».
  const first = pending[0]
  useEffect(() => {
    if (!first) return
    const onKey = (event: KeyboardEvent) => {
      if (busy || (event.target as HTMLElement)?.closest('input, textarea, select, dialog')) return
      const index = Number(event.key)
      if (event.key === '0') { dismissReview(first.itemId, first.title); return }
      if (index >= 1 && index <= first.candidates.length) void choose(first, first.candidates[index - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [first, busy, rename])

  return <section className="admin-panel">
    <div className="admin-panel-head">
      <div><h2>À arbitrer</h2><p>{pending.length ? `${plural(pending.length, 'fiche')} : la recherche a trouvé des œuvres proches mais n’a pas osé choisir (titre approximatif, plusieurs versions, film ou série). Choisissez la bonne, rien n’est écrasé : seuls les champs vides sont remplis.` : 'Aucune fiche en attente. Lancez « Compléter les fiches » : celles dont le résultat est incertain arriveront ici.'}</p></div>
      <button type="button" className="button-primary" disabled={posterJobRunning || !incomplete.length} onClick={() => void onRunPosterJob('complete', 'all', incomplete.map((item) => item.id))}><Sparkles size={16} /> {posterJobRunning ? 'Recherche en cours…' : `Rechercher ${plural(incomplete.length, 'fiche incomplète', 'fiches incomplètes')}`}</button>
    </div>
    <div className="review-options">
      <label className="checkbox-label"><input type="checkbox" checked={rename} onChange={(event) => setRename(event.target.checked)} /> Remplacer aussi le titre de la fiche par le titre officiel choisi</label>
      {first && <span className="admin-help">Raccourcis pour la première fiche : <kbd>1</kbd> à <kbd>{first.candidates.length}</kbd> pour choisir, <kbd>0</kbd> si aucune ne convient.</span>}
    </div>
    <div className="review-list">{pending.slice(0, shown).map((entry) => {
      const item = byId.get(entry.itemId)!
      const missing = [!item.poster_url && 'affiche', !item.synopsis?.trim() && 'description', !item.genres.length && 'genres', !item.year && 'année'].filter(Boolean)
      return <article className={`review-row ${busy === item.id ? 'is-busy' : ''}`} key={entry.itemId}>
        <div className="review-item">
          <Cover item={item} sizes="56px" />
          <div><strong>{item.title}</strong><small>{kindLabel(item)} · {measureLabel(item)}{item.year ? ` · ${item.year}` : ''}</small><span className="row-issues">{missing.map((label) => <em key={String(label)}>Sans {label}</em>)}</span>{entry.query && <small>Recherche : « {entry.query} »</small>}</div>
        </div>
        <div className="review-candidates">{entry.candidates.map((candidate, index) => <button type="button" key={candidate.key} className="review-candidate" disabled={Boolean(busy)} onClick={() => void choose(entry, candidate)} title={candidate.synopsis ?? undefined}>
          <span className="review-key">{index + 1}</span>
          <Cover item={{ title: candidate.title, poster_url: candidate.poster_url, category: candidate.category }} sizes="90px" />
          <span className="review-title">{candidate.title}</span>
          <span className="review-meta">{candidate.year ?? 'année ?'} · {candidate.format === 'film' ? 'Film' : candidate.format === 'series' ? 'Série' : '—'} · {candidate.sources.map((source) => sourceNames[source] ?? source).join(', ')}</span>
          <span className={`review-score ${candidate.score >= 0.85 ? 'is-high' : candidate.score >= 0.7 ? 'is-mid' : ''}`}>{Math.round(candidate.score * 100)} % de ressemblance</span>
          {candidate.notes.map((note) => <span className="review-note" key={note}>{note}</span>)}
          {candidate.synopsis && <span className="review-synopsis">{candidate.synopsis.slice(0, 140)}{candidate.synopsis.length > 140 ? '…' : ''}</span>}
        </button>)}</div>
        <div className="review-actions">
          <form onSubmit={(event) => { event.preventDefault(); void searchAgain(entry) }} className="search-field"><Search size={15} aria-hidden="true" /><span className="visually-hidden">Autre titre pour {item.title}</span><input value={queries[entry.itemId] ?? ''} onChange={(event) => setQueries((current) => ({ ...current, [entry.itemId]: event.target.value }))} placeholder="Chercher avec un autre titre…" /><button type="submit" className="field-clear" disabled={Boolean(busy)} aria-label="Lancer la recherche">{busy === item.id ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}</button></form>
          <div className="admin-row-actions">
            <button type="button" disabled={Boolean(busy)} onClick={() => dismissReview(entry.itemId, entry.title)}><X size={15} /> Aucune ne convient</button>
            <button type="button" onClick={() => onEdit(item)}>Modifier la fiche</button>
            {entry.candidates[0] && safeUrl(entry.candidates[0].source_url) && <a href={safeUrl(entry.candidates[0].source_url)} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Voir la source</a>}
          </div>
        </div>
      </article>
    })}</div>
    {pending.length > shown && <button type="button" className="button-ghost" onClick={() => setShown((value) => value + 25)}>Afficher plus ({pending.length - shown} restantes)</button>}
    {dismissed.length > 0 && <p className="admin-help">{plural(dismissed.length, 'fiche')} marquée{dismissed.length > 1 ? 's' : ''} « aucune ne convient » : la recherche automatique les ignore. Complétez-les depuis « Modifier la fiche », ou <button type="button" className="text-button" onClick={() => dismissed.forEach((entry) => removeReview(entry.itemId))}>remettez-les dans la recherche</button>.</p>}
  </section>
}
