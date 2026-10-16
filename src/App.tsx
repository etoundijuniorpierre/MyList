import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Heart, LoaderCircle, LockKeyhole, LogOut, Menu, Search, ShieldCheck, Sparkles, Timer, X } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { calculateCart } from './pricing'
import { isConfigured, supabase } from './supabase'
import { formatPrice } from './media'
import { useCatalog } from './useCatalog'
import { useIdleLogout, readIdleMinutes } from './useIdleLogout'
import { POSTER_JOB_KEY, readPosterJob, savePosterJob, type PosterJob } from './posterJobState'
import { categoryMeta, plural } from './display'
import { categories, titleKey, type CatalogItem, type Category, type GameCountDiscount, type GamePriceTier, type PriceRule, type PricingSettings, type SiteSettings } from './types'
import { SiteContext, type SiteState, type Toast } from './site/context'
import { HomePage } from './site/HomePage'
import { CatalogPage } from './site/CatalogPage'
import { SelectionPage } from './site/SelectionPage'
import { AuthPage } from './site/AuthPage'
import { SearchPalette } from './site/SearchPalette'
const AdminPage = lazy(() => import('./AdminPage'))

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
  try { const value = JSON.parse(localStorage.getItem('mylist-selection') ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [] } catch { return [] }
}

export type PosterJobKind = PosterJob['kind']

