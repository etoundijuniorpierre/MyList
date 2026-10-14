import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Heart, Settings, X } from 'lucide-react'
import { Cover, formatPrice, safeUrl, sourceLabel } from '../media'
import { itemPrice } from '../pricing'
import { categoryMeta, kindLabel, measureLabel } from '../display'
import type { CatalogItem } from '../types'
import { useSite } from './context'

interface Props {
  item: CatalogItem | null
  list: CatalogItem[]
  onNavigate: (item: CatalogItem) => void
  onClose: () => void
  onEdit?: (item: CatalogItem) => void
}

export function DetailDialog({ item, list, onNavigate, onClose, onEdit }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { selection, toggle, prices, gameTiers, gameDiscount } = useSite()
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (item && !element.open) element.showModal()
    if (!item && element.open) element.close()
  }, [item])
  const index = item ? list.findIndex((entry) => entry.id === item.id) : -1
  const previous = index > 0 ? list[index - 1] : null
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null
  useEffect(() => {
    if (!item) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, textarea, select')) return
      if (event.key === 'ArrowLeft' && previous) onNavigate(previous)
      if (event.key === 'ArrowRight' && next) onNavigate(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, previous, next, onNavigate])
  const similar = useMemo(() => {
    if (!item) return []
    const genres = new Set(item.genres)
    return list.filter((entry) => entry.id !== item.id && entry.poster_url)
      .map((entry) => ({ entry, score: entry.genres.filter((genre) => genres.has(genre)).length + (item.year && entry.year && Math.abs(item.year - entry.year) <= 2 ? 0.5 : 0) }))
      .filter(({ score }) => score >= 1).sort((a, b) => b.score - a.score).slice(0, 6).map(({ entry }) => entry)
  }, [item, list])
  const selected = item ? selection.includes(item.id) : false
  const price = item ? itemPrice(item, [item], prices, gameTiers, gameDiscount) : null
  const backdrop = item ? safeUrl(item.poster_url) : undefined
  const meta = item ? categoryMeta[item.category] : null
  return <dialog className="detail-dialog" ref={dialog} aria-labelledby="detail-title" onClose={onClose} onClick={(event) => { if (event.target === dialog.current) onClose() }}>
    {item && meta && <div className="detail-content" style={{ '--accent': meta.accent } as CSSProperties}>
      {backdrop && <div className="detail-backdrop" style={{ backgroundImage: `url("${backdrop.replace(/"/g, '%22')}")` }} aria-hidden="true" />}
      <button type="button" className="detail-close" onClick={onClose} aria-label="Fermer la fiche"><X size={20} /></button>
      <div className="detail-poster"><Cover item={item} priority sizes="(max-width: 700px) 60vw, 320px" /></div>
      <div className="detail-copy">
        <span className="eyebrow">{kindLabel(item)}</span>
        <h2 id="detail-title">{item.title}</h2>
        <div className="chips"><span className="chip">{item.year ?? 'Année inconnue'}</span><span className="chip">{measureLabel(item)}</span>{item.genres.slice(0, 4).map((genre) => <span className="chip chip-ghost" key={genre}>{genre}</span>)}</div>
        <p className="detail-synopsis">{item.synopsis || 'La description de ce titre arrive bientôt.'}</p>
        <div className="detail-price"><span>Prix indicatif</span><strong>{price ? formatPrice(price.amount, price.currency) : 'Sur demande'}</strong>{price && <small>{price.detail} · les remises de volume s’appliquent dans le panier</small>}</div>
        <div className="detail-actions">
          <button type="button" className={`button-primary ${selected ? 'is-on' : ''}`} onClick={() => toggle(item)}><Heart size={17} fill={selected ? 'currentColor' : 'none'} /> {selected ? 'Retirer du panier' : 'Ajouter au panier'}</button>
          {onEdit && <button type="button" className="button-ghost" onClick={() => onEdit(item)}><Settings size={16} /> Modifier</button>}
          {safeUrl(item.source_url) && item.source !== 'manual' && item.source !== 'scan' && <a className="detail-source" href={safeUrl(item.source_url)} target="_blank" rel="noopener noreferrer">{sourceLabel(item.source, item.poster_url)} <ExternalLink size={13} /></a>}
        </div>
        {similar.length > 0 && <div className="detail-similar"><h3>Dans la même veine</h3><div className="similar-row">{similar.map((entry) => <button type="button" key={entry.id} onClick={() => onNavigate(entry)} aria-label={`Voir ${entry.title}`}><Cover item={entry} sizes="90px" /><span>{entry.title}</span></button>)}</div></div>}
      </div>
      <div className="detail-nav">
        <button type="button" disabled={!previous} onClick={() => previous && onNavigate(previous)} aria-label="Titre précédent"><ChevronLeft size={20} /></button>
        <span>{index + 1} / {list.length}</span>
        <button type="button" disabled={!next} onClick={() => next && onNavigate(next)} aria-label="Titre suivant"><ChevronRight size={20} /></button>
      </div>
    </div>}
  </dialog>
}
