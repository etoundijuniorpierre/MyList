import { FormEvent, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, Check, ChevronDown, Film, Gamepad2, Heart, LoaderCircle, LogOut, Menu, Plus, Search, Send, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { itemPrice } from './pricing'
import { isConfigured, supabase } from './supabase'
import { Cover, formatPrice, safeUrl, sourceLabel } from './media'
import { useCatalog } from './useCatalog'
import { POSTER_JOB_KEY, readPosterJob, savePosterJob, type PosterJob } from './posterJobState'
const AdminPage = lazy(() => import('./AdminPage'))
import { categories, categoryLabel, type CatalogItem, type Category, type GameCountDiscount, type GamePriceTier, type PriceRule, type SiteSettings, normalizeTitle, titleKey } from './types'

const routes: Record<Category, string> = { series: '/series', games: '/jeux-pc', anime: '/animes', novelas: '/novelas', dramas: '/dramas' }
const demoItems: CatalogItem[] = [
  { id: 'demo-1', category: 'series', media_type: null, title: 'The Last of Us', title_key: titleKey('series', null, 'The Last of Us'), synopsis: 'Un voyage au cœur d’un monde bouleversé.', poster_url: null, genres: ['Drame', 'Science-fiction'], year: 2023, source: 'demo', source_id: null, source_url: null, active: true, seasons_count: 2, game_size_gb: null },
  { id: 'demo-2', category: 'series', media_type: null, title: 'Stranger Things', title_key: titleKey('series', null, 'Stranger Things'), synopsis: 'Mystères et amitiés dans une petite ville.', poster_url: null, genres: ['Mystère', 'Fantastique'], year: 2016, source: 'demo', source_id: null, source_url: null, active: true, seasons_count: 4, game_size_gb: null },
  { id: 'demo-3', category: 'games', media_type: null, title: 'Cyberpunk 2077', title_key: titleKey('games', null, 'Cyberpunk 2077'), synopsis: 'Une aventure dans Night City.', poster_url: null, genres: ['RPG', 'Action'], year: 2020, source: 'demo', source_id: null, source_url: null, active: true, seasons_count: null, game_size_gb: 70 },
  { id: 'demo-4', category: 'games', media_type: null, title: 'Hollow Knight', title_key: titleKey('games', null, 'Hollow Knight'), synopsis: 'Explorez un royaume oublié.', poster_url: null, genres: ['Aventure', 'Plateforme'], year: 2017, source: 'demo', source_id: null, source_url: null, active: true, seasons_count: null, game_size_gb: 8 },
  { id: 'demo-5', category: 'anime', media_type: 'anime', title: 'Attack on Titan', title_key: titleKey('anime', 'anime', 'Attack on Titan'), synopsis: 'Une lutte intense pour la survie.', poster_url: null, genres: ['Action', 'Drame'], year: 2013, source: 'demo', source_id: null, source_url: null, active: true, seasons_count: 4, game_size_gb: null },
  { id: 'demo-6', category: 'anime', media_type: 'anime', title: 'Demon Slayer', title_key: titleKey('anime', 'anime', 'Demon Slayer'), synopsis: 'Une quête fantastique et familiale.', poster_url: null, genres: ['Action', 'Fantastique'], year: 2019, source: 'demo', source_id: null, source_url: null, active: true, seasons_count: 4, game_size_gb: null },
  { id: 'demo-7', category: 'novelas', media_type: null, title: 'La Reina del Sur', title_key: titleKey('novelas', null, 'La Reina del Sur'), synopsis: 'Une histoire de pouvoir et de survie.', poster_url: null, genres: ['Drame'], year: 2011, source: 'demo', source_id: null, source_url: null, active: true, seasons_count: 3, game_size_gb: null },
]

function getSelection(): string[] {
  try { return JSON.parse(localStorage.getItem('mylist-selection') ?? '[]') as string[] } catch { return [] }
}

function App() {
  const [prices, setPrices] = useState<PriceRule[]>((['series', 'anime', 'novelas', 'dramas'] as const).map((category) => ({ category, standard_price: null, threshold_seasons: null, threshold_price: null, currency: null })))
  const [gameTiers, setGameTiers] = useState<GamePriceTier[]>([])
  const [gameDiscount, setGameDiscount] = useState<GameCountDiscount>({ min_games: null, price_per_game: null, currency: null })
  const [settings, setSettings] = useState<SiteSettings>({ whatsapp_number: '' })
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [authReady, setAuthReady] = useState(!isConfigured)
  const [adminReady, setAdminReady] = useState(!isConfigured)
  const [settingsLoading, setSettingsLoading] = useState(isConfigured)
  const [loadError, setLoadError] = useState('')
  const [posterJob, setPosterJob] = useState<PosterJob | null>(readPosterJob)
  const [selection, setSelection] = useState<string[]>(getSelection)
  const [menuOpen, setMenuOpen] = useState(false)
  const authUserId = useRef<string | null>(null)
  const location = useLocation()
  const { items, loading, error: catalogError, refresh: reloadCatalog } = useCatalog(location.pathname, isAdmin, selection, demoItems)

  async function refreshSettings() {
    if (!supabase) return
    setSettingsLoading(true)
    const [pricesResult, tiersResult, discountResult, settingsResult] = await Promise.all([
      supabase.from('price_rules').select('category,standard_price,threshold_seasons,threshold_price,currency'),
      supabase.from('game_price_tiers').select('id,min_gb,max_gb,price,currency').order('min_gb'),
      supabase.from('game_count_discount').select('min_games,price_per_game,currency').eq('id', true).single(),
      supabase.from('site_settings').select('whatsapp_number').eq('id', true).single(),
    ])
    setLoadError(pricesResult.error?.message ?? tiersResult.error?.message ?? discountResult.error?.message ?? settingsResult.error?.message ?? '')
    if (pricesResult.data) setPrices(pricesResult.data as PriceRule[])
    if (tiersResult.data) setGameTiers(tiersResult.data as GamePriceTier[])
    if (discountResult.data) setGameDiscount(discountResult.data as GameCountDiscount)
    if (settingsResult.data) setSettings(settingsResult.data as SiteSettings)
    setSettingsLoading(false)
  }

  async function refreshCatalog() { await Promise.all([reloadCatalog(), refreshSettings()]) }

  const authorizedAdmin = useRef<string | null>(null)
  authorizedAdmin.current = isAdmin ? user?.id ?? null : null
  const refreshRef = useRef(refreshCatalog)
  refreshRef.current = refreshCatalog
  useEffect(() => {
    if (!isAdmin || !user) return
    let mounted = true
    const uid = user.id
    const saved = readPosterJob()
    if (saved?.userId === uid) {
      setPosterJob(saved)
      if (!saved.result && !saved.error) void import('./posterJobRunner').then(({ resumePosterJob }) => resumePosterJob(saved, () => mounted && authorizedAdmin.current === uid, job => {
        if (!mounted) return
        setPosterJob(job)
        if (job.result) void refreshRef.current()
      })).catch(() => setPosterJob(current => current ? { ...current, error: 'Reprise indisponible. Réessayez.' } : null))
    }
    const sync = (event: StorageEvent) => {
      if (event.key !== POSTER_JOB_KEY) return
      const current = readPosterJob()
      if (!current || current.userId === uid) setPosterJob(current)
      if (current?.result) void refreshRef.current()
    }
    window.addEventListener('storage', sync)
    return () => { mounted = false; window.removeEventListener('storage', sync) }
  }, [isAdmin, user?.id, posterJob?.id])

  async function runPosterJob(kind: 'cache' | 'enrich', filter: Category | 'all') {
    if (!supabase || !isAdmin || !user || (posterJob && !posterJob.result && !posterJob.error)) return
    const { isCachedPosterUrl } = await import('./metadata')
    const ids = items.filter(item => (filter === 'all' || item.category === filter) && (kind === 'cache' ? Boolean(item.poster_url && !isCachedPosterUrl(item.poster_url)) : !item.poster_url)).map(item => item.id)
    const scanResult = `${ids.length} fiche(s) après le tri initial`
    const job: PosterJob = { version: 1, id: crypto.randomUUID(), userId: user.id, kind, ids, total: ids.length, completed: 0, updated: 0, stored: 0, missing: 0, label: kind === 'cache' ? `Tri terminé · ${scanResult} à conserver` : `Tri terminé · ${scanResult} à rechercher` }
    try { savePosterJob(job); setPosterJob(job) }
    catch { setLoadError('Impossible de sauvegarder la progression dans ce navigateur. Libérez de l’espace puis réessayez.') }
  }

  function retryPosterJob() {
    if (!posterJob) return
    const job = { ...posterJob, id: crypto.randomUUID(), error: undefined }
    try { savePosterJob(job); setPosterJob(job) } catch { setLoadError('La sauvegarde de progression est indisponible.') }
  }

  useEffect(() => {
    if (!supabase) return
    void refreshSettings()
    void supabase.auth.getUser().then(({ data }) => {
      const returnedId = data.user?.id ?? null
      if (authUserId.current && authUserId.current !== returnedId) return
      authUserId.current = returnedId
      setUser(data.user)
      setAuthReady(true)
      if (!data.user) setAdminReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      if (authUserId.current !== (nextUser?.id ?? null)) {
        authUserId.current = nextUser?.id ?? null
        setAdminReady(!nextUser)
        if (!nextUser) setIsAdmin(false)
      }
      setUser(nextUser)
      setAuthReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !user) return
    let cancelled = false
    setAdminReady(false)
    void supabase.from('app_admins').select('user_id').eq('user_id', user.id).maybeSingle().then(({ data }) => {
      if (!cancelled) { setIsAdmin(Boolean(data)); setAdminReady(true) }
    })
    return () => { cancelled = true }
  }, [user?.id])


  useEffect(() => { localStorage.setItem('mylist-selection', JSON.stringify(selection)) }, [selection])
  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  const activeItems = items.filter((item) => item.active)
  const selectedItems = selection.map((id) => activeItems.find((item) => item.id === id)).filter((item): item is CatalogItem => Boolean(item))
  const toggleSelected = (id: string) => setSelection((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])

  return <div className="app-shell">
    <header className="site-header">
      <Link className="brand" to="/series" aria-label="Ma Liste, accueil"><span className="brand-mark">M<span>.</span></span><span className="brand-name">MA LISTE<span className="brand-dot">.</span></span></Link>
      <nav className={`main-nav ${menuOpen ? 'nav-open' : ''}`} aria-label="Navigation principale">
        {categories.map((category) => <NavLink key={category.key} to={routes[category.key]} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>{category.label}</NavLink>)}
      </nav>
      <div className="header-actions">
        <Link className="admin-link" to="/admin"><ShieldCheck size={17} /> Administration</Link>
        <Link className="selection-link" to="/selection" aria-label={`Mon panier, ${selection.length} élément${selection.length > 1 ? 's' : ''}`}><Heart size={19} fill={selection.length ? 'currentColor' : 'none'} /><span>Mon panier</span><b key={selection.length}>{selection.length}</b></Link>
        {isAdmin && <button className="icon-button account-button" title="Se déconnecter" aria-label="Se déconnecter de l’administration" onClick={() => void supabase?.auth.signOut()}><LogOut size={19} /></button>}
        <button className="icon-button mobile-menu" aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
    </header>

    {!isConfigured && <div className="demo-banner"><Sparkles size={15} /><span>Mode démonstration — les fiches affichées sont des exemples. Connectez Supabase pour enregistrer votre catalogue.</span></div>}
    {(loadError || catalogError) && <div className="error-banner" role="alert"><span>{isAdmin ? `Chargement impossible : ${loadError || catalogError}` : 'Le catalogue est temporairement indisponible.'}</span><button onClick={() => void refreshCatalog()}>Réessayer</button></div>}
    {isAdmin && posterJob && <div className={`poster-job ${posterJob.error ? 'has-error' : posterJob.result ? 'is-complete' : ''}`} role="status" aria-live="polite">
      {!posterJob.result && !posterJob.error && <LoaderCircle className="admin-operation-spinner" size={21} aria-hidden="true" />}
      {posterJob.result && <Check size={20} aria-hidden="true" />}
      {posterJob.error && <X size={20} aria-hidden="true" />}
      <div className="poster-job-content"><strong>{posterJob.result ? 'Traitement terminé' : posterJob.error ? 'Traitement interrompu' : posterJob.label}</strong>
        <span>{posterJob.result ?? posterJob.error ?? (posterJob.total ? `${posterJob.completed} / ${posterJob.total} traité(s)` : 'Préparation…')}</span>
        {!posterJob.result && !posterJob.error && <progress value={posterJob.completed} max={posterJob.total || undefined} />}
      </div>
      {posterJob.error && <button type="button" onClick={retryPosterJob}>Reprendre</button>}
      {(posterJob.result || posterJob.error) && <button type="button" aria-label="Fermer le résultat" onClick={() => { localStorage.removeItem(POSTER_JOB_KEY); setPosterJob(null) }}><X size={16} /></button>}
    </div>}

    <Suspense fallback={<PageLoading />}><Routes>
      <Route path="/" element={<Navigate to="/series" replace />} />
      <Route path="/series" element={<CatalogPage category="series" items={activeItems} loading={loading} selection={selection} onToggle={toggleSelected} />} />
      <Route path="/jeux-pc" element={<CatalogPage category="games" items={activeItems} loading={loading} selection={selection} onToggle={toggleSelected} />} />
      <Route path="/animes-mangas" element={<Navigate to="/animes" replace />} />
      <Route path="/animes" element={<CatalogPage category="anime" items={activeItems} loading={loading} selection={selection} onToggle={toggleSelected} />} />
      <Route path="/novelas" element={<CatalogPage category="novelas" items={activeItems} loading={loading} selection={selection} onToggle={toggleSelected} />} />
      <Route path="/dramas" element={<CatalogPage category="dramas" items={activeItems} loading={loading} selection={selection} onToggle={toggleSelected} />} />
      <Route path="/selection" element={loading || settingsLoading || catalogError ? <PageLoading error={catalogError} /> : <SelectionPage items={selectedItems} prices={prices} gameTiers={gameTiers} gameDiscount={gameDiscount} whatsappNumber={settings.whatsapp_number} onToggle={toggleSelected} />} />
      <Route path="/connexion" element={<AuthPage isAdmin={isAdmin} adminReady={adminReady} />} />
      <Route path="/admin" element={<AdminPage catalogLoading={loading || settingsLoading} user={user} isAdmin={isAdmin} authReady={authReady && adminReady} items={items} prices={prices} gameTiers={gameTiers} gameDiscount={gameDiscount} settings={settings} onChanged={refreshCatalog} posterJobRunning={Boolean(posterJob && !posterJob.result && !posterJob.error)} onRunPosterJob={runPosterJob} />} />
      <Route path="*" element={<Navigate to="/series" replace />} />
    </Routes></Suspense>

    <footer className="site-footer"><div><span className="footer-brand">MA LISTE<span>.</span></span><p>Votre prochaine découverte commence ici.</p><p className="source-credit">Fiches : <a href="https://www.tvmaze.com/" target="_blank" rel="noopener noreferrer">TVMaze</a> · <a href="https://www.thetvdb.com/" target="_blank" rel="noopener noreferrer">TheTVDB</a> · <a href="https://jikan.moe/" target="_blank" rel="noopener noreferrer">Jikan</a> · <a href="https://www.wikipedia.org/" target="_blank" rel="noopener noreferrer">Wikipédia</a> · <a href="https://www.igdb.com/" target="_blank" rel="noopener noreferrer">IGDB</a> · <a href="https://rawg.io/" target="_blank" rel="noopener noreferrer">RAWG</a> · <a href="https://store.steampowered.com/" target="_blank" rel="noopener noreferrer">Steam</a></p></div><div className="footer-links">{categories.map((category) => <Link key={category.key} to={routes[category.key]}>{category.label}</Link>)}</div><small>© {new Date().getFullYear()} Ma Liste</small></footer>
  </div>
}

function PageLoading({ error = '' }: { error?: string }) { return <main className="interior-page"><div className="empty-state" role="status">{!error && <LoaderCircle className="admin-operation-spinner" size={28} />}<p>{error ? 'Chargement interrompu. Utilisez le bouton Réessayer.' : 'Chargement…'}</p></div></main> }

function CatalogPage({ category, items, loading, selection, onToggle }: { category: Category; items: CatalogItem[]; loading: boolean; selection: string[]; onToggle: (id: string) => void }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [genre, setGenre] = useState('Tous les genres')
  const [year, setYear] = useState('all')
  const [groupByYear, setGroupByYear] = useState(false)
  const [dramaRegion, setDramaRegion] = useState<'all' | 'chinese-drama' | 'korean-drama'>('all')
  const [detailsItem, setDetailsItem] = useState<CatalogItem | null>(null)
  const detailsDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { setSearch(''); setGenre('Tous les genres'); setYear('all'); setGroupByYear(false); setDramaRegion('all'); setDetailsItem(null) }, [category])
  useEffect(() => {
    const dialog = detailsDialog.current
    if (!dialog) return
    if (detailsItem && !dialog.open) dialog.showModal()
    if (!detailsItem && dialog.open) dialog.close()
  }, [detailsItem])
  const catalog = items.filter((item) => item.category === category && (category !== 'dramas' || dramaRegion === 'all' || item.media_type === dramaRegion))
  const genres = [...new Set(catalog.flatMap((item) => item.genres))].sort((a, b) => a.localeCompare(b, 'fr'))
  const years = [...new Set(catalog.map((item) => item.year).filter((value): value is number => value !== null))].sort((a, b) => b - a)
  const filtered = catalog.filter((item) => {
    const q = normalizeTitle(search)
    return (!q || normalizeTitle(`${item.title} ${item.genres.join(' ')} ${item.synopsis ?? ''}`).includes(q)) && (genre === 'Tous les genres' || item.genres.includes(genre)) && (category !== 'games' || year === 'all' || (year === 'unknown' ? item.year === null : item.year === Number(year)))
  })
  useEffect(() => { setPage(1) }, [category, search, genre, year, groupByYear, dramaRegion])
  const ordered = groupByYear && category === 'games' ? [...filtered].sort((a, b) => (b.year ?? -1) - (a.year ?? -1)) : filtered
  const pageCount = Math.max(1, Math.ceil(ordered.length / 24))
  const currentPage = Math.min(page, pageCount)
  const visible = ordered.slice((currentPage - 1) * 24, currentPage * 24)
  const yearGroups = [...new Set(visible.map((item) => item.year))].sort((a, b) => (b ?? -1) - (a ?? -1))
  const guide = category === 'games'
    ? ['Choisissez une année ou classez les jeux par année. Ouvrez une fiche pour lire sa description.', 'Consultez le poids de chaque jeu. Le panier calcule son prix selon les paliers en Go et le nombre de jeux.', 'Ajoutez vos jeux au panier, puis envoyez votre sélection et son prix sur WhatsApp. Aucun compte requis.']
    : category === 'dramas'
      ? ['Choisissez les dramas chinois ou coréens.', 'Chaque fiche indique son nombre de saisons. Le prix et la réduction sont calculés avec le tarif indépendant des dramas.', 'Ajoutez vos titres au panier, puis envoyez la sélection sur WhatsApp. Aucun compte requis.']
      : ['Parcourez les titres et ouvrez une fiche pour lire sa description.', 'Le nombre de saisons est indiqué sur chaque carte. Le panier calcule le prix et la réduction selon le total de saisons sélectionnées.', 'Ajoutez vos titres au panier, puis envoyez votre sélection et son prix sur WhatsApp. Aucun compte requis.']
  const renderCard = (item: CatalogItem) => <article className="media-card" key={item.id}><Cover item={item} /><div className="card-shade" /><div className="card-top"><span>{item.media_type === 'anime' ? 'ANIMÉ' : item.media_type === 'chinese-drama' ? 'DRAMA CHINOIS' : item.media_type === 'korean-drama' ? 'DRAMA CORÉEN' : categoryLabel(item.category).toUpperCase()}</span><button className={`card-heart ${selection.includes(item.id) ? 'is-selected' : ''}`} onClick={() => onToggle(item.id)} aria-label={selection.includes(item.id) ? `Retirer ${item.title} du panier` : `Ajouter ${item.title} au panier`}><Heart size={19} fill={selection.includes(item.id) ? 'currentColor' : 'none'} /></button></div><div className="card-info"><div className="card-facts"><span>{item.year ?? 'Année inconnue'}</span><span>{item.category === 'games' ? `${item.game_size_gb ?? '?'} Go` : `${item.seasons_count ?? '?'} ${item.seasons_count === 1 ? 'saison' : 'saisons'}`}</span></div><h3>{item.title}</h3><p className="card-genres">{item.genres.slice(0, 2).join(' · ') || 'Genre à découvrir'}</p><div className="card-actions"><button type="button" className="card-details" onClick={() => setDetailsItem(item)} aria-label={`Description de ${item.title}`}>Description</button><button onClick={() => onToggle(item.id)} className={`card-add ${selection.includes(item.id) ? 'added' : ''}`}>{selection.includes(item.id) ? <><Check size={16} /> Ajouté</> : <><Plus size={16} /> Ajouter au panier</>}</button></div></div></article>
  const intro = category === 'series' ? { eyebrow: 'LE CATALOGUE / 01', title: <>Des histoires à <em>dévorer.</em></>, copy: 'Explorez les séries disponibles, trouvez votre prochaine obsession et ajoutez-la à votre panier.', icon: <Film size={24} /> } : category === 'games' ? { eyebrow: 'LE CATALOGUE / 02', title: <>Votre prochain <em>univers.</em></>, copy: 'Des jeux PC pour chaque envie d’explorer, de gagner ou simplement de s’évader.', icon: <Gamepad2 size={24} /> } : category === 'anime' ? { eyebrow: 'LE CATALOGUE / 03', title: <>L’imaginaire sans <em>limites.</em></>, copy: 'Découvrez les animés disponibles, puis composez votre panier.', icon: <Sparkles size={24} /> } : category === 'novelas' ? { eyebrow: 'LE CATALOGUE / 04', title: <>Des émotions à <em>suivre.</em></>, copy: 'Découvrez les novelas disponibles et composez votre panier saison par saison.', icon: <BookOpen size={24} /> } : { eyebrow: 'LE CATALOGUE / 05', title: <>Vos dramas <em>préférés.</em></>, copy: 'Explorez les séries coréennes et chinoises, puis composez votre sélection.', icon: <Film size={24} /> }
  return <main>
    <section className={`hero hero-${category}`}><div className="hero-inner"><div className="hero-copy"><span className="eyebrow"><span className="eyebrow-line" /> {intro.eyebrow}</span><h1>{intro.title}</h1><p>{intro.copy}</p><a className="hero-cta" href="#catalogue">Explorer la collection <ArrowRight size={18} /></a></div><div className="hero-art" aria-hidden="true"><div className="hero-ring hero-ring-one" /><div className="hero-ring hero-ring-two" /><div className="hero-symbol">{intro.icon}</div><span className="hero-spark spark-one">✦</span><span className="hero-spark spark-two">✳</span><div className="hero-art-label">CURATED<br />FOR YOU</div></div></div><div className="hero-counter"><strong>{String(catalog.length).padStart(2, '0')}</strong><span>titres dans<br />la collection</span></div></section>
    <section className="catalog-guide" aria-labelledby="guide-title"><div><span className="section-kicker">EN TROIS ÉTAPES</span><h2 id="guide-title">Comment ça marche ?</h2></div><ol>{guide.map((step, index) => <li key={step}><strong>{String(index + 1).padStart(2, '0')}</strong><p>{step}</p></li>)}</ol></section>
    <section className="catalog-section" id="catalogue"><div className="section-heading"><div><span className="section-kicker">DÉCOUVRIR</span><h2>Toute la collection<span className="heading-period">.</span></h2><p>{catalog.length} titre{catalog.length > 1 ? 's' : ''} disponible{catalog.length > 1 ? 's' : ''}</p></div><span className="section-decoration">{categories.find((entry) => entry.key === category)?.number}</span></div>
      {category === 'dramas' && <div className="drama-tabs" role="group" aria-label="Filtrer par origine"><button type="button" className={dramaRegion === 'all' ? 'active' : ''} onClick={() => setDramaRegion('all')}>Tous les dramas</button><button type="button" className={dramaRegion === 'chinese-drama' ? 'active' : ''} onClick={() => setDramaRegion('chinese-drama')}>Chinois</button><button type="button" className={dramaRegion === 'korean-drama' ? 'active' : ''} onClick={() => setDramaRegion('korean-drama')}>Coréens</button></div>}
      <div className="filters"><label className="search-field"><Search size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un titre, un genre ou une description..." aria-label="Rechercher dans le catalogue" /></label><label className="select-field"><select value={genre} onChange={(event) => setGenre(event.target.value)} aria-label="Filtrer par genre"><option>Tous les genres</option>{genres.map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={17} /></label>{category === 'games' && <><label className="select-field"><select value={year} onChange={(event) => setYear(event.target.value)} aria-label="Choisir une année de jeu"><option value="all">Toutes les années</option>{years.map((value) => <option key={value} value={value}>{value}</option>)}<option value="unknown">Année inconnue</option></select><ChevronDown size={17} /></label><button type="button" className={`year-toggle ${groupByYear ? 'active' : ''}`} onClick={() => setGroupByYear(!groupByYear)} aria-pressed={groupByYear}>{groupByYear ? 'Vue par année' : 'Classer par année'}</button></>}</div>
      {loading ? <div className="card-grid card-grid-loading" role="status" aria-busy="true" aria-label="Chargement du catalogue">{Array.from({ length: 8 }, (_, index) => <div className="media-card skeleton-card" key={index} aria-hidden="true"><span className="skeleton-cover" /><span className="skeleton-line skeleton-line-meta" /><span className="skeleton-line skeleton-line-title" /><span className="skeleton-line skeleton-line-button" /></div>)}</div> : filtered.length ? category === 'games' && groupByYear ? <div className="year-groups">{yearGroups.map((value) => { const group = visible.filter((item) => item.year === value); return <section className="year-group" key={value ?? 'unknown'}><h3>{value ?? 'Année inconnue'} <span>{group.length} jeu{group.length > 1 ? 'x' : ''}</span></h3><div className="card-grid">{group.map(renderCard)}</div></section> })}</div> : <div className="card-grid">{visible.map(renderCard)}</div> : <div className="empty-state"><Search size={28} /><h3>{catalog.length ? 'Aucun résultat' : 'Le catalogue arrive bientôt'}</h3><p>{catalog.length ? 'Essayez un autre titre ou retirez un filtre.' : 'L’admin peut ajouter des titres depuis son espace.'}</p></div>}
      {!loading && pageCount > 1 && <nav className="catalog-pagination" aria-label="Pages du catalogue"><button className="button-secondary" disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1); document.getElementById('catalogue')?.scrollIntoView({ behavior: 'instant' }) }}>Précédent</button><span aria-live="polite">Page {currentPage} sur {pageCount} · {filtered.length} titres</span><button className="button-secondary" disabled={currentPage === pageCount} onClick={() => { setPage(currentPage + 1); document.getElementById('catalogue')?.scrollIntoView({ behavior: 'instant' }) }}>Suivant</button></nav>}
    </section>
    <dialog className="detail-dialog" ref={detailsDialog} onClose={() => setDetailsItem(null)} onClick={(event) => { if (event.target === detailsDialog.current) setDetailsItem(null) }}>{detailsItem && <div className="detail-content"><button type="button" className="detail-close" onClick={() => setDetailsItem(null)} aria-label="Fermer la description"><X size={22} /></button><Cover item={detailsItem} /><div className="detail-copy"><span className="section-kicker">{categoryLabel(detailsItem.category)}</span><h2>{detailsItem.title}</h2><div className="detail-facts"><span>{detailsItem.year ?? 'Année inconnue'}</span><span>{detailsItem.category === 'games' ? `${detailsItem.game_size_gb ?? '?'} Go` : `${detailsItem.seasons_count ?? '?'} ${detailsItem.seasons_count === 1 ? 'saison' : 'saisons'}`}</span></div><p className="detail-genres">{detailsItem.genres.join(' · ') || 'Genre à découvrir'}</p><h3>Description</h3><p>{detailsItem.synopsis || 'Description indisponible pour le moment.'}</p>{safeUrl(detailsItem.source_url) && detailsItem.source !== 'manual' && <a className="detail-source" href={safeUrl(detailsItem.source_url)} target="_blank" rel="noopener noreferrer">{sourceLabel(detailsItem.source, detailsItem.poster_url)}</a>}<button type="button" className="button-primary" onClick={() => { onToggle(detailsItem.id); setDetailsItem(null) }}>{selection.includes(detailsItem.id) ? 'Retirer du panier' : 'Ajouter au panier'}</button></div></div>}</dialog>
    <section className="discover-strip"><div><span className="section-kicker">ENVIE D’AUTRE CHOSE ?</span><h2>Il y a encore tant à découvrir.</h2></div><div>{categories.filter((entry) => entry.key !== category).map((entry) => <Link key={entry.key} to={routes[entry.key]}>{entry.label} <ArrowRight size={17} /></Link>)}</div></section>
  </main>
}