function App() {
  const [prices, setPrices] = useState<PriceRule[]>((['series', 'anime', 'anime-film', 'novelas', 'dramas'] as const).map((category) => ({ category, standard_price: null, threshold_seasons: null, threshold_price: null, currency: null })))
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
  const [searchOpen, setSearchOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [toastHost, setToastHost] = useState<HTMLElement | null>(null)
  const toastHosts = useRef<Array<{ host: HTMLElement }>>([])
  const [idleMinutes, setIdleMinutes] = useState(readIdleMinutes)
  const [cartBump, setCartBump] = useState(0)
  const authUserId = useRef<string | null>(null)
  const signingOut = useRef(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { items, rememberItem, browseItems, browseTotal, browseSummary, browseYears, browseGenres, browsePage, browsePageSize, loading, error: catalogError, refresh: reloadCatalog, cartPending, missing } = useCatalog(location.pathname, location.search, isAdmin, selection, demoItems)

  async function refreshSettings(): Promise<PricingSettings | null> {
    if (!supabase) return { prices, gameTiers, gameDiscount, settings }
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
    if (pricesResult.error || tiersResult.error || discountResult.error || settingsResult.error || !pricesResult.data || !tiersResult.data || !discountResult.data || !settingsResult.data) return null
    return { prices: pricesResult.data as PriceRule[], gameTiers: tiersResult.data as GamePriceTier[], gameDiscount: discountResult.data as GameCountDiscount, settings: settingsResult.data as SiteSettings }
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

  const posterJobRunning = Boolean(posterJob && !posterJob.result && !posterJob.error)
  async function runPosterJob(kind: PosterJobKind, filter: Category | 'all', explicitIds?: string[]) {
    if (!supabase || !isAdmin || !user || posterJobRunning) return
    const { isCachedPosterUrl } = await import('./metadata')
    const ids = explicitIds ?? items.filter(item => kind === 'repair-games'
      ? item.category === 'games' && Boolean(item.poster_url)
      : kind === 'translate' ? Boolean(item.synopsis?.trim())
      : (filter === 'all' || item.category === filter) && (kind === 'cache' ? Boolean(item.poster_url && !isCachedPosterUrl(item.poster_url))
        : kind === 'complete' ? !item.poster_url || !item.synopsis?.trim() || !item.genres.length || !item.year : !item.poster_url)).map(item => item.id)
    if (!ids.length) return
    const labels: Record<PosterJobKind, string> = { cache: 'Affiches à conserver', 'repair-games': 'Tri initial des jaquettes de jeux', enrich: 'Affiches manquantes à rechercher', complete: 'Compléter les fiches (affiches, descriptions, saisons)', translate: 'Traduire les descriptions en français' }
    const job: PosterJob = { version: 1, id: crypto.randomUUID(), userId: user.id, kind, ids, ...(kind === 'repair-games' ? { phase: 'scan' as const, candidateIds: [] } : {}), total: ids.length, completed: 0, updated: 0, stored: 0, missing: 0, label: labels[kind] }
    try { savePosterJob(job); setPosterJob(job) }
    catch { setLoadError('Impossible de sauvegarder la progression dans ce navigateur. Libérez de l’espace puis réessayez.') }
  }

  function retryPosterJob() {
    if (!posterJob) return
    const ids = posterJob.retryIds?.length ? posterJob.retryIds : posterJob.ids
    const job = { ...posterJob, id: crypto.randomUUID(), ids, total: ids.length, completed: 0, updated: 0, stored: 0, missing: 0, retryIds: [], retryAttempts: 0, result: undefined, error: undefined }
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

  const signOut = useCallback(async (reason: 'inactivite' | 'deconnexion', scope: 'local' | 'global' = 'local') => {
    if (!supabase || signingOut.current) return
    signingOut.current = true
    try { await supabase.auth.signOut({ scope }) } finally {
      signingOut.current = false
      navigate(`/connexion?raison=${reason}`, { replace: true })
    }
  }, [navigate])
  const idle = useIdleLogout(isAdmin, posterJobRunning, idleMinutes, () => void signOut('inactivite'))

  useEffect(() => { try { localStorage.setItem('mylist-selection', JSON.stringify(selection)) } catch { /* Le panier reste en mémoire. */ } }, [selection])
  // Un titre retiré du catalogue disparaît aussi des paniers enregistrés.
  useEffect(() => { if (missing.size) setSelection(current => current.filter(id => !missing.has(id))) }, [missing])
  useEffect(() => { setMenuOpen(false); setSearchOpen(false) }, [location.pathname])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const registerToastHost = useCallback((host: HTMLElement) => {
    const entry = { host }
    toastHosts.current.push(entry)
    setToastHost(host)
    return () => {
      toastHosts.current = toastHosts.current.filter(current => current !== entry)
      setToastHost(toastHosts.current.at(-1)?.host ?? null)
    }
  }, [])
  const notify = useCallback((text: string, action?: Toast['action']) => {
    const id = Date.now() + Math.random()
    setToasts(current => [...current.slice(-2), { id, text, action }])
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 4500)
  }, [])
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const toggle = useCallback((item: Pick<CatalogItem, 'id' | 'title'>) => {
    const before = selectionRef.current
    const removing = before.includes(item.id)
    setSelection(removing ? before.filter(entry => entry !== item.id) : [...before, item.id])
    setCartBump(value => value + 1)
    notify(removing ? `« ${item.title} » retiré du panier` : `« ${item.title} » ajouté au panier`, { label: 'Annuler', run: () => setSelection(before) })
  }, [notify])
  const remapSelection = useCallback((removedId: string, keptId: string) => {
    setSelection(current => [...new Set(current.map(id => id === removedId ? keptId : id))])
  }, [])

  const activeItems = useMemo(() => items.filter((item) => item.active), [items])
  const selectedItems = useMemo(() => selection.map((id) => activeItems.find((item) => item.id === id)).filter((item): item is CatalogItem => Boolean(item)), [selection, activeItems])
  const cartTotal = useMemo(() => {
    if (!selectedItems.length || selectedItems.length !== selection.length || settingsLoading || loadError) return null
    const cart = calculateCart(selectedItems, prices, gameTiers, gameDiscount)
    return cart.total !== null && cart.currency ? { amount: cart.total, currency: cart.currency } : null
  }, [selectedItems, selection.length, prices, gameTiers, gameDiscount, settingsLoading, loadError])

  const site: SiteState = {
    items, selection, selectedItems, toggle, clearSelection: () => setSelection([]),
    prices, gameTiers, gameDiscount, settings, isAdmin, openSearch: () => setSearchOpen(true), notify, registerToastHost,
  }
  const path = location.pathname
  const inAdmin = path === '/admin' || path === '/connexion'
  const routeCat = Object.entries(categoryMeta).find(([, meta]) => meta.route === path)?.[0] as Category | undefined
  const showCartBar = selection.length > 0 && !inAdmin && path !== '/selection'

  return <SiteContext.Provider value={site}>
    <div className={`app-shell ${inAdmin ? 'is-private' : ''}`} style={routeCat ? { '--accent': categoryMeta[routeCat].accent } as CSSProperties : undefined}>
      <a className="skip-link" href="#contenu">Aller au contenu</a>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="Ma Liste, accueil"><span className="brand-mark" aria-hidden="true">M<span>.</span></span><span className="brand-name">MA LISTE<span>.</span></span></Link>
        {!inAdmin && <nav className={`main-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Univers" id="main-nav">
          {categories.map((category) => <NavLink key={category.key} to={categoryMeta[category.key].route} className="nav-link" style={{ '--accent': categoryMeta[category.key].accent } as CSSProperties}>{category.label}</NavLink>)}
        </nav>}
        <div className="header-actions">
          {!inAdmin && <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Rechercher un titre (Ctrl + K)"><Search size={17} /><span>Rechercher</span><kbd>Ctrl K</kbd></button>}
          {isAdmin && <Link className={`admin-pill ${path === '/admin' ? 'is-on' : ''}`} to="/admin"><ShieldCheck size={16} /><span>Admin</span></Link>}
          {inAdmin && path === '/admin' && <Link className="admin-pill" to="/"><span>Voir le site</span></Link>}
          {!inAdmin && <Link className="cart-link" to="/selection" aria-label={`Mon panier, ${plural(selection.length, 'titre')}`}><Heart size={18} fill={selection.length ? 'currentColor' : 'none'} /><span>Panier</span><b key={cartBump} className={selection.length ? 'is-filled' : ''}>{selection.length}</b></Link>}
          {isAdmin && <button type="button" className="icon-button" title="Se déconnecter" aria-label="Se déconnecter de l’administration" onClick={() => void signOut('deconnexion')}><LogOut size={18} /></button>}
          {!inAdmin && <button type="button" className="icon-button mobile-menu" aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>}
        </div>
      </header>

      {!isConfigured && <div className="demo-banner"><Sparkles size={15} aria-hidden="true" /><span>Mode démonstration : les fiches affichées sont des exemples.</span></div>}
      {(loadError || catalogError) && <div className="error-banner" role="alert"><span>{isAdmin ? `Chargement impossible : ${loadError || catalogError}` : 'Le catalogue est momentanément indisponible.'}</span><button type="button" onClick={() => void refreshCatalog()}>Réessayer</button></div>}
      {isAdmin && posterJob && <div className={`poster-job ${posterJob.error ? 'has-error' : posterJob.result ? 'is-complete' : ''}`} role="status" aria-live="polite">
        {posterJobRunning && <LoaderCircle className="spin" size={20} aria-hidden="true" />}
        {posterJob.result && <Check size={20} aria-hidden="true" />}
        {posterJob.error && <X size={20} aria-hidden="true" />}
        <div className="poster-job-content"><strong>{posterJob.result ? 'Traitement terminé' : posterJob.error ? 'Traitement interrompu' : posterJob.label}</strong>
          <span>{posterJob.result ?? posterJob.error ?? (posterJob.total ? `${posterJob.completed} / ${posterJob.total} traité(s) · ${posterJob.updated} enrichie(s)` : 'Préparation…')}</span>
          {posterJobRunning && <progress value={posterJob.completed} max={posterJob.total || undefined} />}
        </div>
        {(posterJob.error || (posterJob.result && posterJob.retryIds?.length)) && <button type="button" onClick={retryPosterJob}>{posterJob.result ? `Relancer ${posterJob.retryIds?.length} échec(s)` : 'Reprendre'}</button>}
        {(posterJob.result || posterJob.error) && <button type="button" aria-label="Fermer le résultat" onClick={() => { localStorage.removeItem(POSTER_JOB_KEY); setPosterJob(null) }}><X size={16} /></button>}
      </div>}

      <Suspense fallback={<PageLoading />}><Routes>
        <Route path="/" element={<HomePage demo={demoItems} />} />
        {categories.map((category) => <Route key={category.key} path={categoryMeta[category.key].route} element={<CatalogPage category={category.key} loading={loading} items={browseItems} total={browseTotal} summary={browseSummary} years={browseYears} genres={browseGenres} page={browsePage} pageSize={browsePageSize} />} />)}
        <Route path="/animes-mangas" element={<Navigate to="/animes" replace />} />
        <Route path="/selection" element={<SelectionPage loading={cartPending || settingsLoading} pricingError={loadError} onVerifyPricing={refreshSettings} />} />
        <Route path="/connexion" element={<AuthPage isAdmin={isAdmin} adminReady={adminReady} />} />
        <Route path="/admin" element={<AdminPage catalogLoading={loading || settingsLoading} user={user} isAdmin={isAdmin} authReady={authReady && adminReady} items={items} prices={prices} gameTiers={gameTiers} gameDiscount={gameDiscount} settings={settings} onChanged={refreshCatalog} onMerged={remapSelection} posterJobRunning={posterJobRunning} onRunPosterJob={runPosterJob} idleMinutes={idleMinutes} onIdleMinutes={setIdleMinutes} onSignOut={signOut} />} />
        <Route path="*" element={<NotFound />} />
      </Routes></Suspense>

      {showCartBar && <Link to="/selection" className="cart-bar" key={`bar-${cartBump}`}>
        <Heart size={18} fill="currentColor" aria-hidden="true" />
        <span><strong>{plural(selection.length, 'titre')}</strong>{cartTotal ? ` · ${formatPrice(cartTotal.amount, cartTotal.currency)} estimé` : ''}</span>
        <span className="cart-bar-cta">Voir le panier <ArrowRight size={16} aria-hidden="true" /></span>
      </Link>}

      {createPortal(<div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className="toast" key={toast.id}><Check size={16} aria-hidden="true" /><span>{toast.text}</span>{toast.action && <button type="button" onClick={() => { toast.action!.run(); setToasts(current => current.filter(entry => entry.id !== toast.id)) }}>{toast.action.label}</button>}</div>)}</div>, toastHost ?? document.body)}

      {idle.secondsLeft !== null && <div className="idle-warning" role="alertdialog" aria-labelledby="idle-title" aria-describedby="idle-copy">
        <div className="idle-box"><Timer size={26} aria-hidden="true" /><h2 id="idle-title">Toujours là ?</h2><p id="idle-copy">Par sécurité, la session admin se fermera dans <strong>{idle.secondsLeft} s</strong>.</p>
          <div className="idle-actions"><button type="button" className="button-primary" onClick={idle.stayActive} autoFocus>Rester connecté</button><button type="button" className="button-ghost" onClick={() => void signOut('deconnexion')}>Se déconnecter</button></div></div>
      </div>}

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} onChoose={rememberItem} demo={demoItems} />

      {!inAdmin && <footer className="site-footer">
        <div className="footer-brand-block"><span className="footer-brand">MA LISTE<span>.</span></span><p>Votre prochaine découverte commence ici.</p></div>
        <nav className="footer-links" aria-label="Univers">{categories.map((category) => <Link key={category.key} to={categoryMeta[category.key].route}>{category.label}</Link>)}<Link to="/selection">Mon panier</Link></nav>
        <p className="source-credit">Fiches : <a href="https://www.tvmaze.com/" target="_blank" rel="noopener noreferrer">TVMaze</a> · <a href="https://www.thetvdb.com/" target="_blank" rel="noopener noreferrer">TheTVDB</a> · <a href="https://anilist.co/" target="_blank" rel="noopener noreferrer">AniList</a> · <a href="https://jikan.moe/" target="_blank" rel="noopener noreferrer">Jikan</a> · <a href="https://kitsu.io/" target="_blank" rel="noopener noreferrer">Kitsu</a> · <a href="https://www.igdb.com/" target="_blank" rel="noopener noreferrer">IGDB</a> · <a href="https://rawg.io/" target="_blank" rel="noopener noreferrer">RAWG</a> · <a href="https://store.steampowered.com/" target="_blank" rel="noopener noreferrer">Steam</a> · <a href="https://www.wikipedia.org/" target="_blank" rel="noopener noreferrer">Wikipédia</a></p>
        <div className="footer-bottom"><small>© {new Date().getFullYear()} Ma Liste</small><Link className="private-link" to={isAdmin ? '/admin' : '/connexion'}><LockKeyhole size={12} aria-hidden="true" /> Espace privé</Link></div>
      </footer>}
    </div>
  </SiteContext.Provider>
}

function PageLoading() { return <main className="interior-page"><div className="empty-state" role="status"><LoaderCircle className="spin" size={28} aria-hidden="true" /><p>Chargement…</p></div></main> }

function NotFound() {
  return <main id="contenu" tabIndex={-1} className="interior-page"><div className="empty-state"><h1 className="not-found">404</h1><p>Cette page a quitté l’affiche.</p><Link className="button-primary" to="/">Retour à l’accueil <ArrowRight size={17} /></Link></div></main>
}

export default App
