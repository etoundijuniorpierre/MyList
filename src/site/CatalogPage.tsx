import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, ArrowUp, Info, LoaderCircle, RotateCcw, Search, X } from 'lucide-react'
import { Cover, formatPrice } from '../media'
import { categoryMeta, plural, setPageMeta } from '../display'
import { categories, categoryLabel, type CatalogItem, type Category } from '../types'
import { useSite } from './context'
import { DetailDialog } from './DetailDialog'
import { MediaCard, SkeletonGrid } from './MediaCard'
import { useLightweightDisplay } from '../useLightweightDisplay'
import { StaticPosterBackdrop } from './StaticPosterBackdrop'
import { catalogSort, DEFAULT_CATALOG_SORT, type CatalogSort } from '../catalogData'
import { scrollCatalogStart } from '../catalogScroll'

type Sort = CatalogSort
const sortLabels: Record<Sort, string> = { 'year-desc': 'Année de sortie ↓', 'year-asc': 'Année de sortie ↑', az: 'Titre A → Z', za: 'Titre Z → A', recent: 'Derniers ajouts au catalogue' }

export function CatalogPage({ category, loading, items: pageItems, total, summary, years, genres, page, pageSize }: { category: Category; loading: boolean; items: CatalogItem[]; total: number; summary: { count: number; seasons: number; size: number; genres: number }; years: number[]; genres: Array<{ name: string; count: number }>; page: number; pageSize: number }) {
  const { items, selection, toggle, isAdmin, prices, gameTiers, gameDiscount } = useSite()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const meta = categoryMeta[category]
  const label = categoryLabel(category)
  const q = params.get('q') ?? ''
  const genre = params.get('genre') ?? ''
  const year = params.get('annee') ?? ''
  const sort = catalogSort(params.get('tri'))
  const byYear = params.get('vue') === 'annees'
  const origin = params.get('origine') ?? ''
  const format = params.get('format') ?? ''
  const openId = params.get('titre')
  const [search, setSearch] = useState(q)
  const searchInput = useRef<HTMLInputElement>(null)
  const committedSearch = useRef(q)
  const lightweight = useLightweightDisplay()
  const listStart = useRef<HTMLDivElement>(null)
  const paginationContext = JSON.stringify([category, q, genre, year, sort, byYear, origin, format])
  const previousPagination = useRef({ context: paginationContext, page })
  const paginationRequested = useRef(false)
  const changePage = useCallback((nextPage: number) => {
    if (nextPage === page) return
    paginationRequested.current = true
    scrollCatalogStart(listStart.current)
    setParams(current => {
      const next = new URLSearchParams(current)
      if (nextPage <= 1) next.delete('page'); else next.set('page', String(nextPage))
      return next
    }, { replace: false })
  }, [page, setParams])

  useEffect(() => {
    const previous = previousPagination.current
    previousPagination.current = { context: paginationContext, page }
    if (previous.context !== paginationContext) { paginationRequested.current = false; return }
    if (previous.context === paginationContext && previous.page !== page) {
      paginationRequested.current = true
    }
    // Répéter après le chargement évite que l'ancrage mobile annule le saut.
    if (paginationRequested.current && !loading) {
      const frame = window.requestAnimationFrame(() => {
        scrollCatalogStart(listStart.current)
        paginationRequested.current = false
      })
      return () => window.cancelAnimationFrame(frame)
    }
  }, [paginationContext, page, loading])

  useEffect(() => { setPageMeta(label) }, [label])
  useEffect(() => {
    if (q !== committedSearch.current) setSearch(q)
    committedSearch.current = q
  }, [q])
  const update = useCallback((changes: Record<string, string | null>, replace = true) => {
    setParams(current => {
      const next = new URLSearchParams(current)
      for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key)
      if (Object.keys(changes).some(key => key !== 'titre' && key !== 'page')) next.delete('page')
      return next
    }, { replace })
  }, [setParams])
  useEffect(() => {
    if (search.trim() === q) return
    const timeout = window.setTimeout(() => {
      committedSearch.current = search.trim()
      update({ q: search.trim() || null })
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [search, q, update])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || (event.target as HTMLElement)?.closest('input, textarea, select, dialog')) return
      event.preventDefault(); searchInput.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const catalog = useMemo(() => [...new Map([...items, ...pageItems].filter(item => item.active && item.category === category).map(item => [item.id, item])).values()], [items, pageItems, category])
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const pageNumbers = paginationWindow(page, pageCount)
  const active = Boolean(q || genre || year || origin || format || sort !== DEFAULT_CATALOG_SORT || byYear)
  const detail = openId ? catalog.find(item => item.id === openId) ?? null : null
  const openItem = useCallback((item: CatalogItem) => update({ titre: item.id }, false), [update])
  const navigateItem = useCallback((item: CatalogItem) => update({ titre: item.id }), [update])
  const closeItem = useCallback(() => update({ titre: null }), [update])
  const edit = useCallback((item: CatalogItem) => navigate(`/admin?edit=${encodeURIComponent(item.id)}`), [navigate])
  const wall = useMemo(() => pageItems.filter(item => item.poster_url).slice(0, lightweight ? 3 : 14), [pageItems, lightweight])
  const priceHint = pricingHint(category, prices, gameTiers, gameDiscount)
  const yearGroups = byYear ? [...new Set(pageItems.map(item => item.year))] : []

  useEffect(() => {
    if (!loading && page > pageCount) update({ page: pageCount > 1 ? String(pageCount) : null })
  }, [loading, page, pageCount, update])

  return <main id="contenu" tabIndex={-1} className="catalog-page" style={{ '--accent': meta.accent, '--glow': meta.glow } as CSSProperties}>
    <section className="universe-hero">
      {lightweight ? <StaticPosterBackdrop items={wall} /> : <div className="hero-wall" aria-hidden="true">{wall.map((item, index) => <Cover key={item.id} item={item} priority={index < 4} sizes="160px" />)}</div>}
      <div className="hero-veil" aria-hidden="true" />
      <div className="universe-hero-inner">
        <span className="eyebrow">{meta.eyebrow} · {label}</span><h1>{meta.title[0]} <em>{meta.title[1]}</em></h1><p>{meta.copy}</p>
        <dl className="hero-stats">
          <div><dt>Titres</dt><dd>{loading ? '…' : summary.count.toLocaleString('fr-FR')}</dd></div>
          {category === 'games' ? <div><dt>Go au total</dt><dd>{loading ? '…' : Math.round(summary.size).toLocaleString('fr-FR')}</dd></div> : <div><dt>Saisons</dt><dd>{loading ? '…' : summary.seasons.toLocaleString('fr-FR')}</dd></div>}
          <div><dt>Genres</dt><dd>{loading ? '…' : summary.genres}</dd></div>
        </dl>
      </div>
    </section>

    <div ref={listStart} className="catalog-list-start" aria-hidden="true" />
    <div className="catalog-toolbar" role="search">
      <div className="toolbar-row">
        <label className="search-field"><Search size={18} aria-hidden="true" /><span className="visually-hidden">Rechercher dans {label}</span><input ref={searchInput} value={search} onChange={event => setSearch(event.target.value)} placeholder={`Rechercher parmi ${loading ? 'les' : summary.count.toLocaleString('fr-FR')} ${label.toLowerCase()}…`} type="search" enterKeyHint="search" />
          {search ? <button type="button" className="field-clear" onClick={() => setSearch('')} aria-label="Effacer la recherche"><X size={15} /></button> : <kbd aria-hidden="true">/</kbd>}
        </label>
        <label className="select-field"><span className="visually-hidden">Année de sortie</span><select value={year} onChange={event => update({ annee: event.target.value || null })}><option value="">Toutes les années</option>{years.map(value => <option key={value} value={value}>{value}</option>)}<option value="inconnue">Année inconnue</option></select></label>
        <label className="select-field"><span className="visually-hidden">Trier</span><select value={sort} onChange={event => update({ tri: event.target.value === DEFAULT_CATALOG_SORT ? null : event.target.value })}>{Object.entries(sortLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
        <button type="button" className={`toggle ${byYear ? 'is-on' : ''}`} aria-pressed={byYear} onClick={() => update({ vue: byYear ? null : 'annees' })}>Par année</button>
      </div>
      <div className="toolbar-row toolbar-chips">
        {category === 'dramas' && <div className="segmented" role="group" aria-label="Origine">{[['', 'Tous'], ['korean-drama', 'Coréens'], ['chinese-drama', 'Chinois']].map(([value, text]) => <button type="button" key={value} className={origin === value ? 'is-on' : ''} aria-pressed={origin === value} onClick={() => update({ origine: value || null })}>{text}</button>)}</div>}
        {category === 'anime' && <div className="segmented" role="group" aria-label="Format">{[['', 'Tout'], ['series', 'Séries'], ['film', 'Films']].map(([value, text]) => <button type="button" key={value} className={format === value ? 'is-on' : ''} aria-pressed={format === value} onClick={() => update({ format: value || null })}>{text}</button>)}</div>}
        <div className="chip-scroller" role="group" aria-label="Genres"><button type="button" className={`chip-button ${!genre ? 'is-on' : ''}`} aria-pressed={!genre} onClick={() => update({ genre: null })}>Tous les genres</button>
          {genres.slice(0, 14).map(({ name, count }) => <button type="button" key={name} className={`chip-button ${genre === name ? 'is-on' : ''}`} aria-pressed={genre === name} onClick={() => update({ genre: genre === name ? null : name })}>{name} <small>{count}</small></button>)}
          {genre && !genres.slice(0, 14).some(({ name }) => name === genre) && <button type="button" className="chip-button is-on" aria-pressed="true" onClick={() => update({ genre: null })}>{genre}</button>}
        </div>
      </div>
      <div className="toolbar-status"><p aria-live="polite">{loading ? 'Chargement du catalogue…' : `${plural(total, 'titre')}${active ? ' correspondent' : ''} · page ${page} sur ${pageCount}`}</p>
        {active && <button type="button" className="text-button" onClick={() => { setSearch(''); setParams(openId ? { titre: openId } : {}, { replace: true }) }}><RotateCcw size={14} /> Réinitialiser</button>}
      </div>
    </div>

    {priceHint && <p className="price-hint"><Info size={15} aria-hidden="true" /> {priceHint}</p>}
    <section className="catalog-results" aria-label={`Titres ${label}`}>
      {loading && pageItems.length > 0 && <p className="catalog-refresh-status" role="status"><LoaderCircle className="spin" size={15} aria-hidden="true" /> Mise à jour des titres…</p>}
      {loading && !pageItems.length ? <SkeletonGrid /> : total ? byYear
        ? yearGroups.map(value => { const group = pageItems.filter(item => item.year === value); return <section className="year-group" key={value ?? 'inconnue'}><h2>{value ?? 'Année inconnue'} <span>{plural(group.length, 'titre')}</span></h2><div className="card-grid">{group.map(item => <MediaCard key={item.id} item={item} selected={selection.includes(item.id)} onOpen={openItem} onToggle={toggle} onEdit={isAdmin ? edit : undefined} />)}</div></section> })
        : <div className="card-grid">{pageItems.map((item, index) => <MediaCard key={item.id} item={item} priority={index < 6} selected={selection.includes(item.id)} onOpen={openItem} onToggle={toggle} onEdit={isAdmin ? edit : undefined} />)}</div>
        : <div className="empty-state"><Search size={28} aria-hidden="true" /><h2>{summary.count ? 'Aucun titre ne correspond' : 'Cet univers arrive bientôt'}</h2><p>{summary.count ? 'Essayez un autre mot ou retirez un filtre.' : 'Les premiers titres seront bientôt ajoutés.'}</p>{active && <button type="button" className="button-ghost" onClick={() => { setSearch(''); setParams(openId ? { titre: openId } : {}, { replace: true }) }}>Voir tout le catalogue</button>}</div>}
      {total > pageSize && <nav className="catalog-pagination" aria-label="Pagination du catalogue">
        <button type="button" className="button-ghost pagination-step" disabled={page <= 1} onClick={() => changePage(page - 1)} aria-label="Page précédente">Précédent</button>
        <div className="pagination-pages">{pageNumbers.map((entry, index) => entry === '…' ? <span className="pagination-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">…</span> : <button type="button" key={entry} className={`pagination-number ${entry === page ? 'is-current' : ''}`} aria-label={`Page ${entry}`} aria-current={entry === page ? 'page' : undefined} onClick={() => changePage(entry)}>{entry}</button>)}</div>
        <button type="button" className="button-ghost pagination-step" disabled={page >= pageCount} onClick={() => changePage(page + 1)} aria-label="Page suivante">Suivant</button>
      </nav>}
      {page > 1 && <button type="button" className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Revenir en haut"><ArrowUp size={18} /></button>}
    </section>

    <section className="other-universes" aria-labelledby="other-title"><h2 id="other-title">Changer d’univers</h2><div className="universe-links">{categories.filter(entry => entry.key !== category).map(entry => <Link key={entry.key} to={categoryMeta[entry.key].route} style={{ '--accent': categoryMeta[entry.key].accent } as CSSProperties}><span>{entry.label}</span><small>{categoryMeta[entry.key].tagline}</small><ArrowRight size={17} aria-hidden="true" /></Link>)}</div></section>
    <DetailDialog item={detail} list={catalog} onNavigate={navigateItem} onClose={closeItem} onEdit={isAdmin ? edit : undefined} />
  </main>
}

function paginationWindow(page: number, pages: number): Array<number | '…'> {
  const values = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter(value => value >= 1 && value <= pages))
  const result: Array<number | '…'> = []
  let previous = 0
  for (const value of [...values].sort((a, b) => a - b)) { if (previous && value - previous > 1) result.push('…'); result.push(value); previous = value }
  return result
}

function pricingHint(category: Category, prices: ReturnType<typeof useSite>['prices'], tiers: ReturnType<typeof useSite>['gameTiers'], discount: ReturnType<typeof useSite>['gameDiscount']) {
  if (category === 'games') {
    if (!tiers.length) return ''
    const sorted = [...tiers].sort((a, b) => a.min_gb - b.min_gb)
    const range = `${formatPrice(Number(sorted[0].price), sorted[0].currency)} à ${formatPrice(Number(sorted.at(-1)!.price), sorted.at(-1)!.currency)} selon la taille`
    return discount.min_games && discount.price_per_game != null && discount.currency ? `Jeux PC : ${range} · ${formatPrice(Number(discount.price_per_game), discount.currency)} le jeu dès ${discount.min_games} jeux.` : `Jeux PC : ${range}.`
  }
  const rule = prices.find(entry => entry.category === category)
  if (rule?.standard_price == null || !rule.currency) return ''
  const film = category === 'anime' ? prices.find(entry => entry.category === 'anime-film') : undefined
  const base = `${formatPrice(Number(rule.standard_price), rule.currency)} la saison`
  const reduced = rule.threshold_seasons && rule.threshold_price != null ? ` · ${formatPrice(Number(rule.threshold_price), rule.currency)} dès ${rule.threshold_seasons} saisons dans le panier` : ''
  const films = film?.standard_price != null && film.currency ? ` · films ${formatPrice(Number(film.standard_price), film.currency)}` : ''
  return `Tarif : ${base}${reduced}${films}.`
}
