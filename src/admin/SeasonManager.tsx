import { useEffect, useState } from 'react'
import { LoaderCircle, Plus, Settings } from 'lucide-react'
import { availableSeasonNumbers, displaySeasons } from '../seasonSelection'
import { loadSeasons } from '../catalogSeasons'
import { Cover } from '../media'
import type { CatalogItem, CatalogSeason } from '../types'
import { SeasonEditor } from './SeasonEditor'

export function SeasonManager({ item, disabled, onSaved, onSaving }: { item: CatalogItem; disabled: boolean; onSaved: (item: CatalogItem) => void; onSaving: (busy: boolean) => void }) {
  const [rows, setRows] = useState<CatalogSeason[]>([])
  const [editing, setEditing] = useState<CatalogSeason | null>(null)
  const [number, setNumber] = useState('')
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [success, setSuccess] = useState('')
  const [limit, setLimit] = useState(24)
  const [failed, setFailed] = useState(false), [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setFailed(false)
    void loadSeasons(item, controller.signal).then(value => { if (!controller.signal.aborted) setRows(value) })
      .catch(() => { if (!controller.signal.aborted) { setFailed(true); setError('La liste des saisons n’a pas pu être chargée. Réessayez avant d’enregistrer une saison.') } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [item.id, item.updated_at, revision])
  const available = availableSeasonNumbers(item)
  function add() {
    const next = number.trim() ? Number(number) : Math.max(0, ...available) + 1
    if (!Number.isInteger(next) || next < 1 || next > 999) { setError('Choisissez un numéro de saison entre 1 et 999.'); return }
    setError(''); setSuccess('')
    const existing = rows.find(row => row.number === next)
    setEditing(existing ?? displaySeasons({ ...item, available_seasons: [next] }, [])[0])
  }
  return <section className="season-manager" aria-labelledby="manage-seasons-title"><div className="season-picker-head"><h3 id="manage-seasons-title">Saisons de cette fiche</h3><span>{available.length} disponibles</span></div>
    <p>Ajoutez une saison avec son nom, prérempli « Saison N ». Sa description et son affiche sont facultatives : sans affiche propre, celle de la fiche principale sera conservée. Chaque saison s’enregistre séparément.</p>
    <div className="season-manager-add"><label>Numéro de la saison<input type="number" min={1} max={999} value={number} placeholder={String(Math.max(0, ...available) + 1)} onChange={event => setNumber(event.target.value)} /></label><button type="button" className="button-primary" onClick={add} disabled={disabled || loading || failed}><Plus size={16} /> Ajouter une saison</button></div>
    {loading && <p role="status"><LoaderCircle className="spin" size={14} /> Chargement des saisons…</p>}
    {error && <p className="notice" role="alert">{error}</p>}{failed && <button type="button" className="button-ghost" onClick={() => setRevision(value => value + 1)}>Recharger les saisons</button>}{success && <p className="notice" role="status">{success}</p>}
    <div className="season-manager-list">{rows.slice(0, limit).map(row => <button className="season-manager-row" type="button" key={row.number} disabled={disabled || loading} onClick={() => { setEditing(row); setSuccess('') }}><Cover item={{ ...item, poster_url: row.poster_url || item.poster_url, title: row.title || `Saison ${row.number}` }} sizes="50px" /><span><strong>Saison {row.number}{row.title ? ` · ${row.title}` : ''}</strong><small>{row.year ?? 'Année à compléter'} · {row.poster_url ? 'Affiche propre' : 'Affiche de la série'}{row.synopsis ? ' · Description renseignée' : ''}</small></span><Settings size={16} /><span>Modifier</span></button>)}</div>
    {rows.length > limit && <button type="button" className="button-ghost" onClick={() => setLimit(value => value + 24)}>Afficher les saisons suivantes</button>}
    {editing && <SeasonEditor key={`${item.id}:${editing.number}`} parentTitle={item.title} season={editing} onBusy={onSaving} onClose={() => setEditing(null)} onSaved={(row, parent) => { setRows(current => [...current.filter(old => old.number !== row.number), row].sort((a, b) => a.number - b.number)); setEditing(null); setNumber(''); setSuccess(`Saison ${row.number} enregistrée et disponible dans le catalogue.`); onSaved(parent) }} />}
  </section>
}
