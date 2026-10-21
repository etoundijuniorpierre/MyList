import { useEffect, useRef, useState } from 'react'
import { normalizeTitle } from '../types'
import { safeUrl } from '../urls'

export interface SeasonReference { title: string; synopsis: string | null; poster_url: string | null; number: number | null; year: number | null; source: string; source_url: string }
export function SeasonReferenceImport({ title, number, disabled, onApply }: { title: string; number: number; disabled: boolean; onApply: (value: SeasonReference) => void }) {
  const [url, setUrl] = useState(''), [preview, setPreview] = useState<SeasonReference | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmed, setConfirmed] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => { controller.current?.abort(); controller.current = null }, [])
  async function read() {
    controller.current?.abort(); const active = new AbortController(); controller.current = active
    const timer = window.setTimeout(() => active.abort(), 10000)
    setBusy(true); setError(''); setPreview(null); setConfirmed(false)
    try {
      const response = await fetch(`/api/season-reference?${new URLSearchParams({ url: url.trim() })}`, { signal: active.signal })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Cette fiche n’a pas pu être lue.')
      if (controller.current === active) setPreview(result as SeasonReference)
    } catch (failure) { if (controller.current === active) setError(active.signal.aborted ? 'La lecture prend trop de temps. Ouvrez la source pour compléter la saison manuellement.' : failure instanceof Error ? failure.message : 'Lecture impossible.') }
    finally { window.clearTimeout(timer); if (controller.current === active) setBusy(false) }
  }
  const mismatch = preview?.number != null && preview.number !== number
  const uncertain = preview && (!preview.number || !normalizeTitle(preview.title).includes(normalizeTitle(title)))
  const search = `${title} saison ${number}`
  return <div className="season-reference"><h4>Compléter depuis une source française</h4>
    <div className="season-tools"><a href={`https://www.google.com/search?${new URLSearchParams({ q: `site:allocine.fr/series/ ${search}` })}`} target="_blank" rel="noopener noreferrer">Chercher sur Allociné ↗</a><a href={`https://www.nautiljon.com/search.php?${new URLSearchParams({ q: title })}`} target="_blank" rel="noopener noreferrer">Chercher sur Nautiljon ↗</a></div>
    <label>Lien de la fiche Allociné ou Nautiljon<input type="url" value={url} maxLength={600} placeholder="https://…" disabled={disabled || busy} onChange={event => { controller.current?.abort(); controller.current = null; setBusy(false); setUrl(event.target.value); setPreview(null); setError(''); setConfirmed(false) }} /></label>
    <button type="button" className="button-ghost" disabled={disabled || busy || !url.trim()} onClick={() => void read()}>{busy ? 'Lecture de la fiche…' : 'Lire ce lien'}</button>
    {error && <p className="notice" role="status">{error}</p>}
    {preview && <div className="season-reference-preview"><strong>{preview.title}</strong>{preview.poster_url && <img src={safeUrl(preview.poster_url)} alt="Affiche proposée par la source" loading="lazy" />}<p>{preview.synopsis || 'Aucune description exploitable sur cette fiche.'}</p>
      {mismatch ? <p className="notice">Cette fiche indique la saison {preview.number}, alors que vous modifiez la saison {number}. Elle ne sera pas appliquée.</p> : <>
        {uncertain && <label className="season-reference-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Je confirme que cette fiche correspond à la bonne œuvre et à la saison {number}.</label>}
        <button type="button" className="button-secondary" disabled={disabled || !!uncertain && !confirmed} onClick={() => onApply(preview)}>Utiliser cette proposition pour la saison {number}</button></>}
      <a href={safeUrl(preview.source_url)} target="_blank" rel="noopener noreferrer">Vérifier la fiche source ↗</a><small>Les champs restent modifiables. Enregistrez ensuite cette saison pour conserver votre choix.</small>
    </div>}
  </div>
}
