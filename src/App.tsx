import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, Check, ChevronDown, Film, Gamepad2, Heart, LoaderCircle, LockKeyhole, LogOut, Menu, Plus, Search, Send, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { cachePosterUrl, identifyMetadata, isCachedPosterUrl, searchMetadata } from './metadata'
import { scanFolder, type ScannedItem } from './folderScan'
import { itemPrice, validateGameTiers } from './pricing'
import { isConfigured, supabase } from './supabase'
import { categories, categoryLabel, type CatalogItem, type Category, type GameCountDiscount, type GamePriceTier, type ItemInput, type MetadataResult, type PriceRule, type SiteSettings, normalizeTitle, titleKey } from './types'

const routes: Record<Category, string> = { series: '/series', games: '/jeux-pc', anime: '/animes', novelas: '/novelas' }
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

function formatPrice(amount: number, currency: string) {
  try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount) }
  catch { return `${amount.toLocaleString('fr-FR')} ${currency}` }
}

const sourceNames: Record<string, string> = {
  tvmaze: 'TVMaze', rawg: 'RAWG', igdb: 'IGDB', steam: 'Steam', 'jikan-anime': 'MyAnimeList',
}

function sourceLabel(source: string, posterUrl: string | null) {
  if (source === 'wikipedia') return posterUrl ? 'Image : Wikimedia Commons' : 'Source : Wikipédia'
  return `Source : ${sourceNames[source] ?? source}`
}

function safeUrl(url: string | null) {
  if (!url) return undefined
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.href : undefined }
  catch { return undefined }
}

function Cover({ item, className = '' }: { item: Pick<CatalogItem, 'title' | 'poster_url' | 'category'>; className?: string }) {
  const [failed, setFailed] = useState(false)
  const image = safeUrl(item.poster_url)
  return <div className={`cover cover-${item.category} ${className}`}>
    {image && !failed ? <img src={image} alt={`Affiche de ${item.title}`} loading="lazy" onError={() => setFailed(true)} /> : <div className="cover-fallback"><span className="cover-orbit" /><strong>{item.title}</strong><small>MA LISTE / {categoryLabel(item.category).toUpperCase()}</small></div>}
  </div>
}

