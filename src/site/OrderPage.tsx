import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, LoaderCircle, Search, Send } from 'lucide-react'
import { Cover, formatPrice } from '../media'
import { categoryMeta, kindLabel, measureLabel, setPageMeta } from '../display'
import { categories, normalizeTitle, titleKey, type CatalogItem, type Category, type PricingSettings } from '../types'
import { supabase } from '../supabase'
import { catalogFirstSearch, catalogSearchPattern, programOrderMessage, programQuote, type OrderCandidate } from '../programOrder'
import { useSite } from './context'

const columns = 'id,category,media_type,media_format,title,title_key,poster_url,genres,year,source,source_id,source_url,active,seasons_count,seasons_total,game_size_gb,available_seasons,season_details_checked_at,season_details_note'
type ExternalProgram = { id: string; title: string; source: string; source_url: string; poster_url: string | null; year: number | null; format: 'series' | 'film' | null; media_type?: CatalogItem['media_type']; aliases?: string[] }

export default function OrderPage({ demo, onVerifyPricing }: { demo: CatalogItem[]; onVerifyPricing: () => Promise<PricingSettings | null> }) {
  const site = useSite()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(() => (params.get('q') ?? '').slice(0, 160))
  const [category, setCategory] = useState<Category>(() => categories.find(entry => entry.key === params.get('univers'))?.key ?? 'series')
  const [candidates, setCandidates] = useState<OrderCandidate[]>([])
  const [chosen, setChosen] = useState<OrderCandidate | null>(null)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [searched, setSearched] = useState(false)
  const [externalSearched, setExternalSearched] = useState(false)
  const [sending, setSending] = useState(false)
  const [name, setName] = useState(() => { try { return localStorage.getItem('mylist-customer-name') ?? '' } catch { return '' } })
  const request = useRef<AbortController | null>(null)
  const cache = useRef(new Map<string, { at: number; candidates: OrderCandidate[]; external: boolean }>())
  useEffect(() => { setPageMeta('Passer une commande'); return () => request.current?.abort() }, [])

  function reset() {
    request.current?.abort()
    request.current = null
    setCandidates([]); setChosen(null); setPhase(''); setError(''); setNote(''); setSearched(false); setExternalSearched(false)
  }
  function start() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    return controller
  }
  async function localSearch(term: string, signal: AbortSignal) {
    if (!supabase) return demo.filter(item => item.category === category && normalizeTitle(item.title).includes(normalizeTitle(term))).slice(0, 6).map(item => ({ item, inCatalog: true }))
    const { data, error } = await supabase.from('catalog_items').select(columns).eq('active', true).eq('category', category)
      .ilike('title', catalogSearchPattern(term)).order('title').limit(6).abortSignal(signal)
    if (error) throw new Error('Le catalogue n’a pas pu être vérifié. Réessayez dans un instant.')
    return ((data ?? []) as CatalogItem[]).map(item => ({ item, inCatalog: true }))
  }
  async function externalSearch(term: string, signal: AbortSignal) {
    setPhase('Recherche du titre auprès des sources…')
    const response = await fetch(`/api/order-search?${new URLSearchParams({ q: term, category })}`, { signal })
    if (!response.ok) throw new Error('La recherche externe est indisponible. Vous pouvez envoyer une demande sans estimation.')
    const payload: { results: ExternalProgram[] } = await response.json()
    return payload.results.map(result => ({ inCatalog: false, aliases: result.aliases, item: {
      id: `request:${result.source}:${result.id}`, category, media_type: category === 'anime' ? 'anime' : result.media_type ?? null,
      media_format: result.format, title: result.title, title_key: titleKey(category, null, result.title, result.format),
      synopsis: null, poster_url: result.poster_url, genres: [], year: result.year, source: result.source, source_id: result.id,
      source_url: result.source_url, active: true, seasons_count: null, game_size_gb: null,
    } as CatalogItem }))
  }
  async function search(event?: FormEvent, outside = false) {
    event?.preventDefault()
    const term = query.trim()
    if (term.length < 2 || term.length > 160 || sending) return
    ;(document.activeElement as HTMLElement | null)?.blur()
    const controller = start()
    const timeout = window.setTimeout(() => controller.abort(), 12000)
    setError(''); setNote(''); setChosen(null); setCandidates([]); setSearched(false); setPhase('Vérification de notre catalogue…')
    const key = `${category}:${term.toLowerCase()}:${outside}`
    try {
      let result = cache.current.get(key)
      if (!result || Date.now() - result.at > 300000) {
        const found = outside ? { candidates: await externalSearch(term, controller.signal), external: true }
          : await catalogFirstSearch(() => localSearch(term, controller.signal), () => externalSearch(term, controller.signal))
        result = { ...found, at: Date.now() }
        if (cache.current.size >= 20) cache.current.delete(cache.current.keys().next().value!)
        cache.current.set(key, result)
      }
      if (controller.signal.aborted || request.current !== controller) return
      setCandidates(result.candidates); setExternalSearched(result.external)
    } catch (failure) {
      if (request.current === controller) {
        setError(controller.signal.aborted ? 'La recherche prend trop de temps. Réessayez ou envoyez votre demande sans estimation.' : failure instanceof Error ? failure.message : 'Recherche indisponible.')
        setExternalSearched(true)
      }
    } finally {
      window.clearTimeout(timeout)
      if (request.current === controller) { setPhase(''); setSearched(true) }
    }
  }
  async function choose(candidate: OrderCandidate) {
    const controller = start()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    setChosen(candidate); setError(''); setNote('')
    if (candidate.inCatalog) { window.clearTimeout(timeout); setPhase(''); return }
    setPhase('Vérification de la fiche et du nombre de saisons…')
    try {
      // A translated title may already exist in the catalog under another name.
      const keys = [...new Set([candidate.item.title, ...(candidate.aliases ?? [])].slice(0, 3)
        .map(title => titleKey(category, candidate.item.media_type, title, candidate.item.media_format)))]
      if (supabase) {
        const [byTitle, bySource] = await Promise.all([
          supabase.from('catalog_items').select(columns).eq('active', true).eq('category', category).in('title_key', keys).limit(2).abortSignal(controller.signal),
          supabase.from('catalog_items').select(columns).eq('active', true).eq('category', category).eq('source', candidate.item.source).eq('source_id', candidate.item.source_id!).limit(2).abortSignal(controller.signal),
        ])
        if (request.current !== controller) return
        if (controller.signal.aborted) {
          setChosen({ ...candidate, catalogChecked: false })
          throw new Error('Vérification du catalogue interrompue.')
        }
        if (byTitle.error || bySource.error) {
          setChosen({ ...candidate, catalogChecked: false })
          throw new Error('Présence au catalogue à confirmer par notre équipe.')
        }
        const data = [...new Map([...(bySource.data ?? []), ...(byTitle.data ?? [])].map(item => [item.id, item])).values()]
        if (data.length === 1) { setChosen({ item: data[0] as CatalogItem, inCatalog: true }); return }
        if (data.length > 1) { setCandidates(data.map(item => ({ item: item as CatalogItem, inCatalog: true }))); setChosen(null); return }
      }
      if (candidate.item.category === 'games' || candidate.item.media_format === 'film') return
      const params = new URLSearchParams({ source: candidate.item.source, id: candidate.item.source_id ?? '', title: candidate.item.title, category })
      if (candidate.item.year) params.set('year', String(candidate.item.year))
      candidate.aliases?.filter(alias => alias !== candidate.item.title).slice(0, 2).forEach(alias => params.append('alias', alias))
      const response = await fetch(`/api/season-count?${params}`, { signal: controller.signal })
      if (!response.ok) throw new Error('Nombre de saisons à confirmer : la source ne répond pas.')
      const data = await response.json()
      if (request.current !== controller || controller.signal.aborted) return
      if (Number.isInteger(data.count) && data.count > 0 && data.count < 1000) setChosen({ ...candidate, item: { ...candidate.item, seasons_count: data.count } })
      else setNote('Le nombre de saisons n’est pas assez sûr pour calculer un prix. Nous le confirmerons sur WhatsApp.')
    } catch (failure) {
      if (request.current === controller) setNote(failure instanceof Error && !controller.signal.aborted ? failure.message : 'Vérification interrompue : saisons et prix à confirmer sur WhatsApp.')
    } finally {
      window.clearTimeout(timeout)
      if (request.current === controller) setPhase('')
    }
  }
  function manualRequest() {
    request.current?.abort(); request.current = null; setPhase(''); setNote('Notre équipe vérifiera le titre, sa disponibilité et son prix.')
    setChosen({ inCatalog: false, catalogChecked: false, item: { id: 'request:manual', category, media_type: category === 'anime' ? 'anime' : null, title: query.trim(), title_key: '',
      synopsis: null, poster_url: null, genres: [], year: null, source: 'manual', source_id: null, source_url: null, active: true, seasons_count: null, game_size_gb: null } })
  }
  async function send() {
    if (!chosen || phase || sending) return
    setSending(true); setError('')
    const popup = window.open('about:blank', '_blank')
    if (popup) popup.opener = null
    try {
      let timer: number | undefined
      const latest = await Promise.race([
        onVerifyPricing(),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('La vérification des tarifs prend trop de temps. Réessayez.')), 8000) }),
      ]).finally(() => window.clearTimeout(timer))
      if (!latest) throw new Error('Impossible de vérifier les tarifs. Réessayez avant d’envoyer la commande.')
      let confirmed = chosen
      if (chosen.inCatalog && supabase) {
        const { data, error } = await supabase.from('catalog_items').select(columns).eq('id', chosen.item.id).eq('active', true).abortSignal(AbortSignal.timeout(6000)).maybeSingle()
        if (error || !data) throw new Error('Cette fiche doit être vérifiée à nouveau. Relancez la recherche.')
        confirmed = { item: data as CatalogItem, inCatalog: true }
        setChosen(confirmed)
      }
      const number = latest.settings.whatsapp_number.replace(/\D/g, '')
      if (!/^\d{7,15}$/.test(number)) throw new Error('Le numéro WhatsApp de la boutique n’est pas encore configuré.')
      const text = programOrderMessage(confirmed, latest, name, formatPrice)
      try { localStorage.setItem('mylist-customer-name', name) } catch { /* Optional preference. */ }
      const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`
      if (popup && !popup.closed) popup.location.replace(url)
      else window.location.assign(url)
    } catch (failure) {
      popup?.close(); setError(failure instanceof Error ? failure.message : 'La commande n’a pas pu être préparée.')
    } finally { setSending(false) }
  }
  const pricing = chosen ? programQuote(chosen, site) : null
  return <main id="contenu" tabIndex={-1} className="interior-page order-page">
    <div className="page-intro"><span className="eyebrow">Un titre en tête ?</span><h1>Passer une commande</h1><p>Nous vérifions d’abord notre catalogue. Si le titre manque, choisissez sa fiche pour obtenir une estimation, puis envoyez votre demande sur WhatsApp. Aucun compte nécessaire.</p></div>
    <form className="order-search" onSubmit={search} aria-label="Rechercher le programme à commander">
      <label>Univers<select value={category} disabled={sending} onChange={event => { reset(); setCategory(event.target.value as Category) }}>{categories.map(entry => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>
      <label className="order-title-field">Titre<input type="search" required minLength={2} maxLength={160} value={query} disabled={sending} enterKeyHint="search" placeholder="Ex. Naruto Shippuden, The Blacklist…" onChange={event => { reset(); setQuery(event.target.value) }} /></label>
      <button type="submit" className="button-primary" disabled={!!phase || sending || query.trim().length < 2}><Search size={17} /> Rechercher</button>
    </form>
    <div className="order-status" role="status" aria-live="polite">{phase && <><LoaderCircle className="spin" size={18} /> {phase}</>}</div>
    {error && <p className="order-warning" role="alert">{error}</p>}
    {searched && !phase && !chosen && <section className="order-results" aria-label="Correspondances">
      <h2>{candidates.length ? externalSearched ? 'Quel titre recherchez-vous ?' : 'Disponible dans notre catalogue' : 'Aucune correspondance sûre'}</h2>
      {externalSearched && candidates.length > 0 && <p>Vérifiez le titre et l’année. Ces résultats ne garantissent pas la disponibilité en boutique.</p>}
      <div className="order-candidates">{candidates.map(candidate => <button type="button" className="order-candidate" key={candidate.item.id} onClick={() => void choose(candidate)}>
        <Cover item={candidate.item} sizes="60px" /><span><strong>{candidate.item.title}</strong><small>{kindLabel(candidate.item)} · {candidate.item.year ?? 'Année inconnue'}{candidate.inCatalog ? ` · ${measureLabel(candidate.item)}` : ''}</small><b>{candidate.inCatalog ? 'Choisir ce titre' : 'Choisir et estimer le prix'}</b></span>
      </button>)}</div>
      {!externalSearched && <button type="button" className="button-ghost" onClick={() => void search(undefined, true)}>Ce n’est pas le titre recherché : chercher ailleurs</button>}
      {externalSearched && <button type="button" className="button-ghost" onClick={manualRequest}>Mon titre n’est pas ici : envoyer une demande sans estimation</button>}
    </section>}
    {chosen && <section className="order-summary" aria-labelledby="order-summary-title" aria-busy={!!phase || sending}>
      <div className="order-selected"><Cover item={chosen.item} sizes="100px" /><div><span className="eyebrow">{chosen.inCatalog ? 'Au catalogue' : 'Sur demande'}</span><h2 id="order-summary-title">{chosen.item.title}</h2><p>{kindLabel(chosen.item)} · {chosen.item.year ?? 'Année à confirmer'} · {measureLabel(chosen.item)}</p></div></div>
      {!phase && <><strong className="order-price">{pricing ? `${chosen.inCatalog ? '' : 'Estimation : '}${formatPrice(pricing.amount, pricing.currency)}` : 'Prix à confirmer'}</strong>{pricing && <p>{pricing.detail}</p>}
        {!chosen.inCatalog && <p>Disponibilité à confirmer. L’estimation applique {site.settings.order_pricing ? 'les tarifs des commandes hors catalogue' : 'les tarifs actuels du catalogue'} à ce titre uniquement.</p>}
        {note && <p className="order-warning">{note}</p>}
        {!pricing && <p>{chosen.item.category === 'games' ? 'Le poids du jeu ou son tarif doit être confirmé.' : 'Les saisons ou le tarif doivent être confirmés.'} La demande peut tout de même être envoyée.</p>}
        <label className="order-name">Votre nom (facultatif)<input autoComplete="name" maxLength={80} value={name} disabled={sending} onChange={event => setName(event.target.value)} /></label>
        <div className="order-actions"><button type="button" className="button-whatsapp" disabled={sending} onClick={() => void send()}>{sending ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />} {sending ? 'Vérification du prix…' : 'Commander sur WhatsApp'}</button>
          {chosen.inCatalog && <button type="button" className="button-ghost" disabled={sending} onClick={() => site.toggle(chosen.item)}>{site.selection.includes(chosen.item.id) ? <><Check size={17} /> Dans mon panier · retirer</> : 'Ajouter au panier'}</button>}
          <button type="button" className="button-ghost" disabled={sending} onClick={() => { setChosen(null); setNote('') }}>Changer de titre</button></div>
        <p className="order-footnote">Les tarifs seront revérifiés avant l’ouverture de WhatsApp. Vous confirmerez vous-même l’envoi du message. Votre panier reste indépendant.</p>
        {chosen.inCatalog && <Link to={`${categoryMeta[category].route}?titre=${encodeURIComponent(chosen.item.id)}`}>Voir la fiche du catalogue</Link>}
      </>}
    </section>}
  </main>
}
