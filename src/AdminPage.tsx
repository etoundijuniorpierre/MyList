import { ChangeEvent, FormEvent, useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, LoaderCircle, LockKeyhole, Plus, Search, ChevronDown, Trash2, X } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { cachePosterUrl, isCachedPosterUrl, searchMetadata } from './metadata'
import { scanFolder, type ScannedItem } from './folderScan'
import { uniqueExactMatch } from './titleMatch'
import { catalogIdentity, isCatalogNoiseTitle, mergeCatalogUpdate, sameCatalogTitle, scannedCatalogMatch, scannedItemInput, unmatchedAnime } from './catalogImport'
import { itemPrice, validateGameTiers } from './pricing'
import { isConfigured, supabase } from './supabase'
import { Cover, formatPrice, safeUrl, translateSynopsisToFrench } from './media'
import { categories, categoryLabel, type CatalogItem, type Category, type GameCountDiscount, type GamePriceTier, type ItemInput, type MetadataResult, type PriceRule, type SiteSettings, titleKey } from './types'

const CATALOG_PAGE_SIZE = 50

export default function AdminPage({ catalogLoading, user, isAdmin, authReady, items, prices, gameTiers, gameDiscount, settings, onChanged, posterJobRunning, onRunPosterJob }: { catalogLoading: boolean; user: User | null; isAdmin: boolean; authReady: boolean; items: CatalogItem[]; prices: PriceRule[]; gameTiers: GamePriceTier[]; gameDiscount: GameCountDiscount; settings: SiteSettings; onChanged: () => Promise<void>; posterJobRunning: boolean; onRunPosterJob: (kind: 'cache' | 'enrich' | 'repair-games', filter: Category | 'all') => Promise<void> }) {
  const [tab, setTab] = useState<'catalog' | 'add' | 'bulk' | 'scan' | 'prices' | 'settings'>('catalog')
  const [category, setCategory] = useState<Category>('series')
  const [dramaOrigin, setDramaOrigin] = useState<'chinese-drama' | 'korean-drama'>('korean-drama')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MetadataResult[]>([])
  const [manual, setManual] = useState(false)
  const [editing, setEditing] = useState<CatalogItem | null>(null)
  const [selectedResult, setSelectedResult] = useState<ItemInput | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [bulkResults, setBulkResults] = useState<{ query: string; result: MetadataResult | null; selected: boolean; error?: string }[]>([])
  const [scanned, setScanned] = useState<ScannedItem[]>([])
  const [scanProgress, setScanProgress] = useState('')
  const [activity, setActivity] = useState<{ label: string; completed: number; total: number } | null>(null)
  const [successToast, setSuccessToast] = useState('')
  const [currency, setCurrency] = useState(prices.find((rule) => rule.currency)?.currency ?? '')
  const [priceInputs, setPriceInputs] = useState<Record<PriceRule['category'], { standard: string; threshold: string; reduced: string }>>({ series: { standard: '', threshold: '', reduced: '' }, anime: { standard: '', threshold: '', reduced: '' }, 'anime-film': { standard: '', threshold: '', reduced: '' }, novelas: { standard: '', threshold: '', reduced: '' }, dramas: { standard: '', threshold: '', reduced: '' } })
  const [tierInputs, setTierInputs] = useState<GamePriceTier[]>(gameTiers)
  const [discountCount, setDiscountCount] = useState(String(gameDiscount.min_games ?? ''))
  const [discountPrice, setDiscountPrice] = useState(String(gameDiscount.price_per_game ?? ''))
  const [whatsappInput, setWhatsappInput] = useState(settings.whatsapp_number ? `+${settings.whatsapp_number}` : '')
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [catalogPage, setCatalogPage] = useState(1)
  const [searchParams, setSearchParams] = useSearchParams()
  const filteredCatalog = items.filter((item) => filter === 'all' || item.category === filter)
  const catalogPageCount = Math.max(1, Math.ceil(filteredCatalog.length / CATALOG_PAGE_SIZE))
  const visibleCatalogPage = Math.min(catalogPage, catalogPageCount)
  const catalogStart = (visibleCatalogPage - 1) * CATALOG_PAGE_SIZE
  const visibleCatalog = filteredCatalog.slice(catalogStart, catalogStart + CATALOG_PAGE_SIZE)
  useEffect(() => { setCurrency(prices.find((rule) => rule.currency)?.currency ?? gameTiers[0]?.currency ?? gameDiscount.currency ?? ''); setPriceInputs(Object.fromEntries((['series', 'anime', 'anime-film', 'novelas', 'dramas'] as const).map((category) => { const rule = prices.find((entry) => entry.category === category); return [category, { standard: String(rule?.standard_price ?? ''), threshold: String(rule?.threshold_seasons ?? ''), reduced: String(rule?.threshold_price ?? '') }] })) as typeof priceInputs); setTierInputs(gameTiers); setDiscountCount(String(gameDiscount.min_games ?? '')); setDiscountPrice(String(gameDiscount.price_per_game ?? '')) }, [prices, gameTiers, gameDiscount])
  useEffect(() => { setWhatsappInput(settings.whatsapp_number ? `+${settings.whatsapp_number}` : '') }, [settings.whatsapp_number])
  useEffect(() => {
    if (!successToast) return
    const timeout = window.setTimeout(() => setSuccessToast(''), 6000)
    return () => window.clearTimeout(timeout)
  }, [successToast])
  useEffect(() => {
    const requestedId = searchParams.get('edit')
    if (!requestedId || catalogLoading || !isAdmin) return
    const item = items.find((entry) => entry.id === requestedId)
    if (!item) {
      setMessage('Cette fiche n’est plus disponible dans le catalogue.')
    } else {
      setEditing(item)
      setCategory(item.category)
      if (item.media_type === 'chinese-drama' || item.media_type === 'korean-drama') setDramaOrigin(item.media_type)
      setManual(true)
      setTab('add')
      setMessage('')
    }
    setSearchParams((current) => { current.delete('edit'); return current }, { replace: true })
  }, [catalogLoading, isAdmin, items, searchParams, setSearchParams])
  function showSuccess(text: string) { setMessage(''); setSuccessToast(text) }
  function scheduleSavedEnrichment(id: string, synopsis: string | null, posterUrl: string | null) {
    if (!supabase) return
    if (synopsis?.trim()) void (async () => {
      try {
        const translated = await translateSynopsisToFrench(synopsis)
        if (!translated || translated === synopsis) return
        await supabase!.from('catalog_items').update({ synopsis: translated }).eq('id', id).eq('synopsis', synopsis)
      } catch { /* L'import reste enregistré ; la description source est conservée. */ }
    })()
    if (posterUrl) void (async () => {
      try {
        const cached = await cachePosterUrl(posterUrl)
        if (!cached || cached === posterUrl || !isCachedPosterUrl(cached)) return
        await supabase!.from('catalog_items').update({ poster_url: cached }).eq('id', id).eq('poster_url', posterUrl)
      } catch { /* La fiche garde son lien d'image et pourra être mise en cache plus tard. */ }
    })()
  }
  function schedulePreparedEnrichment(inputs: ItemInput[]) {
    if (!supabase || !inputs.length) return
    void (async () => {
      for (let start = 0; start < inputs.length; start += 100) {
        const keys = inputs.slice(start, start + 100).map((input) => input.title_key)
        const { data, error } = await supabase!.from('catalog_items').select('id,synopsis,poster_url').in('title_key', keys)
        if (error || !data) continue
        for (const row of data as Pick<CatalogItem, 'id' | 'synopsis' | 'poster_url'>[]) scheduleSavedEnrichment(row.id, row.synopsis, row.poster_url)
      }
    })()
  }
  if (!isConfigured) return <main className="interior-page"><div className="page-intro"><span className="section-kicker">ADMINISTRATION</span><h1>Espace admin<span className="heading-period">.</span></h1><p>Connectez Supabase pour activer la gestion sécurisée du catalogue.</p></div><div className="setup-card"><LockKeyhole size={28} /><h2>Configuration en attente</h2><p>Les accès et les données seront disponibles après la création du projet Supabase. Consultez le guide du projet pour les étapes.</p></div></main>
  if (!authReady) return <main className="interior-page"><div className="empty-state" role="status"><LoaderCircle className="admin-operation-spinner" size={30} aria-hidden="true" /><h3>Vérification de la session…</h3></div></main>
  if (!user || !isAdmin) return <Navigate to="/connexion" replace />
  if (catalogLoading) return <main className="interior-page"><div className="empty-state" role="status"><LoaderCircle className="admin-operation-spinner" size={28} /><p>Chargement du catalogue administrateur…</p></div></main>

  async function saveItem(input: ItemInput, id?: string, refresh = true) {
    if (!supabase) return
    const clean: ItemInput = {
      category: input.category,
      media_type: input.category === 'anime' ? 'anime' : input.category === 'dramas' ? input.media_type : null,
      media_format: input.category === 'anime' && input.media_format === 'film' ? 'film' : null,
      title: input.title.trim(),
      title_key: titleKey(input.category, input.category === 'anime' ? 'anime' : input.category === 'dramas' ? input.media_type : null, input.title, input.category === 'anime' ? input.media_format ?? null : null),
      synopsis: input.synopsis?.trim() || null,
      poster_url: safeUrl(input.poster_url) ?? null,
      genres: input.genres,
      year: input.year,
      source: input.source,
      source_id: input.source_id,
      source_url: safeUrl(input.source_url) ?? null,
      active: input.active,
      seasons_count: input.category === 'games' ? null : input.seasons_count,
      game_size_gb: input.category === 'games' ? input.game_size_gb : null,
    }
    if (!clean.title || isCatalogNoiseTitle(clean.title)) throw new Error('Le nom du dossier ne correspond pas à un titre exploitable.')
    const duplicate = items.find((item) => item.id !== id && (sameCatalogTitle(item, clean) || (clean.source_id && item.category === clean.category && item.source === clean.source && item.source_id === clean.source_id)))
    if (id && duplicate) throw new Error(`« ${clean.title} » existe déjà. Ouvrez cette fiche existante pour la mettre à jour.`)
    const target = id ?? duplicate?.id
    const existing = items.find((item) => item.id === target)
    const payload = { ...mergeCatalogUpdate(clean, existing),
      title: !id && existing ? existing.title : clean.title,
      title_key: existing?.title_key ?? clean.title_key,
    }
    const response = target ? await supabase.from('catalog_items').update(payload).eq('id', target).select('id').single() : await supabase.from('catalog_items').insert(payload).select('id').single()
    if (response.error) throw response.error
    scheduleSavedEnrichment(response.data.id, payload.synopsis, payload.poster_url)
    if (refresh) {
      await onChanged()
      showSuccess(target ? 'Fiche mise à jour sans doublon.' : 'Titre ajouté au catalogue.')
      setEditing(null); setSelectedResult(null); setManual(false)
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
  async function previewBulk() {
    setBusy(true); setMessage(''); setBulkResults([])
    const lines = [...new Set(bulkText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].slice(0, 30)
    setActivity({ label: 'Recherche des fiches', completed: 0, total: lines.length })
    const preview: { query: string; result: MetadataResult | null; selected: boolean; error?: string }[] = []
    type SearchResult = { line: string; matches: MetadataResult[]; error?: string }
    async function find(line: string): Promise<SearchResult> {
      try { const matches = await searchMetadata(line, category, category === 'anime' ? 'anime' : null); return { line, matches: category === 'dramas' ? matches.map((entry) => ({ ...entry, media_type: dramaOrigin, title_key: titleKey('dramas', dramaOrigin, entry.title) })) : matches } }
      catch (error) { return { line, matches: [], error: error instanceof Error ? error.message : 'Erreur de recherche' } }
    }
    function append(results: SearchResult[]) {
      for (const { line, matches, error } of results) {
        const found = uniqueExactMatch(matches) ?? matches[0] ?? null
        const fallbackAnime = !found && category === 'anime' ? unmatchedAnime(line) : null
        const best = found ?? fallbackAnime
        const importedWithoutMetadata = Boolean(fallbackAnime)
        const ambiguous = matches.filter((entry) => entry.match === 'exact').length > 1 && !uniqueExactMatch(matches)
        const alreadyThere = best && items.some((item) => sameCatalogTitle(item, best) || (item.category === best.category && item.source === best.source && item.source_id === best.source_id))
        const repeatedInImport = best && preview.some((entry) => entry.result && (sameCatalogTitle(entry.result, best) || (entry.result.category === best.category && entry.result.source === best.source && entry.result.source_id === best.source_id)))
        preview.push({ query: line, result: best, selected: Boolean(best && ((best.match === 'exact' && !ambiguous) || importedWithoutMetadata) && !alreadyThere && !repeatedInImport), error: error ?? (importedWithoutMetadata ? 'Ajouté sans fiche externe ; vous pourrez lancer la recherche d’affiche après l’import' : ambiguous ? 'Plusieurs fiches exactes : vérifiez l’affiche avant de cocher' : repeatedInImport ? 'Déjà proposé dans cet import' : alreadyThere ? 'Déjà présent — sera mis à jour si coché' : undefined) })
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
    const invalid = scanned.filter((row) => row.selected).find((row) => !row.title.trim() || (row.category === 'games' ? !row.game_size_gb || row.game_size_gb <= 0 : row.seasons_count != null && (!Number.isInteger(row.seasons_count) || row.seasons_count < 1)))
    if (invalid) { setMessage(`Corrigez le titre et la mesure de « ${invalid.title || 'titre sans nom'} » avant l’import.`); return }
    if (!supabase) return
    setBusy(true); setMessage(''); setScanProgress(''); setSuccessToast('')
    let done = 0; let failed = 0; let firstError = ''
    try {
    const rows = new Map<string, { row: ScannedItem; existing?: CatalogItem }>()
    for (const row of scanned) {
      if (!row.selected || isCatalogNoiseTitle(row.title)) continue
      const match = scannedCatalogMatch(row, items)
      const title = match.existing?.title ?? match.alias.title
      const key = catalogIdentity(row.category, row.media_type, title, row.media_format)
      const normalized = {
        ...row,
        title,
        seasons_count: row.category === 'games' ? null : match.alias.preserveExistingSeasons
          ? match.existing?.seasons_count ?? row.seasons_count
          : Math.max(row.seasons_count ?? 0, match.alias.seasonFloor ?? 0) || null,
      }
      const previous = rows.get(key)
      if (!previous) rows.set(key, { row: normalized, existing: match.existing })
      else rows.set(key, {
        row: {
          ...previous.row,
          seasons_count: Math.max(previous.row.seasons_count ?? 0, normalized.seasons_count ?? 0) || null,
          game_size_gb: Math.max(previous.row.game_size_gb ?? 0, normalized.game_size_gb ?? 0) || null,
          file_count: previous.row.file_count + normalized.file_count,
        },
        existing: previous.existing ?? match.existing,
      })
    }
    const prepared = [...rows.values()].map(({ row, existing }) => scannedItemInput(row, existing))
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
    schedulePreparedEnrichment(prepared)
    setScanned([])
    const summary = `${done} titre(s) importé(s), animés compris ; ${failed} échec(s). Les fiches existantes ont été mises à jour sans doublon. L’import est enregistré avant la recherche des affiches et la traduction.${firstError && failed ? ` Erreur : ${firstError}` : ''}`
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
    for (const [category, entry] of Object.entries(priceInputs) as [PriceRule['category'], (typeof priceInputs)[PriceRule['category']]][]) {
      if (entry.standard !== '' && (Number(entry.standard) < 0 || !Number.isFinite(Number(entry.standard)))) { setMessage('Les prix doivent être positifs.'); return }
      if (category === 'anime-film') continue
      if (((entry.threshold === '') !== (entry.reduced === ''))) { setMessage('Renseignez le seuil de saisons et son prix ensemble.'); return }
      if (entry.threshold !== '' && (!Number.isInteger(Number(entry.threshold)) || Number(entry.threshold) < 2 || Number(entry.reduced) < 0 || entry.standard === '')) { setMessage('Le palier saisons doit commencer à 2 saisons et avoir un prix valide.'); return }
      if (entry.reduced !== '' && Number(entry.reduced) > Number(entry.standard)) { setMessage('Le prix réduit par saison ne peut pas dépasser le prix standard.'); return }
    }
    setBusy(true); setMessage('')
    for (const category of ['series', 'anime', 'anime-film', 'novelas', 'dramas'] as const) {
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
    {tab === 'catalog' && <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>Titres enregistrés</h2>
        <button className="button-secondary" disabled={busy || posterJobRunning || !items.some((item) => (filter === 'all' || item.category === filter) && !item.poster_url)} onClick={() => void onRunPosterJob('enrich', filter)}>Rechercher les affiches manquantes</button>
        <button className="button-secondary" disabled={busy || posterJobRunning || !items.some((item) => item.poster_url && !isCachedPosterUrl(item.poster_url))} onClick={() => void onRunPosterJob('cache', filter)}>Conserver les affiches existantes</button>
        <button className="button-secondary" title="Vérifie les proportions et ne remplace que les affiches paysage ou illisibles." disabled={busy || posterJobRunning || !items.some((item) => item.category === 'games' && item.poster_url)} onClick={() => void onRunPosterJob('repair-games', 'games')}>Corriger les jaquettes paysage (jeux)</button>
        <label className="select-field"><select value={filter} onChange={(event) => { setFilter(event.target.value as Category | 'all'); setCatalogPage(1) }}><option value="all">Toutes les catégories</option>{categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select><ChevronDown size={17} /></label>
      </div>
      <p className="admin-list-summary" role="status">{filteredCatalog.length ? `${catalogStart + 1}–${catalogStart + visibleCatalog.length} sur ${filteredCatalog.length} titres` : 'Aucun titre dans cette catégorie'}</p>
      <div className="admin-list">{visibleCatalog.map((item) => <div className="admin-row" key={item.id}><Cover item={item} /><div className="admin-row-title"><strong>{item.title}</strong><span>{categoryLabel(item.category)} · {item.category === 'games' ? `${item.game_size_gb ?? '?'} Go` : item.media_format === 'film' ? 'Film d’animation' : `${item.seasons_count ?? '?'} ${item.seasons_count === 1 ? 'saison' : 'saisons'}`} · {item.genres.join(', ') || 'Sans genre'} · {item.active ? 'Publié' : 'Masqué'}</span></div><div className="admin-row-actions"><button onClick={() => { setEditing(item); setTab('add'); setManual(true) }}>Modifier</button><button onClick={() => void toggleActive(item)}>{item.active ? 'Masquer' : 'Publier'}</button><button className="danger-text" aria-label={`Supprimer ${item.title}`} onClick={() => void removeItem(item)}><Trash2 size={17} /></button></div></div>)}{!filteredCatalog.length && <p className="empty-admin">Aucun titre pour le moment. Ajoutez votre premier élément.</p>}</div>
      {catalogPageCount > 1 && <nav className="admin-pagination" aria-label="Pages du catalogue administrateur"><button type="button" className="button-secondary" disabled={visibleCatalogPage === 1} onClick={() => setCatalogPage(visibleCatalogPage - 1)}>Précédent</button><span>Page {visibleCatalogPage} sur {catalogPageCount}</span><button type="button" className="button-secondary" disabled={visibleCatalogPage === catalogPageCount} onClick={() => setCatalogPage(visibleCatalogPage + 1)}>Suivant</button></nav>}
    </section>}
    {tab === 'add' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>{editing ? 'Modifier la fiche' : 'Ajouter un titre'}</h2><p>Recherchez une fiche pour récupérer son affiche et ses genres, ou remplissez-la à la main.</p></div></div>{!editing && <><div className="admin-chooser"><label>Catégorie<select value={category} onChange={(event) => { setCategory(event.target.value as Category); setResults([]); setSelectedResult(null); setManual(false) }}>{categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>{category === 'dramas' && <label>Origine<select value={dramaOrigin} onChange={(event) => setDramaOrigin(event.target.value as 'chinese-drama' | 'korean-drama')}><option value="chinese-drama">Chinois</option><option value="korean-drama">Coréen</option></select></label>}</div><form className="admin-search" onSubmit={search}><label className="search-field"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom de la série, du jeu, de l’animé ou de la novela..." required minLength={2} /></label><button className="button-primary" disabled={busy}>{busy ? 'Recherche…' : 'Rechercher'} <ArrowRight size={17} /></button></form><button className="text-button" onClick={() => { setManual(!manual); setSelectedResult(null); setResults([]) }}>{manual ? 'Fermer la saisie manuelle' : 'Saisir une fiche manuellement'}</button></>}{results.length > 0 && <div className="metadata-results">{results.map((result) => { const existing = items.find((item) => item.title_key === result.title_key || (item.category === result.category && item.source === result.source && item.source_id === result.source_id)); const exists = Boolean(existing); return <div className="metadata-row" key={`${result.source}-${result.source_id}`}><Cover item={result} /><div><strong>{result.title}</strong><span>{result.year ?? '—'} · {result.genres.slice(0, 3).join(', ') || 'Genre inconnu'}</span>{exists && <small>Déjà dans la liste : les informations seront actualisées.</small>}</div><button onClick={() => { setSelectedResult({ ...result, media_type: category === 'dramas' ? dramaOrigin : result.media_type, title_key: titleKey(result.category, category === 'dramas' ? dramaOrigin : result.media_type, result.title), seasons_count: existing?.seasons_count ?? result.seasons_count, game_size_gb: existing?.game_size_gb ?? result.game_size_gb }); setManual(true); setMessage('') }} disabled={busy}>{exists ? 'Compléter et mettre à jour' : 'Compléter et ajouter'} <Plus size={16} /></button></div> })}</div>}{(manual || editing) && <ManualForm key={editing?.id ?? (selectedResult ? `${selectedResult.source}:${selectedResult.source_id}:${selectedResult.title}` : `new:${category}`)} initial={editing ?? selectedResult} category={category} prices={prices} gameTiers={gameTiers} gameDiscount={gameDiscount} busy={busy} onCancel={() => { setManual(false); setEditing(null); setSelectedResult(null) }} onSave={async (input) => { setBusy(true); try { await saveItem(input, editing?.id) } catch (error) { setMessage(error instanceof Error ? error.message : 'Enregistrement impossible.') } finally { setBusy(false) } }} />}</section>}
    {tab === 'bulk' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>Importer une liste</h2><p>Un titre par ligne, jusqu’à 30. Vérifiez les correspondances avant l’ajout.</p></div></div><div className="admin-chooser"><label>Catégorie<select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>{category === 'dramas' && <label>Origine des titres<select value={dramaOrigin} onChange={(event) => setDramaOrigin(event.target.value as 'chinese-drama' | 'korean-drama')}><option value="chinese-drama">Chinois</option><option value="korean-drama">Coréen</option></select></label>}</div><textarea className="bulk-textarea" value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder={'Breaking Bad\nThe Last of Us\nDark'} rows={7} /><div className="bulk-actions"><button className="button-primary" onClick={() => void previewBulk()} disabled={busy || !bulkText.trim()}>{busy ? 'Recherche en cours…' : 'Prévisualiser les fiches'} <Search size={17} /></button></div>{bulkResults.length > 0 && <div className="bulk-preview"><h3>Vérification avant import</h3>{bulkResults.map((row, index) => <label className="bulk-row" key={`${row.query}-${index}`}><input type="checkbox" checked={row.selected} disabled={!row.result} onChange={(event) => setBulkResults((current) => current.map((entry, i) => i === index ? { ...entry, selected: event.target.checked } : entry))} /><span><strong>{row.query}</strong><small>{row.result ? `→ ${row.result.title} · ${row.result.match ? row.result.match === 'exact' ? 'Correspondance exacte' : 'À vérifier' : 'Sans fiche externe'}${row.error ? ` · ${row.error}` : ''}` : row.error ?? 'Aucun résultat'}</small></span></label>)}<button className="button-primary" onClick={() => void importBulk()} disabled={busy || !bulkResults.some((row) => row.selected)}>Enregistrer les fiches cochées <ArrowRight size={17} /></button></div>}</section>}
    {tab === 'scan' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>Scanner un dossier</h2><p>Choisissez un dossier ou la racine d’un disque. Seuls les noms, tailles et chemins relatifs sont analysés localement ; aucun fichier n’est téléversé.</p></div></div><label className="scan-picker">Choisir un dossier<input type="file" multiple {...{ webkitdirectory: '' }} onChange={scanSelected} disabled={busy} /></label><p className="scan-help">La catégorie et les saisons sont déduites des noms. Vérifiez chaque ligne ; les jeux utilisent la taille totale des fichiers détectés. Les dossiers de franchise contenant plusieurs jeux sont séparés en fiches individuelles. Les fiches externes sont recherchées à l’import.</p>{scanProgress && <p className="admin-message" role="status">{scanProgress}</p>}{scanned.length > 0 && <div className="scan-list">{scanned.map((row, index) => <div className="scan-row" key={row.id}><label className="scan-check"><input type="checkbox" checked={row.selected} onChange={(event) => toggleScanned(index, event.target.checked)} /> Importer</label><label>Titre<input value={row.title} onChange={(event) => setScanned((current) => current.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} /></label><label>Catégorie<select value={row.category} onChange={(event) => setScanned((current) => current.map((item, i) => i === index ? { ...item, category: event.target.value as Category, auto_category: false, media_type: event.target.value === 'anime' ? 'anime' : event.target.value === 'dramas' ? item.media_type ?? dramaOrigin : null, seasons_count: event.target.value === 'games' ? null : item.seasons_count ?? 1, game_size_gb: event.target.value === 'games' ? item.game_size_gb ?? 0.01 : null } : item))}>{categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>{row.category === 'dramas' && <label>Origine<select value={row.media_type === 'chinese-drama' ? 'chinese-drama' : 'korean-drama'} onChange={(event) => setScanned((current) => current.map((item, i) => i === index ? { ...item, media_type: event.target.value as 'chinese-drama' | 'korean-drama' } : item))}><option value="chinese-drama">Chinois</option><option value="korean-drama">Coréen</option></select></label>}{row.category === 'anime' && row.media_format === 'film' ? <span className="scan-format">Film d’animation · tarif distinct</span> : row.category === 'games' ? <label>Taille (Go)<input type="number" min="0.01" step="0.01" value={row.game_size_gb ?? ''} onChange={(event) => setScanned((current) => current.map((item, i) => i === index ? { ...item, game_size_gb: Number(event.target.value) } : item))} /></label> : <label>Saisons<input type="number" min="1" step="1" value={row.seasons_count ?? ''} onChange={(event) => setScanned((current) => current.map((item, i) => i === index ? { ...item, seasons_count: Number(event.target.value) } : item))} /></label>}<small>{row.file_count} fichier(s) · {row.path}{row.warning ? ` · ${row.warning}` : ''}</small></div>)}<button className="button-primary" disabled={busy || !scanned.some((row) => row.selected)} onClick={() => void importScanned()}>Importer les titres cochés <ArrowRight size={17} /></button></div>}</section>}
    {tab === 'prices' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>Grille des prix</h2><p>Les remises des séries animées se calculent sur leurs saisons. Les films d’animation ont un tarif fixe par film. Novelas et dramas gardent leurs grilles indépendantes.</p></div></div><form onSubmit={savePrices} className="price-form"><label>Devise commune (code ISO à 3 lettres)<input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))} placeholder="EUR, XOF, NGN..." maxLength={3} /></label>{(['series', 'anime', 'novelas', 'dramas'] as const).map((category) => <div className="price-group" key={category}><h3>{category === 'series' ? 'Séries' : category === 'anime' ? 'Animés · séries' : category === 'novelas' ? 'Novelas' : 'Dramas chinois et coréens'}</h3><div className="price-grid"><label>Prix standard par saison<input type="number" min="0" step="0.01" value={priceInputs[category].standard} onChange={(event) => setPriceInputs((current) => ({ ...current, [category]: { ...current[category], standard: event.target.value } }))} placeholder="Non défini" /></label><label>Seuil total de saisons du panier<input type="number" min="2" step="1" value={priceInputs[category].threshold} onChange={(event) => setPriceInputs((current) => ({ ...current, [category]: { ...current[category], threshold: event.target.value } }))} placeholder="Ex. 3" /></label><label>Prix par saison dès ce seuil<input type="number" min="0" step="0.01" value={priceInputs[category].reduced} onChange={(event) => setPriceInputs((current) => ({ ...current, [category]: { ...current[category], reduced: event.target.value } }))} placeholder="Ex. 800" /></label></div></div>)}<div className="price-group"><h3>Films d’animation</h3><div className="price-grid"><label>Prix fixe par film<input type="number" min="0" step="0.01" value={priceInputs['anime-film'].standard} onChange={(event) => setPriceInputs((current) => ({ ...current, 'anime-film': { ...current['anime-film'], standard: event.target.value } }))} placeholder="Non défini" /></label></div></div><div className="price-group"><h3>Jeux PC · paliers de taille</h3><p>La taille est arrondie au Go supérieur pour choisir le palier. Exemple : 49,2 Go entre dans le palier 50–100 Go.</p>{tierInputs.map((tier, index) => <div className="tier-row" key={tier.id ?? index}><label>De (Go)<input type="number" min="1" step="1" value={tier.min_gb} onChange={(event) => setTierInputs((current) => current.map((item, i) => i === index ? { ...item, min_gb: Number(event.target.value) } : item))} /></label><label>À (Go)<input type="number" min="1" step="1" value={tier.max_gb} onChange={(event) => setTierInputs((current) => current.map((item, i) => i === index ? { ...item, max_gb: Number(event.target.value) } : item))} /></label><label>Prix<input type="number" min="0" step="0.01" value={tier.price} onChange={(event) => setTierInputs((current) => current.map((item, i) => i === index ? { ...item, price: Number(event.target.value) } : item))} /></label><button type="button" className="button-secondary" onClick={() => setTierInputs((current) => current.filter((_, i) => i !== index))}>Retirer</button></div>)}<button type="button" className="button-secondary" onClick={() => setTierInputs((current) => [...current, { min_gb: (current.at(-1)?.max_gb ?? 0) + 1, max_gb: (current.at(-1)?.max_gb ?? 0) + 50, price: 0, currency }])}>Ajouter un palier</button></div><div className="price-group"><h3>Remise selon le nombre de jeux</h3><p>Dès que le panier contient ce nombre de jeux, chaque jeu prend le prix fixe indiqué, quel que soit son palier de taille.</p><div className="price-grid"><label>Nombre de jeux requis<input type="number" min="2" step="1" value={discountCount} onChange={(event) => setDiscountCount(event.target.value)} placeholder="Ex. 3" /></label><label>Prix par jeu à partir de ce nombre<input type="number" min="0" step="0.01" value={discountPrice} onChange={(event) => setDiscountPrice(event.target.value)} placeholder="Non défini" /></label></div></div><button className="button-primary" disabled={busy}>Enregistrer les prix <Check size={17} /></button></form></section>}
    {tab === 'settings' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>Réception WhatsApp</h2><p>Ce numéro recevra les paniers envoyés par les visiteurs. Vous pouvez le modifier ici à tout moment.</p></div></div><form onSubmit={saveSettings} className="price-form"><label>Numéro international<input type="tel" inputMode="tel" autoComplete="tel" value={whatsappInput} onChange={(event) => setWhatsappInput(event.target.value)} placeholder="+2348012345678" maxLength={16} /></label><p className="scan-help">Incluez l’indicatif du pays. Aucun message ne sera envoyé tant que le numéro est vide.</p><button className="button-primary" disabled={busy}>Enregistrer le numéro <Check size={17} /></button></form></section>}
  </main>
}

function ManualForm({ initial, category, prices, gameTiers, gameDiscount, busy, onSave, onCancel }: { initial: ItemInput | null; category: Category; prices: PriceRule[]; gameTiers: GamePriceTier[]; gameDiscount: GameCountDiscount; busy: boolean; onSave: (input: ItemInput) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [poster, setPoster] = useState(initial?.poster_url ?? '')
  const [genres, setGenres] = useState(initial?.genres.join(', ') ?? '')
  const [synopsis, setSynopsis] = useState(initial?.synopsis ?? '')
  const [year, setYear] = useState(initial?.year?.toString() ?? '')
  const [active, setActive] = useState(initial?.active ?? true)
  const [seasons, setSeasons] = useState(initial?.seasons_count?.toString() ?? '')
  const [gameSize, setGameSize] = useState(initial?.game_size_gb?.toString() ?? '')
  const [kind, setKind] = useState<Category>(initial?.category ?? category)
  const [mediaFormat, setMediaFormat] = useState<'series' | 'film'>(initial?.media_format === 'film' ? 'film' : 'series')
  const [dramaOrigin, setDramaOrigin] = useState<'chinese-drama' | 'korean-drama'>(initial?.media_type === 'chinese-drama' ? 'chinese-drama' : 'korean-drama')
  const previewItem = { category: kind, media_format: kind === 'anime' ? mediaFormat : null, seasons_count: kind === 'games' || (kind === 'anime' && mediaFormat === 'film') ? null : seasons ? Number(seasons) : null, game_size_gb: kind === 'games' && gameSize ? Number(gameSize) : null } as CatalogItem
  const previewPrice = itemPrice(previewItem, [previewItem], prices, gameTiers, gameDiscount)
  function submit(event: FormEvent) {
    event.preventDefault()
    const mediaType = kind === 'anime' ? 'anime' : kind === 'dramas' ? dramaOrigin : null
    void onSave({ category: kind, media_type: mediaType, media_format: kind === 'anime' ? mediaFormat : null, title: title.trim(), title_key: titleKey(kind, mediaType, title, kind === 'anime' ? mediaFormat : null), synopsis: synopsis.trim() || null, poster_url: poster.trim() || null, genres: genres.split(',').map((entry) => entry.trim()).filter(Boolean), year: year ? Number(year) : null, source: initial?.source ?? 'manual', source_id: initial?.source_id ?? null, source_url: initial?.source_url ?? null, active, seasons_count: kind === 'games' || (kind === 'anime' && mediaFormat === 'film') ? null : seasons ? Number(seasons) : null, game_size_gb: kind === 'games' && gameSize ? Number(gameSize) : null })
  }
  return <form className="manual-form" onSubmit={submit}><h3>{initial ? 'Compléter la fiche' : 'Nouvelle fiche manuelle'}</h3><div className="form-grid"><label>Catégorie<select value={kind} onChange={(event) => setKind(event.target.value as Category)}>{categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>{kind === 'anime' && <label>Format<select value={mediaFormat} onChange={(event) => setMediaFormat(event.target.value as 'series' | 'film')}><option value="series">Série animée</option><option value="film">Film d’animation</option></select></label>}{kind === 'dramas' && <label>Origine du drama<select value={dramaOrigin} onChange={(event) => setDramaOrigin(event.target.value as 'chinese-drama' | 'korean-drama')}><option value="chinese-drama">Chinois</option><option value="korean-drama">Coréen</option></select></label>}<label>Titre<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Année<input type="number" min="1850" max="2200" value={year} onChange={(event) => setYear(event.target.value)} /></label>{kind === 'games' ? <label>Taille du jeu (Go) *<input type="number" min="0.01" step="0.01" required value={gameSize} onChange={(event) => setGameSize(event.target.value)} /></label> : kind === 'anime' && mediaFormat === 'film' ? <p className="scan-help">Le tarif du film sera défini séparément dans la grille des prix.</p> : <label>Nombre de saisons *<input type="number" min="1" max="999" step="1" required value={seasons} onChange={(event) => setSeasons(event.target.value)} /></label>}<label className="wide">URL de l’affiche<input type="url" pattern="https://.*" title="Utilisez une adresse HTTPS" value={poster} onChange={(event) => setPoster(event.target.value)} placeholder="https://..." /></label><label className="wide">Genres (séparés par une virgule)<input value={genres} onChange={(event) => setGenres(event.target.value)} placeholder="Action, Drame" /></label><label className="wide">Description<textarea value={synopsis} onChange={(event) => setSynopsis(event.target.value)} rows={3} /></label></div><div className="price-preview" role="status"><strong>Prix indicatif : {previewPrice ? formatPrice(previewPrice.amount, previewPrice.currency) : 'à définir dans Prix'}</strong><span>Calculé depuis la grille correspondante. Les remises dépendent du panier final.</span></div><label className="checkbox-label"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Visible dans le catalogue</label><div className="form-actions"><button type="button" className="button-secondary" onClick={onCancel}>Annuler</button><button className="button-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer la fiche'} <Check size={17} /></button></div></form>
}