function App() {
  const [items, setItems] = useState<CatalogItem[]>(isConfigured ? [] : demoItems)
  const [prices, setPrices] = useState<PriceRule[]>((['series', 'anime', 'novelas'] as const).map((category) => ({ category, standard_price: null, threshold_seasons: null, threshold_price: null, currency: null })))
  const [gameTiers, setGameTiers] = useState<GamePriceTier[]>([])
  const [gameDiscount, setGameDiscount] = useState<GameCountDiscount>({ min_games: null, price_per_game: null, currency: null })
  const [settings, setSettings] = useState<SiteSettings>({ whatsapp_number: '' })
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [authReady, setAuthReady] = useState(!isConfigured)
  const [adminReady, setAdminReady] = useState(!isConfigured)
  const [loading, setLoading] = useState(isConfigured)
  const [loadError, setLoadError] = useState('')
  const [selection, setSelection] = useState<string[]>(getSelection)
  const [menuOpen, setMenuOpen] = useState(false)
  const authUserId = useRef<string | null>(null)
  const location = useLocation()

  async function refreshCatalog() {
    if (!supabase) return
    setLoading(true)
    const [itemsResult, pricesResult, tiersResult, discountResult, settingsResult] = await Promise.all([
      supabase.from('catalog_items').select('*').order('created_at', { ascending: false }),
      supabase.from('price_rules').select('category,standard_price,threshold_seasons,threshold_price,currency'),
      supabase.from('game_price_tiers').select('id,min_gb,max_gb,price,currency').order('min_gb'),
      supabase.from('game_count_discount').select('min_games,price_per_game,currency').eq('id', true).single(),
      supabase.from('site_settings').select('whatsapp_number').eq('id', true).single(),
    ])
    setLoadError(itemsResult.error?.message ?? pricesResult.error?.message ?? tiersResult.error?.message ?? discountResult.error?.message ?? settingsResult.error?.message ?? '')
    if (itemsResult.data) setItems(itemsResult.data as CatalogItem[])
    if (pricesResult.data) setPrices(pricesResult.data as PriceRule[])
    if (tiersResult.data) setGameTiers(tiersResult.data as GamePriceTier[])
    if (discountResult.data) setGameDiscount(discountResult.data as GameCountDiscount)
    if (settingsResult.data) setSettings(settingsResult.data as SiteSettings)
    setLoading(false)
  }

  useEffect(() => {
    if (!supabase) return
    void refreshCatalog()
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

  useEffect(() => { if (isAdmin) void refreshCatalog() }, [isAdmin])

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
    {loadError && <div className="error-banner">{isAdmin ? `Chargement impossible : ${loadError}` : 'Le catalogue est temporairement indisponible. Réessayez plus tard.'}</div>}

    <Routes>
      <Route path="/" element={<Navigate to="/series" replace />} />
      <Route path="/series" element={<CatalogPage category="series" items={activeItems} loading={loading} selection={selection} onToggle={toggleSelected} />} />
      <Route path="/jeux-pc" element={<CatalogPage category="games" items={activeItems} loading={loading} selection={selection} onToggle={toggleSelected} />} />
      <Route path="/animes-mangas" element={<Navigate to="/animes" replace />} />
      <Route path="/animes" element={<CatalogPage category="anime" items={activeItems} loading={loading} selection={selection} onToggle={toggleSelected} />} />
      <Route path="/novelas" element={<CatalogPage category="novelas" items={activeItems} loading={loading} selection={selection} onToggle={toggleSelected} />} />
      <Route path="/selection" element={<SelectionPage items={selectedItems} prices={prices} gameTiers={gameTiers} gameDiscount={gameDiscount} whatsappNumber={settings.whatsapp_number} onToggle={toggleSelected} />} />
      <Route path="/connexion" element={<AuthPage isAdmin={isAdmin} adminReady={adminReady} />} />
      <Route path="/admin" element={<AdminPage user={user} isAdmin={isAdmin} authReady={authReady && adminReady} items={items} prices={prices} gameTiers={gameTiers} gameDiscount={gameDiscount} settings={settings} onChanged={refreshCatalog} />} />
      <Route path="*" element={<Navigate to="/series" replace />} />
    </Routes>

    <footer className="site-footer"><div><span className="footer-brand">MA LISTE<span>.</span></span><p>Votre prochaine découverte commence ici.</p><p className="source-credit">Fiches : <a href="https://www.tvmaze.com/" target="_blank" rel="noopener noreferrer">TVMaze</a> · <a href="https://jikan.moe/" target="_blank" rel="noopener noreferrer">Jikan</a> · <a href="https://www.wikipedia.org/" target="_blank" rel="noopener noreferrer">Wikipédia</a> · <a href="https://www.igdb.com/" target="_blank" rel="noopener noreferrer">IGDB</a> · <a href="https://rawg.io/" target="_blank" rel="noopener noreferrer">RAWG</a> · <a href="https://store.steampowered.com/" target="_blank" rel="noopener noreferrer">Steam</a></p></div><div className="footer-links">{categories.map((category) => <Link key={category.key} to={routes[category.key]}>{category.label}</Link>)}</div><small>© {new Date().getFullYear()} Ma Liste</small></footer>
  </div>
}

function CatalogPage({ category, items, loading, selection, onToggle }: { category: Category; items: CatalogItem[]; loading: boolean; selection: string[]; onToggle: (id: string) => void }) {
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState('Tous les genres')
  useEffect(() => { setSearch(''); setGenre('Tous les genres') }, [category])
  const catalog = items.filter((item) => item.category === category)
  const genres = [...new Set(catalog.flatMap((item) => item.genres))].sort((a, b) => a.localeCompare(b, 'fr'))
  const filtered = catalog.filter((item) => {
    const q = normalizeTitle(search)
    return (!q || normalizeTitle(`${item.title} ${item.genres.join(' ')}`).includes(q)) && (genre === 'Tous les genres' || item.genres.includes(genre))
  })
  const intro = category === 'series' ? { eyebrow: 'LE CATALOGUE / 01', title: <>Des histoires à <em>dévorer.</em></>, copy: 'Explorez les séries disponibles, trouvez votre prochaine obsession et ajoutez-la à votre panier.', icon: <Film size={24} /> } : category === 'games' ? { eyebrow: 'LE CATALOGUE / 02', title: <>Votre prochain <em>univers.</em></>, copy: 'Des jeux PC pour chaque envie d’explorer, de gagner ou simplement de s’évader.', icon: <Gamepad2 size={24} /> } : category === 'anime' ? { eyebrow: 'LE CATALOGUE / 03', title: <>L’imaginaire sans <em>limites.</em></>, copy: 'Des animés à découvrir, collectionner et partager.', icon: <Sparkles size={24} /> } : { eyebrow: 'LE CATALOGUE / 04', title: <>Des émotions à <em>suivre.</em></>, copy: 'Découvrez les novelas disponibles et composez votre panier saison par saison.', icon: <BookOpen size={24} /> }
  return <main>
    <section className={`hero hero-${category}`}><div className="hero-inner"><div className="hero-copy"><span className="eyebrow"><span className="eyebrow-line" /> {intro.eyebrow}</span><h1>{intro.title}</h1><p>{intro.copy}</p><a className="hero-cta" href="#catalogue">Explorer la collection <ArrowRight size={18} /></a></div><div className="hero-art" aria-hidden="true"><div className="hero-ring hero-ring-one" /><div className="hero-ring hero-ring-two" /><div className="hero-symbol">{intro.icon}</div><span className="hero-spark spark-one">✦</span><span className="hero-spark spark-two">✳</span><div className="hero-art-label">CURATED<br />FOR YOU</div></div></div><div className="hero-counter"><strong>{String(catalog.length).padStart(2, '0')}</strong><span>titres dans<br />la collection</span></div></section>
    <section className="catalog-section" id="catalogue"><div className="section-heading"><div><span className="section-kicker">DÉCOUVRIR</span><h2>Toute la collection<span className="heading-period">.</span></h2><p>{catalog.length} titre{catalog.length > 1 ? 's' : ''} disponible{catalog.length > 1 ? 's' : ''}</p></div><span className="section-decoration">{categories.find((entry) => entry.key === category)?.number}</span></div>
      <div className="filters"><label className="search-field"><Search size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un titre ou un genre..." aria-label="Rechercher dans le catalogue" /></label><label className="select-field"><select value={genre} onChange={(event) => setGenre(event.target.value)} aria-label="Filtrer par genre"><option>Tous les genres</option>{genres.map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={17} /></label></div>
      {loading ? <div className="card-grid card-grid-loading" role="status" aria-busy="true" aria-label="Chargement du catalogue">{Array.from({ length: 8 }, (_, index) => <div className="media-card skeleton-card" key={index} aria-hidden="true"><span className="skeleton-cover" /><span className="skeleton-line skeleton-line-meta" /><span className="skeleton-line skeleton-line-title" /><span className="skeleton-line skeleton-line-button" /></div>)}</div> : filtered.length ? <div className="card-grid">{filtered.map((item) => <article className="media-card" key={item.id}><Cover item={item} /><div className="card-shade" /><div className="card-top"><span>{item.media_type === 'anime' ? 'ANIMÉ' : categoryLabel(item.category).toUpperCase()}</span><button className={`card-heart ${selection.includes(item.id) ? 'is-selected' : ''}`} onClick={() => onToggle(item.id)} aria-label={selection.includes(item.id) ? `Retirer ${item.title} du panier` : `Ajouter ${item.title} au panier`}><Heart size={19} fill={selection.includes(item.id) ? 'currentColor' : 'none'} /></button></div><div className="card-info"><div className="card-meta">{item.year ?? 'Année inconnue'} <span>·</span> {item.category === 'games' ? `${item.game_size_gb ?? '?'} Go` : `${item.seasons_count ?? '?'} saison(s)`} <span>·</span> {item.genres.slice(0, 2).join(' / ') || 'Genre à découvrir'}</div><h3>{item.title}</h3>{safeUrl(item.source_url) && item.source !== 'manual' && <a className="cover-credit" href={safeUrl(item.source_url)} target="_blank" rel="noopener noreferrer">{sourceLabel(item.source, item.poster_url)}</a>}<button onClick={() => onToggle(item.id)} className={`card-add ${selection.includes(item.id) ? 'added' : ''}`}>{selection.includes(item.id) ? <><Check size={16} /> Ajouté</> : <><Plus size={16} /> Ajouter à mon panier</>}</button></div></article>)}</div> : <div className="empty-state"><Search size={28} /><h3>{catalog.length ? 'Aucun résultat' : 'Le catalogue arrive bientôt'}</h3><p>{catalog.length ? 'Essayez un autre titre ou retirez un filtre.' : 'L’admin peut ajouter des titres depuis son espace.'}</p></div>}
    </section>
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
        <div><span className={`row-category row-category-${item.category}`}>{category.singular}</span><h3>{item.title}</h3><p>{pricing?.detail ?? (item.category === 'games' ? `${item.game_size_gb ?? '?'} Go` : `${item.seasons_count ?? '?'} saison(s)`)} · {item.genres.slice(0, 2).join(' · ') || 'Genre à découvrir'}</p></div>
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
        ...entries.map(({ item, pricing }, index) => `${index + 1}. ${item.title} (${pricing?.detail}) — ${formatPrice(pricing!.amount, currency!)}`),
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

function AdminPage({ user, isAdmin, authReady, items, prices, gameTiers, gameDiscount, settings, onChanged }: { user: User | null; isAdmin: boolean; authReady: boolean; items: CatalogItem[]; prices: PriceRule[]; gameTiers: GamePriceTier[]; gameDiscount: GameCountDiscount; settings: SiteSettings; onChanged: () => Promise<void> }) {
  const [tab, setTab] = useState<'catalog' | 'add' | 'bulk' | 'scan' | 'prices' | 'settings'>('catalog')
  const [category, setCategory] = useState<Category>('series')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MetadataResult[]>([])
  const [manual, setManual] = useState(false)
  const [editing, setEditing] = useState<CatalogItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [bulkResults, setBulkResults] = useState<{ query: string; result: MetadataResult | null; selected: boolean; error?: string }[]>([])
  const [scanned, setScanned] = useState<ScannedItem[]>([])
  const [scanProgress, setScanProgress] = useState('')
  const [activity, setActivity] = useState<{ label: string; completed: number; total: number } | null>(null)
  const [successToast, setSuccessToast] = useState('')
  const [currency, setCurrency] = useState(prices.find((rule) => rule.currency)?.currency ?? '')
  const [priceInputs, setPriceInputs] = useState<Record<'series' | 'anime' | 'novelas', { standard: string; threshold: string; reduced: string }>>({ series: { standard: '', threshold: '', reduced: '' }, anime: { standard: '', threshold: '', reduced: '' }, novelas: { standard: '', threshold: '', reduced: '' } })
  const [tierInputs, setTierInputs] = useState<GamePriceTier[]>(gameTiers)
  const [discountCount, setDiscountCount] = useState(String(gameDiscount.min_games ?? ''))
  const [discountPrice, setDiscountPrice] = useState(String(gameDiscount.price_per_game ?? ''))
  const [whatsappInput, setWhatsappInput] = useState(settings.whatsapp_number ? `+${settings.whatsapp_number}` : '')
  const [filter, setFilter] = useState<Category | 'all'>('all')
  useEffect(() => { setCurrency(prices.find((rule) => rule.currency)?.currency ?? gameTiers[0]?.currency ?? gameDiscount.currency ?? ''); setPriceInputs(Object.fromEntries((['series', 'anime', 'novelas'] as const).map((category) => { const rule = prices.find((entry) => entry.category === category); return [category, { standard: String(rule?.standard_price ?? ''), threshold: String(rule?.threshold_seasons ?? ''), reduced: String(rule?.threshold_price ?? '') }] })) as typeof priceInputs); setTierInputs(gameTiers); setDiscountCount(String(gameDiscount.min_games ?? '')); setDiscountPrice(String(gameDiscount.price_per_game ?? '')) }, [prices, gameTiers, gameDiscount])
  useEffect(() => { setWhatsappInput(settings.whatsapp_number ? `+${settings.whatsapp_number}` : '') }, [settings.whatsapp_number])
  useEffect(() => {
    if (!successToast) return
    const timeout = window.setTimeout(() => setSuccessToast(''), 6000)
    return () => window.clearTimeout(timeout)
  }, [successToast])
  function showSuccess(text: string) { setMessage(''); setSuccessToast(text) }
  if (!isConfigured) return <main className="interior-page"><div className="page-intro"><span className="section-kicker">ADMINISTRATION</span><h1>Espace admin<span className="heading-period">.</span></h1><p>Connectez Supabase pour activer la gestion sécurisée du catalogue.</p></div><div className="setup-card"><LockKeyhole size={28} /><h2>Configuration en attente</h2><p>Les accès et les données seront disponibles après la création du projet Supabase. Consultez le guide du projet pour les étapes.</p></div></main>
  if (!authReady) return <main className="interior-page"><div className="empty-state" role="status"><LoaderCircle className="admin-operation-spinner" size={30} aria-hidden="true" /><h3>Vérification de la session…</h3></div></main>
  if (!user || !isAdmin) return <Navigate to="/connexion" replace />

  async function saveItem(input: ItemInput, id?: string, refresh = true) {
    if (!supabase) return
    const clean = { ...input, title: input.title.trim(), title_key: titleKey(input.category, input.media_type, input.title), poster_url: await cachePosterUrl(safeUrl(input.poster_url) ?? null), source_url: safeUrl(input.source_url) ?? null, seasons_count: input.category === 'games' ? null : input.seasons_count, game_size_gb: input.category === 'games' ? input.game_size_gb : null }
    if (!clean.title) throw new Error('Le titre est obligatoire.')
    const duplicate = items.find((item) => item.id !== id && (item.title_key === clean.title_key || (clean.source_id && item.category === clean.category && item.source === clean.source && item.source_id === clean.source_id)))
    const target = id ?? duplicate?.id
    const existing = items.find((item) => item.id === target)
    const payload = { ...clean, seasons_count: !id ? clean.seasons_count ?? existing?.seasons_count ?? null : clean.seasons_count, game_size_gb: !id ? clean.game_size_gb ?? existing?.game_size_gb ?? null : clean.game_size_gb }
    const response = target ? await supabase.from('catalog_items').update(payload).eq('id', target).select('id').single() : await supabase.from('catalog_items').insert(payload).select('id').single()
    if (response.error) throw response.error
    if (refresh) {
      await onChanged()
      showSuccess(target ? 'Fiche mise à jour sans doublon.' : 'Titre ajouté au catalogue.')
      setEditing(null); setManual(false)
    }
  }
  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(''); setResults([])
    try { setResults(await searchMetadata(query, category, category === 'anime' ? 'anime' : null)) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Recherche impossible.') }
    finally { setBusy(false) }
  }
  async function removeItem(item: CatalogItem) {
    if (!supabase || !window.confirm(`Supprimer « ${item.title} » du catalogue ?`)) return
    const { error } = await supabase.from('catalog_items').delete().eq('id', item.id)
    if (error) setMessage(error.message); else { await onChanged(); showSuccess('Titre supprimé.') }
  }
  async function toggleActive(item: CatalogItem) {
    if (!supabase) return
    const { error } = await supabase.from('catalog_items').update({ active: !item.active }).eq('id', item.id)
    if (error) setMessage(error.message); else { await onChanged(); showSuccess(item.active ? 'Titre masqué.' : 'Titre publié.') }
  }
  async function cacheExistingPosters() {
    if (!supabase) return
    const client = supabase
    const candidates = items.filter((item) => item.poster_url && !isCachedPosterUrl(item.poster_url))
    if (!candidates.length) { showSuccess('Toutes les affiches disponibles sont déjà conservées.'); return }
    setBusy(true); setMessage(''); setSuccessToast('')
    setActivity({ label: 'Conservation des affiches', completed: 0, total: candidates.length })
    let saved = 0; let unavailable = 0
    try {
      for (let start = 0; start < candidates.length; start += 4) {
        await Promise.all(candidates.slice(start, start + 4).map(async (item) => {
          const cached = await cachePosterUrl(item.poster_url)
          if (!cached || !isCachedPosterUrl(cached)) { unavailable++; return }
          const { error } = await client.from('catalog_items').update({ poster_url: cached }).eq('id', item.id)
          if (error) unavailable++; else saved++
        }))
        setActivity({ label: 'Conservation des affiches', completed: Math.min(start + 4, candidates.length), total: candidates.length })
      }
      setActivity({ label: 'Actualisation du catalogue', completed: 0, total: 0 })
      await onChanged()
      if (unavailable) setMessage(`${saved} affiche(s) conservée(s). ${unavailable} source(s) n’ont pas pu être copiées ; leurs liens d’origine restent visibles.`)
      else showSuccess(`${saved} affiche(s) conservée(s) dans Supabase.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Conservation des affiches impossible.')
    } finally {
      setActivity(null); setBusy(false)
    }
  }
  async function enrichExistingItems() {
    if (!supabase) return
    const client = supabase
    const candidates = items.filter((item) => (filter === 'all' || item.category === filter) && (!item.poster_url || !item.genres.length))
    if (!candidates.length) { showSuccess('Toutes les fiches de cette catégorie ont déjà une affiche et des genres.'); return }
    setBusy(true); setMessage(''); setSuccessToast('')
    let updated = 0; let stored = 0; let missing = 0
    try {
      for (let start = 0; start < candidates.length; start += 3) {
        setActivity({ label: 'Recherche des affiches et genres', completed: start, total: candidates.length })
        await Promise.all(candidates.slice(start, start + 3).map(async (item) => {
          try {
            const results = await searchMetadata(item.title, item.category, item.media_type)
            const match = results.find((entry) => entry.match === 'exact')
            if (!match || (!match.poster_url && !match.genres.length)) { missing++; return }
            const poster = item.poster_url ?? await cachePosterUrl(safeUrl(match.poster_url) ?? null)
            const changes = {
              poster_url: poster,
              genres: item.genres.length ? item.genres : match.genres,
              synopsis: item.synopsis ?? match.synopsis,
              year: item.year ?? match.year,
              source: item.source === 'scan' || item.source === 'manual' ? match.source : item.source,
              source_id: item.source_id ?? match.source_id,
              source_url: item.source_url ?? safeUrl(match.source_url),
            }
            const { error } = await client.from('catalog_items').update(changes).eq('id', item.id)
            if (error) { missing++; return }
            updated++
            if (poster && isCachedPosterUrl(poster) && !isCachedPosterUrl(item.poster_url)) stored++
          } catch { missing++ }
        }))
        setActivity({ label: 'Recherche des affiches et genres', completed: Math.min(start + 3, candidates.length), total: candidates.length })
      }
      setActivity({ label: 'Actualisation du catalogue', completed: 0, total: 0 })
      await onChanged()
      const summary = `${updated} fiche(s) enrichie(s), ${stored} affiche(s) conservée(s) ; ${missing} sans nouvelle fiche exploitable.`
      if (missing) setMessage(summary); else showSuccess(summary)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Enrichissement impossible.')
    } finally {
      setActivity(null); setBusy(false)
    }
  }
  async function previewBulk() {
    setBusy(true); setMessage(''); setBulkResults([])
    const lines = [...new Set(bulkText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].slice(0, 30)
    setActivity({ label: 'Recherche des fiches', completed: 0, total: lines.length })
    const preview: { query: string; result: MetadataResult | null; selected: boolean; error?: string }[] = []
    type SearchResult = { line: string; matches: MetadataResult[]; error?: string }
    async function find(line: string): Promise<SearchResult> {
      try { return { line, matches: await searchMetadata(line, category, category === 'anime' ? 'anime' : null) } }
      catch (error) { return { line, matches: [], error: error instanceof Error ? error.message : 'Erreur de recherche' } }
    }
    function append(results: SearchResult[]) {
      for (const { line, matches, error } of results) {
        const best = matches.find((entry) => entry.match === 'exact') ?? matches[0] ?? null
        const alreadyThere = best && items.some((item) => item.title_key === best.title_key || (item.category === best.category && item.source === best.source && item.source_id === best.source_id))
        const repeatedInImport = best && preview.some((entry) => entry.result?.title_key === best.title_key || (entry.result?.category === best.category && entry.result?.source === best.source && entry.result?.source_id === best.source_id))
        preview.push({ query: line, result: best, selected: Boolean(best && best.match === 'exact' && !alreadyThere && !repeatedInImport), error: error ?? (repeatedInImport ? 'Déjà proposé dans cet import' : alreadyThere ? 'Déjà présent — sera mis à jour si coché' : undefined) })
      }
      setBulkResults([...preview])
      setActivity({ label: 'Recherche des fiches', completed: preview.length, total: lines.length })
    }
    let start = 0
    if (category === 'games' && lines.length) {
      const first = await find(lines[0])
      append([first]); start = 1
      if (first.error) {
        append(lines.slice(1).map((line) => ({ line, matches: [], error: 'Recherche des jeux indisponible pour le moment.' })))
        setBusy(false); setActivity(null); return
      }
    }
    const concurrency = category === 'anime' ? 1 : 4
    for (; start < lines.length; start += concurrency) {
      append(await Promise.all(lines.slice(start, start + concurrency).map(find)))
      if (category === 'anime') await new Promise((resolve) => setTimeout(resolve, 400))
    }
    setBusy(false); setActivity(null)
  }
  async function importBulk() {
    setBusy(true); setMessage('')
    let done = 0; let failed = 0
    const selected = bulkResults.filter((entry) => entry.selected && entry.result)
    setActivity({ label: 'Enregistrement des fiches', completed: 0, total: selected.length })
    try {
    for (let start = 0; start < selected.length; start += 4) {
      const results = await Promise.allSettled(selected.slice(start, start + 4).map((row) => saveItem(row.result!, undefined, false)))
      done += results.filter((result) => result.status === 'fulfilled').length
      failed += results.filter((result) => result.status === 'rejected').length
      setActivity({ label: 'Enregistrement des fiches', completed: Math.min(start + 4, selected.length), total: selected.length })
    }
    setActivity({ label: 'Actualisation du catalogue', completed: 0, total: 0 })
    await onChanged()
    const summary = `${done} fiche${done > 1 ? 's' : ''} enregistrée${done > 1 ? 's' : ''}${failed ? `, ${failed} erreur${failed > 1 ? 's' : ''}` : ''}.`
    if (failed) setMessage(summary); else showSuccess(summary)
    setBulkResults([])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import impossible. Réessayez après avoir vérifié votre connexion.')
    } finally {
      setBusy(false); setActivity(null)
    }
  }
  async function scanSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files?.length) return
    setBusy(true); setMessage(''); setScanProgress('')
    setActivity({ label: 'Analyse du dossier', completed: 0, total: 0 })
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())))
    try {
      const found = scanFolder(files)
      setScanned(found)
      setScanProgress(`${files.length} fichier(s) analysé(s) · ${found.filter((row) => row.selected).length} titre(s) prêt(s). Vérifiez les catégories et mesures avant l’import.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Analyse du dossier impossible.')
    } finally {
      setActivity(null); setBusy(false)
    }
    event.target.value = ''
  }
  function toggleScanned(index: number, selected: boolean) {
    setScanned((current) => {
      const clicked = current[index]
      if (!clicked) return current
      return current.map((item, itemIndex) => {
        if (itemIndex === index) return { ...item, selected }
        if (selected && clicked.parentId && item.id === clicked.parentId) return { ...item, selected: false }
        if (selected && !clicked.parentId && item.parentId === clicked.id) return { ...item, selected: false }
        return item
      })
    })
  }
  async function importScanned() {
    const invalid = scanned.filter((row) => row.selected).find((row) => !row.title.trim() || (row.category === 'games' ? !row.game_size_gb || row.game_size_gb <= 0 : !Number.isInteger(row.seasons_count) || Number(row.seasons_count) < 1))
    if (invalid) { setMessage(`Corrigez le titre et la mesure de « ${invalid.title || 'titre sans nom'} » avant l’import.`); return }
    if (!supabase) return
    setBusy(true); setMessage(''); setScanProgress(''); setSuccessToast('')
    let done = 0; let failed = 0; let enriched = 0; let firstError = ''
    try {
    const seen = new Set<string>()
    const rows = scanned.filter((row) => {
      if (!row.selected) return false
      const key = titleKey(row.category, row.media_type, row.title)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const prepared: ItemInput[] = []
    const metadataByKey = new Map<string, MetadataResult | null>()
    const existingByKey = new Map(items.map((item) => [item.title_key, item]))
    const needsLookup = (row: ScannedItem) => {
      const existing = existingByKey.get(titleKey(row.category, row.media_type, row.title))
      return !(existing?.poster_url && existing.genres.length)
    }
    const lookup = async (row: ScannedItem) => {
      const key = titleKey(row.category, row.media_type, row.title)
      try {
        const identified = row.auto_category && row.category !== 'games' ? await identifyMetadata(row.title, row.category) : null
        const results = identified ? [identified] : await searchMetadata(row.title, row.category, row.media_type)
        metadataByKey.set(key, results.find((entry) => entry.match === 'exact') ?? null)
        return true
      } catch {
        metadataByKey.set(key, null)
        return false
      }
    }
    let gameLookupAvailable = true
    const games = rows.filter((row) => row.category === 'games' && needsLookup(row))
    if (games.length) {
      setActivity({ label: 'Recherche des affiches des jeux', completed: 0, total: games.length })
      gameLookupAvailable = await lookup(games[0])
      setActivity({ label: 'Recherche des affiches des jeux', completed: 1, total: games.length })
      for (let start = 1; gameLookupAvailable && start < games.length; start += 4) {
        const results = await Promise.all(games.slice(start, start + 4).map(lookup))
        setActivity({ label: 'Recherche des affiches des jeux', completed: Math.min(start + 4, games.length), total: games.length })
        if (results.every((success) => !success)) gameLookupAvailable = false
      }
    }
    const series = rows.filter((row) => row.category === 'series' && needsLookup(row))
    if (series.length) setActivity({ label: 'Recherche des affiches des séries', completed: 0, total: series.length })
    for (let start = 0; start < series.length; start += 4) {
      await Promise.all(series.slice(start, start + 4).map(lookup))
      setActivity({ label: 'Recherche des affiches des séries', completed: Math.min(start + 4, series.length), total: series.length })
    }
    const novelas = rows.filter((row) => row.category === 'novelas' && needsLookup(row))
    if (novelas.length) setActivity({ label: 'Recherche des affiches des novelas', completed: 0, total: novelas.length })
    for (let start = 0; start < novelas.length; start += 4) {
      await Promise.all(novelas.slice(start, start + 4).map(lookup))
      setActivity({ label: 'Recherche des affiches des novelas', completed: Math.min(start + 4, novelas.length), total: novelas.length })
    }
    const animes = rows.filter((row) => row.category === 'anime' && needsLookup(row))
    if (animes.length) setActivity({ label: 'Recherche des affiches des animés', completed: 0, total: animes.length })
    for (const [index, row] of animes.entries()) {
      await lookup(row)
      setActivity({ label: 'Recherche des affiches des animés', completed: index + 1, total: animes.length })
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    const preparedKeys = new Set<string>()
    const preparedSources = new Set<string>()
    for (const row of rows) {
      const key = titleKey(row.category, row.media_type, row.title)
      const metadata = metadataByKey.get(key) ?? null
      const resolvedCategory = metadata?.category ?? row.category
      const resolvedMediaType = resolvedCategory === 'anime' ? 'anime' : null
      const byTitle = existingByKey.get(titleKey(resolvedCategory, resolvedMediaType, metadata?.title ?? row.title))
      const existing = byTitle ?? (metadata?.source_id ? items.find((item) => item.category === resolvedCategory && item.source === metadata.source && item.source_id === metadata.source_id) : undefined)
      const title = existing?.title ?? metadata?.title ?? row.title
      const input: ItemInput = {
        category: resolvedCategory, media_type: resolvedMediaType,
        title, title_key: existing?.title_key ?? titleKey(resolvedCategory, resolvedMediaType, title),
        synopsis: metadata?.synopsis ?? existing?.synopsis ?? null,
        poster_url: safeUrl(metadata?.poster_url ?? existing?.poster_url ?? null) ?? null,
        genres: metadata?.genres.length ? metadata.genres : existing?.genres ?? [],
        year: metadata?.year ?? existing?.year ?? null,
        source: metadata?.source ?? existing?.source ?? 'scan',
        source_id: metadata?.source_id ?? existing?.source_id ?? null,
        source_url: safeUrl(metadata?.source_url ?? existing?.source_url ?? null) ?? null,
        active: existing?.active ?? true,
        seasons_count: resolvedCategory === 'games' ? null : row.warning?.includes('Saison non indiquée') ? existing?.seasons_count ?? row.seasons_count : row.seasons_count,
        game_size_gb: resolvedCategory === 'games' ? row.game_size_gb : null,
      }
      const sourceKey = input.source_id ? `${input.category}:${input.source}:${input.source_id}` : null
      if (preparedKeys.has(input.title_key) || (sourceKey && preparedSources.has(sourceKey))) continue
      preparedKeys.add(input.title_key)
      if (sourceKey) preparedSources.add(sourceKey)
      prepared.push(input)
      if (metadata) enriched++
    }
    const posters = [...new Set(prepared.map((input) => input.poster_url).filter((url): url is string => Boolean(url && !isCachedPosterUrl(url))))]
    const cachedPosters = new Map<string, string>()
    if (posters.length) setActivity({ label: 'Conservation des affiches', completed: 0, total: posters.length })
    for (let start = 0; start < posters.length; start += 4) {
      const batch = posters.slice(start, start + 4)
      await Promise.all(batch.map(async (url) => cachedPosters.set(url, (await cachePosterUrl(url)) ?? url)))
      setActivity({ label: 'Conservation des affiches', completed: start + batch.length, total: posters.length })
    }
    const storedPosters = [...cachedPosters.values()].filter(isCachedPosterUrl).length
    for (const input of prepared) if (input.poster_url) input.poster_url = cachedPosters.get(input.poster_url) ?? input.poster_url
    setActivity({ label: 'Enregistrement des titres', completed: 0, total: prepared.length })
    for (let start = 0; start < prepared.length; start += 40) {
      const chunk = prepared.slice(start, start + 40)
      const { error } = await supabase.from('catalog_items').upsert(chunk, { onConflict: 'title_key' })
      if (!error) { done += chunk.length; setActivity({ label: 'Enregistrement des titres', completed: start + chunk.length, total: prepared.length }); continue }
      firstError ||= error.message
      if (!/^(22|23)/.test(error.code ?? '')) { failed += chunk.length; setActivity({ label: 'Enregistrement des titres', completed: start + chunk.length, total: prepared.length }); continue }
      // Une fiche incorrecte ne doit pas faire perdre tout le lot.
      for (const [index, input] of chunk.entries()) {
        const result = await supabase.from('catalog_items').upsert(input, { onConflict: 'title_key' })
        if (result.error) { failed++; firstError ||= result.error.message }
        else done++
        setActivity({ label: 'Enregistrement des titres', completed: start + index + 1, total: prepared.length })
      }
    }
    setActivity({ label: 'Actualisation du catalogue', completed: 0, total: 0 })
    await onChanged()
    setScanned([])
    const summary = `${done} titre(s) importé(s), dont ${enriched} fiche(s) enrichie(s) et ${storedPosters} affiche(s) conservée(s) ; ${failed} échec(s).${firstError && failed ? ` Erreur : ${firstError}` : ''}${posters.length > storedPosters ? ` ${posters.length - storedPosters} affiche(s) utilisent encore leur lien d’origine.` : ''}${!gameLookupAvailable ? ' Recherche des affiches des jeux indisponible pour le moment.' : ''}`
    if (failed) setMessage(summary); else showSuccess(summary)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import impossible. Réessayez après avoir vérifié votre connexion.')
    } finally {
      setActivity(null); setBusy(false)
    }
  }
  async function savePrices(event: FormEvent) {
    event.preventDefault(); if (!supabase) return
    const code = currency.trim().toUpperCase()
    const hasPrice = Object.values(priceInputs).some((entry) => entry.standard !== '' || entry.threshold !== '' || entry.reduced !== '') || tierInputs.length > 0 || discountCount !== '' || discountPrice !== ''
    if (hasPrice && !/^[A-Z]{3}$/.test(code)) { setMessage('Indiquez un code devise de 3 lettres, par exemple EUR ou XOF.'); return }
    const tierError = validateGameTiers(tierInputs)
    if (tierError) { setMessage(tierError); return }
    if ((discountCount === '') !== (discountPrice === '') || (discountCount !== '' && (!Number.isInteger(Number(discountCount)) || Number(discountCount) < 2 || !Number.isFinite(Number(discountPrice)) || Number(discountPrice) < 0))) { setMessage('La remise jeux exige un nombre entier d’au moins 2 jeux et un prix par jeu valide.'); return }
    for (const entry of Object.values(priceInputs)) {
      if (entry.standard !== '' && (Number(entry.standard) < 0 || !Number.isFinite(Number(entry.standard)))) { setMessage('Les prix doivent être positifs.'); return }
      if (((entry.threshold === '') !== (entry.reduced === ''))) { setMessage('Renseignez le seuil de saisons et son prix ensemble.'); return }
      if (entry.threshold !== '' && (!Number.isInteger(Number(entry.threshold)) || Number(entry.threshold) < 2 || Number(entry.reduced) < 0 || entry.standard === '')) { setMessage('Le palier saisons doit commencer à 2 saisons et avoir un prix valide.'); return }
      if (entry.reduced !== '' && Number(entry.reduced) > Number(entry.standard)) { setMessage('Le prix réduit par saison ne peut pas dépasser le prix standard.'); return }
    }
    setBusy(true); setMessage('')
    for (const category of ['series', 'anime', 'novelas'] as const) {
      const entry = priceInputs[category]
      const { error } = await supabase.from('price_rules').update({ standard_price: entry.standard === '' ? null : Number(entry.standard), threshold_seasons: entry.threshold === '' ? null : Number(entry.threshold), threshold_price: entry.reduced === '' ? null : Number(entry.reduced), currency: entry.standard === '' ? null : code }).eq('category', category)
      if (error) { setMessage(error.message); setBusy(false); return }
    }
    for (const old of gameTiers) {
      if (old.id && !tierInputs.some((entry) => entry.id === old.id)) {
        const { error } = await supabase.from('game_price_tiers').delete().eq('id', old.id)
        if (error) { setMessage(error.message); setBusy(false); return }
      }
    }
    for (const tier of tierInputs) {
      const values = { min_gb: tier.min_gb, max_gb: tier.max_gb, price: tier.price, currency: code }
      const response = tier.id ? await supabase.from('game_price_tiers').update(values).eq('id', tier.id) : await supabase.from('game_price_tiers').insert(values)
      if (response.error) { setMessage(response.error.message); setBusy(false); return }
    }
    const { error: discountError } = await supabase.from('game_count_discount').update({ min_games: discountCount === '' ? null : Number(discountCount), price_per_game: discountPrice === '' ? null : Number(discountPrice), currency: discountPrice === '' ? null : code }).eq('id', true)
    if (discountError) { setMessage(discountError.message); setBusy(false); return }
    await onChanged(); showSuccess('Grille des prix enregistrée.'); setBusy(false)
  }
  async function saveSettings(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const input = whatsappInput.trim()
    if (input && !/^\+?[1-9]\d{7,14}$/.test(input)) { setMessage('Indiquez un numéro international de 8 à 15 chiffres, avec ou sans +.'); return }
    setBusy(true); setMessage('')
    const { error } = await supabase.from('site_settings').update({ whatsapp_number: input.replace(/^\+/, '') }).eq('id', true).select('whatsapp_number').single()
    if (error) { setMessage(error.message); setBusy(false); return }
    await onChanged(); showSuccess('Numéro WhatsApp enregistré.'); setBusy(false)
  }
  return <main className="interior-page admin-page">
    {(activity || busy) && <div className="admin-operation" role="status" aria-live="polite">
      <LoaderCircle className="admin-operation-spinner" size={22} aria-hidden="true" />
      <div className="admin-operation-content">
        <strong>{activity?.label ?? 'Traitement en cours'}</strong>
        <span>{activity?.total ? `${activity.completed} / ${activity.total} traité(s)` : 'Veuillez patienter…'}</span>
        {activity?.total ? <progress value={activity.completed} max={activity.total} /> : <progress />}
      </div>
    </div>}
    {successToast && <div className="admin-toast" role="status" aria-live="polite">
      <Check size={20} aria-hidden="true" />
      <span>{successToast}</span>
      <button type="button" aria-label="Fermer la notification" onClick={() => setSuccessToast('')}><X size={16} /></button>
    </div>}<div className="page-intro"><span className="section-kicker">VOTRE ESPACE PRIVÉ</span><h1>Tableau de bord<span className="heading-period">.</span></h1><p>Gérez vos listes, leurs affiches et les tarifs.</p></div><div className="admin-stats">{categories.map((entry) => <div key={entry.key}><span>{entry.label}</span><strong>{items.filter((item) => item.category === entry.key).length}</strong></div>)}<div><span>Total titres</span><strong>{items.length}</strong></div></div><div className="admin-tabs" role="tablist">{([['catalog', 'Catalogue'], ['add', 'Ajouter un titre'], ['bulk', 'Import en liste'], ['scan', 'Scanner un dossier'], ['prices', 'Prix'], ['settings', 'WhatsApp']] as const).map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setMessage('') }}>{label}</button>)}</div>{message && <p className="admin-message" role="status">{message}</p>}
    {tab === 'catalog' && <section className="admin-panel"><div className="admin-panel-head"><h2>Titres enregistrés</h2><button className="button-secondary" disabled={busy || !items.some((item) => (filter === 'all' || item.category === filter) && (!item.poster_url || !item.genres.length))} onClick={() => void enrichExistingItems()}>Rechercher les affiches et genres manquants</button><button className="button-secondary" disabled={busy || !items.some((item) => item.poster_url && !isCachedPosterUrl(item.poster_url))} onClick={() => void cacheExistingPosters()}>Conserver les affiches existantes</button><label className="select-field"><select value={filter} onChange={(event) => setFilter(event.target.value as Category | 'all')}><option value="all">Toutes les catégories</option>{categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select><ChevronDown size={17} /></label></div><div className="admin-list">{items.filter((item) => filter === 'all' || item.category === filter).map((item) => <div className="admin-row" key={item.id}><Cover item={item} /><div className="admin-row-title"><strong>{item.title}</strong><span>{categoryLabel(item.category)} · {item.category === 'games' ? `${item.game_size_gb ?? '?'} Go` : `${item.seasons_count ?? '?'} saison(s)`} · {item.genres.join(', ') || 'Sans genre'} · {item.active ? 'Publié' : 'Masqué'}</span></div><div className="admin-row-actions"><button onClick={() => { setEditing(item); setTab('add'); setManual(true) }}>Modifier</button><button onClick={() => void toggleActive(item)}>{item.active ? 'Masquer' : 'Publier'}</button><button className="danger-text" aria-label={`Supprimer ${item.title}`} onClick={() => void removeItem(item)}><Trash2 size={17} /></button></div></div>)}{!items.length && <p className="empty-admin">Aucun titre pour le moment. Ajoutez votre premier élément.</p>}</div></section>}
    {tab === 'add' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>{editing ? 'Modifier la fiche' : 'Ajouter un titre'}</h2><p>Recherchez une fiche pour récupérer son affiche et ses genres, ou remplissez-la à la main.</p></div></div>{!editing && <><div className="admin-chooser"><label>Catégorie<select value={category} onChange={(event) => { setCategory(event.target.value as Category); setResults([]) }}>{categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label></div><form className="admin-search" onSubmit={search}><label className="search-field"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom de la série, du jeu, de l’animé ou de la novela..." required minLength={2} /></label><button className="button-primary" disabled={busy}>{busy ? 'Recherche…' : 'Rechercher'} <ArrowRight size={17} /></button></form><button className="text-button" onClick={() => { setManual(!manual); setResults([]) }}>{manual ? 'Fermer la saisie manuelle' : 'Saisir une fiche manuellement'}</button></>}{results.length > 0 && <div className="metadata-results">{results.map((result) => { const exists = items.some((item) => item.title_key === result.title_key || (item.category === result.category && item.source === result.source && item.source_id === result.source_id)); return <div className="metadata-row" key={`${result.source}-${result.source_id}`}><Cover item={result} /><div><strong>{result.title}</strong><span>{result.year ?? '—'} · {result.genres.slice(0, 3).join(', ') || 'Genre inconnu'}</span>{exists && <small>Déjà dans la liste : les informations seront actualisées.</small>}</div><button onClick={() => { setBusy(true); void saveItem(result).catch((error) => setMessage(error instanceof Error ? error.message : 'Erreur')).finally(() => setBusy(false)) }} disabled={busy}>{exists ? 'Mettre à jour' : 'Ajouter'} <Plus size={16} /></button></div> })}</div>}{(manual || editing) && <ManualForm initial={editing} category={category} busy={busy} onCancel={() => { setManual(false); setEditing(null) }} onSave={async (input) => { setBusy(true); try { await saveItem(input, editing?.id) } catch (error) { setMessage(error instanceof Error ? error.message : 'Enregistrement impossible.') } finally { setBusy(false) } }} />}</section>}
    {tab === 'bulk' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>Importer une liste</h2><p>Un titre par ligne, jusqu’à 30. Vérifiez les correspondances avant l’ajout.</p></div></div><div className="admin-chooser"><label>Catégorie<select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label></div><textarea className="bulk-textarea" value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder={'Breaking Bad\nThe Last of Us\nDark'} rows={7} /><div className="bulk-actions"><button className="button-primary" onClick={() => void previewBulk()} disabled={busy || !bulkText.trim()}>{busy ? 'Recherche en cours…' : 'Prévisualiser les fiches'} <Search size={17} /></button></div>{bulkResults.length > 0 && <div className="bulk-preview"><h3>Vérification avant import</h3>{bulkResults.map((row, index) => <label className="bulk-row" key={`${row.query}-${index}`}><input type="checkbox" checked={row.selected} disabled={!row.result} onChange={(event) => setBulkResults((current) => current.map((entry, i) => i === index ? { ...entry, selected: event.target.checked } : entry))} /><span><strong>{row.query}</strong><small>{row.result ? `→ ${row.result.title} · ${row.result.match === 'exact' ? 'Correspondance exacte' : 'À vérifier'}${row.error ? ` · ${row.error}` : ''}` : row.error ?? 'Aucun résultat'}</small></span></label>)}<button className="button-primary" onClick={() => void importBulk()} disabled={busy || !bulkResults.some((row) => row.selected)}>Enregistrer les fiches cochées <ArrowRight size={17} /></button></div>}</section>}
    {tab === 'scan' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>Scanner un dossier</h2><p>Choisissez un dossier ou la racine d’un disque. Seuls les noms, tailles et chemins relatifs sont analysés localement ; aucun fichier n’est téléversé.</p></div></div><label className="scan-picker">Choisir un dossier<input type="file" multiple {...{ webkitdirectory: '' }} onChange={scanSelected} disabled={busy} /></label><p className="scan-help">La catégorie et les saisons sont déduites des noms. Vérifiez chaque ligne ; les jeux utilisent la taille totale des fichiers détectés. Les dossiers de franchise contenant plusieurs jeux sont séparés en fiches individuelles. Les fiches externes sont recherchées à l’import.</p>{scanProgress && <p className="admin-message" role="status">{scanProgress}</p>}{scanned.length > 0 && <div className="scan-list">{scanned.map((row, index) => <div className="scan-row" key={row.id}><label className="scan-check"><input type="checkbox" checked={row.selected} onChange={(event) => toggleScanned(index, event.target.checked)} /> Importer</label><label>Titre<input value={row.title} onChange={(event) => setScanned((current) => current.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} /></label><label>Catégorie<select value={row.category} onChange={(event) => setScanned((current) => current.map((item, i) => i === index ? { ...item, category: event.target.value as Category, auto_category: false, media_type: event.target.value === 'anime' ? 'anime' : null, seasons_count: event.target.value === 'games' ? null : item.seasons_count ?? 1, game_size_gb: event.target.value === 'games' ? item.game_size_gb ?? 0.01 : null } : item))}>{categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>{row.category === 'games' ? <label>Taille (Go)<input type="number" min="0.01" step="0.01" value={row.game_size_gb ?? ''} onChange={(event) => setScanned((current) => current.map((item, i) => i === index ? { ...item, game_size_gb: Number(event.target.value) } : item))} /></label> : <label>Saisons<input type="number" min="1" step="1" value={row.seasons_count ?? ''} onChange={(event) => setScanned((current) => current.map((item, i) => i === index ? { ...item, seasons_count: Number(event.target.value) } : item))} /></label>}<small>{row.file_count} fichier(s) · {row.path}{row.warning ? ` · ${row.warning}` : ''}</small></div>)}<button className="button-primary" disabled={busy || !scanned.some((row) => row.selected)} onClick={() => void importScanned()}>Importer les titres cochés <ArrowRight size={17} /></button></div>}</section>}
    {tab === 'prices' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>Grille des prix</h2><p>Séries et animés partagent un total de saisons pour leurs remises. Les novelas ont leur propre prix et leur propre seuil, calculé uniquement sur les saisons de novelas du panier.</p></div></div><form onSubmit={savePrices} className="price-form"><label>Devise commune (code ISO à 3 lettres)<input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))} placeholder="EUR, XOF, NGN..." maxLength={3} /></label>{(['series', 'anime', 'novelas'] as const).map((category) => <div className="price-group" key={category}><h3>{category === 'series' ? 'Séries' : category === 'anime' ? 'Animés' : 'Novelas'}</h3><div className="price-grid"><label>Prix standard par saison<input type="number" min="0" step="0.01" value={priceInputs[category].standard} onChange={(event) => setPriceInputs((current) => ({ ...current, [category]: { ...current[category], standard: event.target.value } }))} placeholder="Non défini" /></label><label>Seuil total de saisons du panier<input type="number" min="2" step="1" value={priceInputs[category].threshold} onChange={(event) => setPriceInputs((current) => ({ ...current, [category]: { ...current[category], threshold: event.target.value } }))} placeholder="Ex. 3" /></label><label>Prix par saison dès ce seuil<input type="number" min="0" step="0.01" value={priceInputs[category].reduced} onChange={(event) => setPriceInputs((current) => ({ ...current, [category]: { ...current[category], reduced: event.target.value } }))} placeholder="Ex. 800" /></label></div></div>)}<div className="price-group"><h3>Jeux PC · paliers de taille</h3><p>La taille est arrondie au Go supérieur pour choisir le palier. Exemple : 49,2 Go entre dans le palier 50–100 Go.</p>{tierInputs.map((tier, index) => <div className="tier-row" key={tier.id ?? index}><label>De (Go)<input type="number" min="1" step="1" value={tier.min_gb} onChange={(event) => setTierInputs((current) => current.map((item, i) => i === index ? { ...item, min_gb: Number(event.target.value) } : item))} /></label><label>À (Go)<input type="number" min="1" step="1" value={tier.max_gb} onChange={(event) => setTierInputs((current) => current.map((item, i) => i === index ? { ...item, max_gb: Number(event.target.value) } : item))} /></label><label>Prix<input type="number" min="0" step="0.01" value={tier.price} onChange={(event) => setTierInputs((current) => current.map((item, i) => i === index ? { ...item, price: Number(event.target.value) } : item))} /></label><button type="button" className="button-secondary" onClick={() => setTierInputs((current) => current.filter((_, i) => i !== index))}>Retirer</button></div>)}<button type="button" className="button-secondary" onClick={() => setTierInputs((current) => [...current, { min_gb: (current.at(-1)?.max_gb ?? 0) + 1, max_gb: (current.at(-1)?.max_gb ?? 0) + 50, price: 0, currency }])}>Ajouter un palier</button></div><div className="price-group"><h3>Remise selon le nombre de jeux</h3><p>Dès que le panier contient ce nombre de jeux, chaque jeu prend le prix fixe indiqué, quel que soit son palier de taille.</p><div className="price-grid"><label>Nombre de jeux requis<input type="number" min="2" step="1" value={discountCount} onChange={(event) => setDiscountCount(event.target.value)} placeholder="Ex. 3" /></label><label>Prix par jeu à partir de ce nombre<input type="number" min="0" step="0.01" value={discountPrice} onChange={(event) => setDiscountPrice(event.target.value)} placeholder="Non défini" /></label></div></div><button className="button-primary" disabled={busy}>Enregistrer les prix <Check size={17} /></button></form></section>}
    {tab === 'settings' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>Réception WhatsApp</h2><p>Ce numéro recevra les paniers envoyés par les visiteurs. Vous pouvez le modifier ici à tout moment.</p></div></div><form onSubmit={saveSettings} className="price-form"><label>Numéro international<input type="tel" inputMode="tel" autoComplete="tel" value={whatsappInput} onChange={(event) => setWhatsappInput(event.target.value)} placeholder="+2348012345678" maxLength={16} /></label><p className="scan-help">Incluez l’indicatif du pays. Aucun message ne sera envoyé tant que le numéro est vide.</p><button className="button-primary" disabled={busy}>Enregistrer le numéro <Check size={17} /></button></form></section>}
  </main>
}

function ManualForm({ initial, category, busy, onSave, onCancel }: { initial: CatalogItem | null; category: Category; busy: boolean; onSave: (input: ItemInput) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [poster, setPoster] = useState(initial?.poster_url ?? '')
  const [genres, setGenres] = useState(initial?.genres.join(', ') ?? '')
  const [synopsis, setSynopsis] = useState(initial?.synopsis ?? '')
  const [year, setYear] = useState(initial?.year?.toString() ?? '')
  const [active, setActive] = useState(initial?.active ?? true)
  const [seasons, setSeasons] = useState(initial?.seasons_count?.toString() ?? '')
  const [gameSize, setGameSize] = useState(initial?.game_size_gb?.toString() ?? '')
  const [kind, setKind] = useState<Category>(initial?.category ?? category)
  function submit(event: FormEvent) {
    event.preventDefault()
    void onSave({ category: kind, media_type: kind === 'anime' ? 'anime' : null, title: title.trim(), title_key: titleKey(kind, kind === 'anime' ? 'anime' : null, title), synopsis: synopsis.trim() || null, poster_url: poster.trim() || null, genres: genres.split(',').map((entry) => entry.trim()).filter(Boolean), year: year ? Number(year) : null, source: initial?.source ?? 'manual', source_id: initial?.source_id ?? null, source_url: initial?.source_url ?? null, active, seasons_count: kind === 'games' ? null : seasons ? Number(seasons) : null, game_size_gb: kind === 'games' && gameSize ? Number(gameSize) : null })
  }
  return <form className="manual-form" onSubmit={submit}><h3>{initial ? 'Modifier les informations' : 'Nouvelle fiche manuelle'}</h3><div className="form-grid"><label>Catégorie<select value={kind} onChange={(event) => setKind(event.target.value as Category)}>{categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label><label>Titre<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Année<input type="number" min="1850" max="2200" value={year} onChange={(event) => setYear(event.target.value)} /></label>{kind === 'games' ? <label>Taille du jeu (Go)<input type="number" min="0.01" step="0.01" value={gameSize} onChange={(event) => setGameSize(event.target.value)} /></label> : <label>Nombre de saisons<input type="number" min="1" step="1" value={seasons} onChange={(event) => setSeasons(event.target.value)} /></label>}<label className="wide">URL de l’affiche<input type="url" pattern="https://.*" title="Utilisez une adresse HTTPS" value={poster} onChange={(event) => setPoster(event.target.value)} placeholder="https://..." /></label><label className="wide">Genres (séparés par une virgule)<input value={genres} onChange={(event) => setGenres(event.target.value)} placeholder="Action, Drame" /></label><label className="wide">Description<textarea value={synopsis} onChange={(event) => setSynopsis(event.target.value)} rows={3} /></label></div><label className="checkbox-label"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Visible dans le catalogue</label><div className="form-actions"><button type="button" className="button-secondary" onClick={onCancel}>Annuler</button><button className="button-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer la fiche'} <Check size={17} /></button></div></form>
}

export default App