type PricedSelection = { item: CatalogItem; pricing: ReturnType<typeof itemPrice> }

function SelectionGroups({ priced, onToggle }: { priced: PricedSelection[]; onToggle: (id: string) => void }) {
  return <>{categories.map((category) => {
    const entries = priced.filter(({ item }) => item.category === category.key)
    if (!entries.length) return null
    const currency = entries[0].pricing?.currency
    const subtotal = entries.every(({ pricing }) => pricing && pricing.currency === currency)
      ? entries.reduce((sum, { pricing }) => sum + pricing!.amount, 0) : null
    return <section className={`selection-group selection-group-${category.key}`} key={category.key} aria-label={category.label}>
      <div className="selection-group-head"><h2>{category.label}</h2><span>{entries.length} titre{entries.length > 1 ? 's' : ''}{subtotal !== null && currency ? ` · ${formatPrice(subtotal, currency)}` : ''}</span></div>
      {entries.map(({ item, pricing }) => <div className="selection-row" key={item.id}>
        <Cover item={item} />
        <div><span className={`row-category row-category-${item.category}`}>{item.media_type === 'chinese-drama' ? 'Drama chinois' : item.media_type === 'korean-drama' ? 'Drama coréen' : category.singular}</span><h3>{item.title}</h3><p>{pricing?.detail ?? (item.category === 'games' ? `${item.game_size_gb ?? '?'} Go` : `${item.seasons_count ?? '?'} ${item.seasons_count === 1 ? 'saison' : 'saisons'}`)} · {item.genres.slice(0, 2).join(' · ') || 'Genre à découvrir'}</p></div>
        <div className="row-end"><strong>{pricing ? formatPrice(pricing.amount, pricing.currency) : 'Prix à venir'}</strong><button className="icon-button" onClick={() => onToggle(item.id)} aria-label={`Retirer ${item.title}`}><Trash2 size={18} /></button></div>
      </div>)}
    </section>
  })}</>
}

