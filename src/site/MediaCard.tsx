import { memo } from 'react'
import { Check, Heart, Plus, Settings } from 'lucide-react'
import { Cover } from '../media'
import { kindLabel, measureLabel } from '../display'
import type { CatalogItem } from '../types'

interface Props {
  item: CatalogItem
  selected: boolean
  priority?: boolean
  onOpen: (item: CatalogItem) => void
  onToggle: (item: CatalogItem) => void
  onEdit?: (item: CatalogItem) => void
}

function MediaCardBase({ item, selected, priority, onOpen, onToggle, onEdit }: Props) {
  return <article className={`media-card ${selected ? 'is-selected' : ''}`}>
    <button type="button" className="card-hit" onClick={() => onOpen(item)} aria-label={`Ouvrir la fiche de ${item.title}`} />
    <Cover item={item} priority={priority} />
    <div className="card-shade" aria-hidden="true" />
    <div className="card-top">
      <span className="card-kind">{kindLabel(item)}</span>
      <div className="card-top-actions">
        {onEdit && <button type="button" className="card-round" onClick={() => onEdit(item)} aria-label={`Modifier la fiche ${item.title}`} title="Modifier"><Settings size={16} /></button>}
        <button type="button" className={`card-round card-heart ${selected ? 'is-on' : ''}`} onClick={() => onToggle(item)} aria-pressed={selected} aria-label={selected ? `Retirer ${item.title} du panier` : `Ajouter ${item.title} au panier`}><Heart size={17} fill={selected ? 'currentColor' : 'none'} /></button>
      </div>
    </div>
    <div className="card-body">
      <h3>{item.title}</h3>
      <p className="card-meta"><span>{item.year ?? '—'}</span><span>{measureLabel(item)}</span></p>
      <p className="card-genres">{item.genres.slice(0, 3).join(' · ') || 'Genre à découvrir'}</p>
      <button type="button" className={`card-add ${selected ? 'is-on' : ''}`} onClick={() => onToggle(item)} aria-pressed={selected} aria-label={selected ? `Retirer ${item.title} du panier` : `Ajouter ${item.title} au panier`}>
        {selected ? <><Check size={15} /> Ajouté</> : <><Plus size={15} /> Ajouter</>}
      </button>
    </div>
  </article>
}

export const MediaCard = memo(MediaCardBase)

export function SkeletonGrid({ count = 12 }: { count?: number }) {
  return <div className="card-grid" role="status" aria-label="Chargement du catalogue">
    {Array.from({ length: count }, (_, index) => <div className="media-card skeleton-card" key={index} aria-hidden="true" />)}
  </div>
}
