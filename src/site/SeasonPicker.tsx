import { useEffect, useState, type FormEvent } from 'react'
import { Check, LoaderCircle, Settings } from 'lucide-react'
import { Cover } from '../media'
import { supabase } from '../supabase'
import { forgetSeasons, loadSeasons } from '../catalogSeasons'
import { availableSeasonNumbers, displaySeasons } from '../seasonSelection'
import type { CatalogItem, CatalogSeason } from '../types'
import { useSite } from './context'
import { SeasonReferenceImport, type SeasonReference } from './SeasonReferenceImport'

export default function SeasonPicker({ item }: { item: CatalogItem }) {
  const { selection, seasonChoices, setSeasons, isAdmin, notify } = useSite()
  const [rows, setRows] = useState(() => displaySeasons(item, []))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<CatalogSeason | null>(null)
  const [limit, setLimit] = useState(24)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setEditing(null); setLimit(24)
    setRows(displaySeasons(item, []))
    void loadSeasons(item, controller.signal).then(result => { if (!controller.signal.aborted) setRows(result) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [item.id, item.seasons_count, item.available_seasons, item.season_details_checked_at])
  const available = availableSeasonNumbers(item)
  const inCart = selection.includes(item.id)
  const chosen = inCart ? seasonChoices[item.id] ?? available : []
  if (!available.length) return <p className="notice">Le nombre de saisons disponibles reste à confirmer.</p>
  return <section className="season-picker" aria-labelledby="seasons-title">
    <div className="season-picker-head"><h3 id="seasons-title">Choisir les saisons</h3><span>{chosen.length} / {available.length} choisies</span></div>
    <p>Choisissez l’intégrale ou cochez uniquement les saisons souhaitées. Le panier calculera leur prix et les remises.</p>
    <div className="season-tools"><button type="button" className="button-ghost" onClick={() => setSeasons(item, null)}><Check size={15} /> Toute la série · {available.length} saisons</button><button type="button" className="text-button" disabled={!chosen.length} onClick={() => setSeasons(item, [])}>Tout retirer</button></div>
    {loading && <p className="season-status" role="status"><LoaderCircle className="spin" size={14} /> Chargement des titres et affiches des saisons…</p>}
    {error && <p className="notice" role="status">{error}</p>}
    {isAdmin && item.season_details_note && <p className="notice">{item.season_details_note}</p>}
    <div className="season-grid">{rows.slice(0, limit).map(row => {
      const checked = chosen.includes(row.number)
      return <div className={`season-card ${checked ? 'is-selected' : ''}`} key={row.number}>
        <label><Cover item={{ ...item, title: row.title || `Saison ${row.number}`, poster_url: row.poster_url || item.poster_url }} sizes="(max-width:680px) 95px, 110px" />
          <input type="checkbox" checked={checked} onChange={() => setSeasons(item, checked ? chosen.filter(number => number !== row.number) : [...chosen, row.number])} />
          <strong>Saison {row.number}</strong>{row.title && <span>{row.title}</span>}{row.year && <small>{row.year}</small>}
          {!row.poster_url && <small>Affiche de la série</small>}
        </label>
        {row.synopsis && <details className="season-description"><summary>Description</summary><p>{row.synopsis}</p></details>}
        {isAdmin && <button type="button" className="text-button" onClick={() => setEditing(row)} aria-label={`Modifier la saison ${row.number}`}><Settings size={13} /> Modifier</button>}
      </div>
    })}</div>
    {rows.length > limit && <button type="button" className="button-ghost" onClick={() => setLimit(value => value + 24)}>Afficher les saisons suivantes ({rows.length - limit})</button>}
    {isAdmin && editing && <SeasonEditor key={editing.number} parentTitle={item.title} season={editing} onClose={() => setEditing(null)} onSaved={row => { forgetSeasons(item.id); setRows(current => current.map(old => old.number === row.number ? row : old)); setEditing(null); notify(`Saison ${row.number} enregistrée. La complétion conservera cette correction.`) }} />}
  </section>
}

function SeasonEditor({ parentTitle, season, onClose, onSaved }: { parentTitle: string; season: CatalogSeason; onClose: () => void; onSaved: (row: CatalogSeason) => void }) {
  const [title, setTitle] = useState(season.title ?? '')
  const [poster, setPoster] = useState(season.poster_url ?? '')
  const [synopsis, setSynopsis] = useState(season.synopsis ?? '')
  const [year, setYear] = useState(season.year?.toString() ?? '')
  const [busy, setBusy] = useState(false)
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
      const { updated_at: _previous, ...values } = season
      const result = await supabase.from('catalog_seasons').upsert({ ...values, ...(reference ? { source: reference.source, source_url: reference.source_url, source_id: null } : {}), title: title.trim() || null, synopsis: synopsis.trim() || null, poster_url: poster.trim() || null, year: year ? Number(year) : null, manual: true, updated_at: new Date().toISOString() }, { onConflict: 'item_id,number' }).select('*').abortSignal(AbortSignal.timeout(10000)).single()
      if (result.error || !result.data) throw new Error('La saison n’a pas pu être enregistrée. Vérifiez votre session administrateur.')
      onSaved(result.data as CatalogSeason)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Enregistrement impossible.') }
    finally { setBusy(false) }
  }
  return <form className="season-editor" onSubmit={save}><h4>Modifier la saison {season.number}</h4><SeasonReferenceImport title={parentTitle} number={season.number} disabled={busy} onApply={applyReference} /><label>Titre propre à la saison<input maxLength={300} value={title} onChange={event => setTitle(event.target.value)} placeholder={`Saison ${season.number}`} /></label><label>Affiche (HTTPS)<input type="url" pattern="https://.*" value={poster} onChange={event => setPoster(event.target.value)} /></label><label>Description de cette saison<textarea rows={4} maxLength={15000} value={synopsis} onChange={event => setSynopsis(event.target.value)} placeholder="Décrivez cette saison…" /></label><label>Année<input type="number" min={1850} max={2200} value={year} onChange={event => setYear(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<div className="season-tools"><button type="submit" className="button-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer cette saison'}</button><button type="button" className="button-ghost" onClick={onClose} disabled={busy}>Annuler</button></div></form>
}