function SelectionPage({ items, prices, gameTiers, gameDiscount, whatsappNumber, onToggle }: { items: CatalogItem[]; prices: PriceRule[]; gameTiers: GamePriceTier[]; gameDiscount: GameCountDiscount; whatsappNumber: string; onToggle: (id: string) => void }) {
  const whatsapp = whatsappNumber
  const priced = items.map((item) => ({ item, pricing: itemPrice(item, items, prices, gameTiers, gameDiscount) }))
  const missingPrice = priced.some(({ pricing }) => !pricing)
  const currencies = [...new Set(priced.map(({ pricing }) => pricing?.currency).filter(Boolean))]
  const currency = currencies.length === 1 ? currencies[0]! : null
  const total = !missingPrice && currency ? priced.reduce((sum, { pricing }) => sum + (pricing?.amount ?? 0), 0) : null
  const canSend = Boolean(items.length && whatsapp && total !== null)
  function send() {
    if (!canSend) return
    const lines = categories.flatMap((category) => {
      const entries = priced.filter(({ item }) => item.category === category.key)
      return entries.length ? [
        `${category.label.toUpperCase()} :`,
        ...entries.map(({ item, pricing }, index) => `${index + 1}. ${item.media_type === 'chinese-drama' ? '[Drama chinois] ' : item.media_type === 'korean-drama' ? '[Drama coréen] ' : ''}${item.title} (${pricing?.detail}) — ${formatPrice(pricing!.amount, currency!)}`),
        '',
      ] : []
    })
    const message = `Bonjour, je souhaite ce panier Ma Liste :\n\n${lines.join('\n')}\n\nTotal : ${formatPrice(total!, currency!)}\n\nMerci !`
    window.open(`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }
  return <main className="interior-page"><div className="page-intro"><span className="section-kicker">VOS CHOIX</span><h1>Mon panier<span className="heading-period">.</span></h1><p>Regroupez vos coups de cœur avant de nous les envoyer.</p></div><div className="selection-layout"><div className="selection-items">{items.length ? <SelectionGroups priced={priced} onToggle={onToggle} /> : <div className="empty-state"><Heart size={28} /><h3>Votre panier est vide</h3><p>Ajoutez quelques titres depuis les catalogues.</p><Link className="button-primary" to="/series">Découvrir les séries <ArrowRight size={17} /></Link></div>}</div><aside className="summary-card"><span className="section-kicker">RÉCAPITULATIF</span><h2>Votre demande</h2><div className="summary-line"><span>Articles sélectionnés</span><strong>{items.length}</strong></div><div className="summary-total"><span>Total estimé</span><strong>{total !== null && currency ? formatPrice(total, currency) : 'À définir'}</strong></div>{items.length > 0 && missingPrice && <p className="notice">Un tarif ou une mesure manque pour certains titres. Vérifiez les saisons et les tailles dans le catalogue.</p>}{items.length > 0 && currencies.length > 1 && <p className="notice">Tous les tarifs doivent utiliser la même devise.</p>}{items.length > 0 && !whatsapp && <p className="notice">Le numéro WhatsApp du destinataire n’est pas encore configuré.</p>}<button className="button-primary full" onClick={send} disabled={!canSend}>Envoyer sur WhatsApp <Send size={17} /></button><p className="summary-footnote">L’envoi ouvre WhatsApp avec votre liste et son total. Vous confirmez le message avant de l’envoyer.</p></aside></div></main>
}

function AuthPage({ isAdmin, adminReady }: { isAdmin: boolean; adminReady: boolean }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const navigate = useNavigate()
  if (adminReady && isAdmin) return <Navigate to="/admin" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) { setMessage('La connexion sera disponible après configuration de Supabase.'); return }
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-login`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify({ username: username.trim().toLowerCase(), password }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Connexion impossible.')
      const { error } = await supabase.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token })
      if (error) throw error
      navigate('/admin')
    } catch (error) { setMessage(error instanceof Error && error.message.includes('Trop de tentatives') ? error.message : 'Identifiants incorrects ou accès admin indisponible.') }
    finally { setBusy(false) }
  }
  return <main className="auth-page">
    <div className="auth-art"><span className="eyebrow">MA LISTE / ADMINISTRATION</span><h1>Votre collection, <em>à votre façon.</em></h1><p>Ajoutez des titres, actualisez leurs fiches et préparez vos tarifs depuis un seul espace.</p><div className="auth-art-circle">M<span>.</span></div></div>
    <div className="auth-panel"><div className="auth-box"><span className="section-kicker">ACCÈS PRIVÉ</span><h2>Espace admin<span className="heading-period">.</span></h2><p>Connectez-vous avec votre nom d’utilisateur et votre mot de passe administrateur.</p>
      <form onSubmit={submit}>
        <label>Nom d’utilisateur<input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} placeholder="votre nom d’utilisateur" /></label>
        <label>Mot de passe<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} placeholder="••••••••" /></label>
        {message && <p className="form-message" role="status">{message}</p>}
        <button className="button-primary full" disabled={busy || !isConfigured}>{busy ? 'Un instant…' : 'Se connecter'} <ArrowRight size={17} /></button>
      </form>
      {!isConfigured && <p className="notice">L’accès admin sera actif dès la configuration de Supabase.</p>}
      <Link className="auth-back-link" to="/series">Retour au catalogue <ArrowRight size={15} /></Link>
    </div></div>
  </main>
}

export default App
