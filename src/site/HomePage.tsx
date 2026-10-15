import { useEffect, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Heart, MessageCircle, Search, Sparkles } from 'lucide-react'
import { Cover } from '../media'
import { categoryMeta, kindLabel, plural, setPageMeta } from '../display'
import { categories, type CatalogItem } from '../types'
import { useHomeData } from '../useHomeData'
import { useSite } from './context'
import { useLightweightDisplay } from '../useLightweightDisplay'
import { StaticPosterBackdrop } from './StaticPosterBackdrop'

export function HomePage({ demo }: { demo: CatalogItem[] }) {
  const { shelves, error } = useHomeData(demo)
  const { openSearch, selection } = useSite()
  const lightweight = useLightweightDisplay()
  useEffect(() => { setPageMeta('') }, [])
  const total = shelves?.reduce((sum, shelf) => sum + shelf.count, 0) ?? 0
  const posters = shelves?.flatMap((shelf) => shelf.latest) ?? []
  const mobilePosters = shelves?.flatMap(shelf => shelf.latest.find(item => item.poster_url) ?? []) ?? []
  // Trois bandes d'affiches qui défilent en sens opposés : la vitrine du vidéo-club.
  const rows = [0, 1, 2].map((row) => posters.filter((_, index) => index % 3 === row))

  return <main id="contenu" tabIndex={-1} className="home-page">
    <section className="home-hero">
      {lightweight ? <StaticPosterBackdrop items={mobilePosters} /> : <div className="marquee" aria-hidden="true">
        {rows.map((row, index) => row.length > 0 && <div className={`marquee-row marquee-${index}`} key={index}><div className="marquee-track">{[...row, ...row].map((item, position) => <Cover key={`${item.id}-${position}`} item={item} priority={position < 6} sizes="150px" />)}</div></div>)}
      </div>}
      <div className="home-veil" aria-hidden="true" />
      <div className="home-hero-inner">
        <span className="eyebrow"><Sparkles size={14} aria-hidden="true" /> Votre vidéo-club personnel</span>
        <h1>Votre prochaine soirée <em>commence ici.</em></h1>
        <p>Séries, jeux PC, animés, novelas et dramas : composez votre panier en quelques clics et envoyez-le sur WhatsApp. Aucun compte à créer.</p>
        <div className="home-cta">
          <button type="button" className="button-primary button-large" onClick={openSearch}><Search size={18} /> Trouver un titre</button>
          <a className="button-ghost button-large" href="#univers">Explorer les univers <ArrowRight size={17} /></a>
        </div>
        <p className="home-count" aria-live="polite">{shelves ? `${total.toLocaleString('fr-FR')} titres disponibles` : error ? 'Catalogue momentanément indisponible' : 'Chargement du catalogue…'}</p>
      </div>
    </section>

    <section className="universes" id="univers" aria-labelledby="universes-title">
      <div className="section-head"><span className="eyebrow">Cinq univers</span><h2 id="universes-title">Où voulez-vous aller ce soir&nbsp;?</h2></div>
      <div className="portal-grid">
        {categories.map((entry) => {
          const shelf = shelves?.find((value) => value.category === entry.key)
          const meta = categoryMeta[entry.key]
          return <Link key={entry.key} to={meta.route} className="portal" style={{ '--accent': meta.accent, '--glow': meta.glow } as CSSProperties}>
            <div className="portal-stack" aria-hidden="true">{shelf?.latest.slice(0, 3).map((item) => <Cover key={item.id} item={item} sizes="140px" />)}</div>
            <div className="portal-copy"><span className="portal-number">{entry.number}</span><h3>{entry.label}</h3><p>{meta.tagline}</p><span className="portal-count">{shelf ? plural(shelf.count, 'titre') : '…'} <ArrowRight size={16} aria-hidden="true" /></span></div>
          </Link>
        })}
      </div>
    </section>

    {shelves?.filter((shelf) => shelf.latest.length).map((shelf) => {
      const meta = categoryMeta[shelf.category]
      const label = categories.find((entry) => entry.key === shelf.category)!.label
      return <section className="rail" key={shelf.category} aria-labelledby={`rail-${shelf.category}`} style={{ '--accent': meta.accent } as CSSProperties}>
        <div className="rail-head"><h2 id={`rail-${shelf.category}`}><span>Nouveautés</span> {label}</h2><Link to={meta.route}>Tout voir <ArrowRight size={16} aria-hidden="true" /></Link></div>
        <div className="rail-track">{shelf.latest.slice(0, 12).map((item) => <Link key={item.id} to={`${meta.route}?titre=${encodeURIComponent(item.id)}`} className="rail-card"><Cover item={item} sizes="180px" /><span className="rail-title">{item.title}</span><span className="rail-meta">{kindLabel(item)}{item.year ? ` · ${item.year}` : ''}</span></Link>)}</div>
      </section>
    })}

    <section className="steps" aria-labelledby="steps-title">
      <div className="section-head"><span className="eyebrow">Simple comme un générique</span><h2 id="steps-title">Comment ça marche&nbsp;?</h2></div>
      <ol>
        <li><Search size={22} aria-hidden="true" /><strong>Parcourez</strong><p>Filtrez par genre, année ou titre. Chaque fiche affiche ses saisons, sa taille et son prix indicatif.</p></li>
        <li><Heart size={22} aria-hidden="true" /><strong>Composez</strong><p>Ajoutez vos titres au panier. Les remises de volume se calculent toutes seules.</p></li>
        <li><MessageCircle size={22} aria-hidden="true" /><strong>Envoyez</strong><p>Un clic ouvre WhatsApp avec votre liste et le total. Vous validez le message avant l’envoi.</p></li>
      </ol>
      {selection.length > 0 && <Link className="button-primary" to="/selection">Voir mon panier · {plural(selection.length, 'titre')} <ArrowRight size={17} /></Link>}
    </section>
  </main>
}
