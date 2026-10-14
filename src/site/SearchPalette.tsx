import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, LoaderCircle, Search, X } from 'lucide-react'
import { supabase } from '../supabase'
import { Cover } from '../media'
import { categoryMeta, kindLabel, measureLabel } from '../display'
import { normalizeTitle, type CatalogItem } from '../types'

const columns = 'id,category,media_type,media_format,title,title_key,synopsis,poster_url,genres,year,source,source_id,source_url,active,seasons_count,game_size_gb'

/** Recherche globale (Ctrl + K) dans les cinq univers, interrogée côté serveur pour ne pas charger tout le catalogue. */
export function SearchPalette({ open, onClose, demo }: { open: boolean; onClose: () => void; demo: CatalogItem[] }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogItem[]>([])
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) { element.showModal(); setTimeout(() => input.current?.focus(), 0) }
    if (!open && element.open) element.close()
  }, [open])
  useEffect(() => {
    const term = query.trim()
    setActive(0)
    if (term.length < 2) { setResults([]); return }
    if (!supabase) { setResults(demo.filter((item) => normalizeTitle(item.title).includes(normalizeTitle(term))).slice(0, 10)); return }
    let cancelled = false
    setBusy(true)
    const timer = window.setTimeout(async () => {
      const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
      const { data } = await supabase!.from('catalog_items').select(columns).eq('active', true).ilike('title', pattern).order('title').limit(14)
      if (!cancelled) { setResults((data ?? []) as CatalogItem[]); setBusy(false) }
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query])
  function go(item: CatalogItem) {
    onClose()
    navigate(`${categoryMeta[item.category].route}?titre=${encodeURIComponent(item.id)}`)
  }
  return <dialog className="search-palette" ref={dialog} aria-label="Rechercher un titre" onClose={() => { onClose(); setQuery('') }} onClick={(event) => { if (event.target === dialog.current) onClose() }}>
    <div className="palette-box">
      <label className="palette-field"><Search size={20} aria-hidden="true" /><span className="visually-hidden">Titre recherché</span>
        <input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Une série, un jeu, un animé…" role="combobox" aria-expanded={results.length > 0} aria-controls="palette-results" aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => Math.min(results.length - 1, value + 1)) }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(0, value - 1)) }
            if (event.key === 'Enter' && results[active]) { event.preventDefault(); go(results[active]) }
          }} />
        {busy ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <button type="button" className="field-clear" onClick={onClose} aria-label="Fermer la recherche"><X size={18} /></button>}
      </label>
      <ul id="palette-results" role="listbox" className="palette-results">
        {results.map((item, index) => <li key={item.id} id={`palette-${item.id}`} role="option" aria-selected={index === active} className={index === active ? 'is-active' : ''} onMouseEnter={() => setActive(index)} onClick={() => go(item)}>
          <Cover item={item} sizes="48px" />
          <span><strong>{item.title}</strong><small>{kindLabel(item)} · {item.year ?? '—'} · {measureLabel(item)}</small></span>
          {index === active && <CornerDownLeft size={16} aria-hidden="true" />}
        </li>)}
      </ul>
      {query.trim().length >= 2 && !busy && !results.length && <p className="palette-empty">Aucun titre ne correspond à « {query.trim()} ».</p>}
      {query.trim().length < 2 && <p className="palette-empty">Tapez au moins deux lettres. <kbd>↑</kbd> <kbd>↓</kbd> pour choisir, <kbd>Entrée</kbd> pour ouvrir.</p>}
    </div>
  </dialog>
}
