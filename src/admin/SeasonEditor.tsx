import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { forgetSeasons } from '../catalogSeasons'
import type { CatalogItem, CatalogSeason } from '../types'
import { SeasonReferenceImport, type SeasonReference } from '../site/SeasonReferenceImport'
import { saveSeason } from './saveSeason'

export function SeasonEditor({ parentTitle, season, onClose, onSaved, onBusy }: { parentTitle: string; season: CatalogSeason; onClose: () => void; onSaved: (row: CatalogSeason, parent: CatalogItem) => void; onBusy?: (busy: boolean) => void }) {
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => { form.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }) }, [])
  const [title, setTitle] = useState(season.title || `Saison ${season.number}`)
  const [poster, setPoster] = useState(season.poster_url ?? '')
  const [synopsis, setSynopsis] = useState(season.synopsis ?? '')
  const [year, setYear] = useState(season.year?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false) }, [busy, onBusy])
  const [error, setError] = useState('')
  const [reference, setReference] = useState<SeasonReference | null>(null)
  function applyReference(value: SeasonReference) {
    setReference(value)
    if (value.title) setTitle(value.title)
    if (value.poster_url) setPoster(value.poster_url)
    if (value.synopsis) setSynopsis(value.synopsis)
    if (value.year) setYear(String(value.year))
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!supabase || busy) return
    setBusy(true); setError('')
    try {
      const result = await saveSeason(supabase, { ...season, ...(reference ? { source: reference.source, source_url: reference.source_url, source_id: null } : {}), title: title.trim() || `Saison ${season.number}`, synopsis: synopsis.trim() || null, poster_url: poster.trim() || null, year: year ? Number(year) : null })
      forgetSeasons(season.item_id)
      onSaved(result.season, result.item)
      // Save the editable season first; image caching must never block that save.
      if (result.season.poster_url) void import('../metadata').then(async ({ cachePosterUrl, isCachedPosterUrl }) => {
        const original = result.season.poster_url
        const cached = await cachePosterUrl(original)
        if (!cached || cached === original || !isCachedPosterUrl(cached)) return
        await supabase!.from('catalog_seasons').update({ poster_url: cached }).eq('item_id', result.season.item_id).eq('number', result.season.number).eq('updated_at', result.season.updated_at!).eq('poster_url', original!)
        forgetSeasons(result.season.item_id)
      }).catch(() => {})
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Enregistrement impossible.') }
    finally { setBusy(false) }
  }
  return <form ref={form} className="season-editor" onSubmit={save}><fieldset className="season-editor-fields" disabled={busy}><h4>{season.updated_at ? 'Modifier' : 'Ajouter'} la saison {season.number}</h4><label>Nom de la saison<input maxLength={300} value={title} onChange={event => setTitle(event.target.value)} placeholder={`Saison ${season.number}`} /></label><label>Description de cette saison (facultatif)<textarea rows={4} maxLength={15000} value={synopsis} onChange={event => setSynopsis(event.target.value)} placeholder="À renseigner uniquement si cette saison a sa propre description" /></label><label>Affiche propre à cette saison (facultatif, HTTPS)<input type="url" pattern="https://.*" value={poster} onChange={event => setPoster(event.target.value)} /><small>Laissez ce champ vide pour conserver l’affiche de la fiche principale.</small></label><label>Année (facultatif)<input type="number" min={1850} max={2200} value={year} onChange={event => setYear(event.target.value)} /></label><details><summary>Chercher les informations sur Allociné ou Nautiljon</summary><SeasonReferenceImport title={parentTitle} number={season.number} disabled={busy} onApply={applyReference} /></details>{error && <p role="alert">{error}</p>}<div className="season-tools"><button type="submit" className="button-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer cette saison'}</button><button type="button" className="button-ghost" onClick={onClose} disabled={busy}>Annuler</button></div></fieldset></form>
}
