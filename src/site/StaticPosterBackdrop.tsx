import { Cover } from '../media'
import type { CatalogItem } from '../types'

/** Trois miniatures fixes : aucun défilement, aucune bande d'images dupliquée. */
export function StaticPosterBackdrop({ items }: { items: CatalogItem[] }) {
  const posters = [...new Map(items.filter(item => item.poster_url).map(item => [item.id, item])).values()].slice(0, 3)
  return <div className="static-poster-backdrop" aria-hidden="true">
    {posters.map(item => <Cover key={item.id} item={item} sizes="120px" />)}
  </div>
}
