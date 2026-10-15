import { useMemo, useState } from 'react'
import { ArrowRight, Check, Copy, EyeOff, Languages, Layers, Sparkles, Trash2, WandSparkles } from 'lucide-react'
import { supabase } from '../supabase'
import { Cover } from '../media'
import { kindLabel, measureLabel, plural } from '../display'
import { issueLabels, itemIssues, probableDuplicates, suggestTitle, type HealthIssue } from '../titleHealth'
import { categoryLabel, titleKey, type CatalogItem, type Category } from '../types'
import type { PosterJobKind } from '../App'
import type { Confirm } from './useConfirm'
import { catalogIdentity } from '../catalogImport'
import { formatWorks, isNoiseEntry, looksLikeSaga, parseWorks, sagaPreset } from './sagaPresets'

const SAGA_IGNORED_KEY = 'mylist-saga-ignored'
function readIgnored() { try { return new Set<string>(JSON.parse(localStorage.getItem(SAGA_IGNORED_KEY) ?? '[]')) } catch { return new Set<string>() } }

interface Props {
  items: CatalogItem[]
  posterJobRunning: boolean
  confirm: Confirm
  onChanged: () => Promise<void>
  onMessage: (text: string, success?: boolean) => void
  onEdit: (item: CatalogItem) => void
  onShowIssue: (issue: HealthIssue) => void
  onRunPosterJob: (kind: PosterJobKind, filter: Category | 'all', ids?: string[]) => Promise<void>
}

export function HealthTab({ items, posterJobRunning, confirm, onChanged, onMessage, onEdit, onShowIssue, onRunPosterJob }: Props) {
  const suggestions = useMemo(() => items.map((item) => ({ item, suggestion: suggestTitle(item) })).filter((entry): entry is { item: CatalogItem; suggestion: NonNullable<ReturnType<typeof suggestTitle>> } => Boolean(entry.suggestion)), [items])
  const duplicates = useMemo(() => probableDuplicates(items), [items])
  const counts = useMemo(() => {
    const result: Record<HealthIssue, number> = { poster: 0, synopsis: 0, genres: 0, year: 0, measure: 0, title: 0 }
    for (const item of items) for (const issue of itemIssues(item)) result[issue]++
    return result
  }, [items])
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState(false)
  const [shown, setShown] = useState(40)
  const pending = suggestions.filter(({ item }) => !skipped.has(item.id))
  const incomplete = items.filter((item) => !item.poster_url || !item.synopsis?.trim() || !item.genres.length || !item.year)
  const translatable = items.filter((item) => Boolean(item.synopsis?.trim()))
  const [ignoredSagas, setIgnoredSagas] = useState(readIgnored)
  const [sagaTexts, setSagaTexts] = useState<Record<string, string>>({})
  const sagas = useMemo(() => items.filter((item) => item.active && item.category === 'anime' && looksLikeSaga(item.title) && !ignoredSagas.has(item.id)), [items, ignoredSagas])

  function ignoreSaga(id: string) {
    setIgnoredSagas((current) => {
      const next = new Set(current).add(id)
      try { localStorage.setItem(SAGA_IGNORED_KEY, JSON.stringify([...next])) } catch { /* Le choix reste valable pour cette session. */ }
      return next
    })
  }
  async function hideSaga(saga: CatalogItem) {
    if (!supabase) return
    const ok = await confirm({ title: `Masquer « ${saga.title} » ?`, body: 'La fiche disparaît du site mais reste dans le catalogue (onglet Titres, filtre « Masqués »). Vous pourrez la republier ou la décomposer plus tard.', confirm: 'Masquer' })
    if (!ok) return
    const { error } = await supabase.from('catalog_items').update({ active: false }).eq('id', saga.id)
    if (error) { onMessage(error.message); return }
    await onChanged()
    onMessage(`« ${saga.title} » est masquée.`, true)
  }
  async function removeNoise(saga: CatalogItem) {
    if (!supabase) return
    const ok = await confirm({ title: `Retirer « ${saga.title} » ?`, body: 'Cette fiche vient d’un rapport de disque et ne désigne aucune œuvre. Elle sera supprimée définitivement du catalogue.', confirm: 'Retirer', danger: true })
    if (!ok) return
    const { error } = await supabase.from('catalog_items').delete().eq('id', saga.id)
    if (error) { onMessage(error.message); return }
    await onChanged()
    onMessage(`« ${saga.title} » a été retirée du catalogue.`, true)
  }
  /** Crée une fiche par œuvre (sans recréer celles déjà présentes), masque la fiche regroupée et lance la recherche d'affiches. */
  async function decompose(saga: CatalogItem) {
    if (!supabase) return
    const works = parseWorks(sagaTexts[saga.id] ?? formatWorks(sagaPreset(saga.title)?.works ?? []))
    if (!works.length) { onMessage('Indiquez au moins une œuvre, une par ligne : « Titre ; 2 saisons » ou « Titre ; film ».'); return }
    const mediaType = saga.category === 'anime' ? 'anime' : saga.media_type
    const identity = (title: string, format: 'series' | 'film') => catalogIdentity(saga.category, mediaType, title, saga.category === 'anime' ? format : null)
    const known = new Map(items.filter((item) => item.id !== saga.id).map((item) => [catalogIdentity(item.category, item.media_type, item.title, item.media_format), item]))
    const existing = works.filter((work) => known.has(identity(work.title, work.format)))
    const created = works.filter((work) => !known.has(identity(work.title, work.format)))
    const ok = await confirm({
      title: `Décomposer « ${saga.title} » ?`,
      body: `${plural(created.length, 'nouvelle fiche', 'nouvelles fiches')} ${created.length > 1 ? 'seront créées' : 'sera créée'}${existing.length ? `, ${plural(existing.length, 'œuvre')} déjà au catalogue ${existing.length > 1 ? 'sont conservées' : 'est conservée'} (${existing.slice(0, 3).map((work) => work.title).join(', ')}${existing.length > 3 ? '…' : ''})` : ''}. « ${saga.title} » sera ensuite masquée, pas supprimée. Les affiches et descriptions des nouvelles fiches seront recherchées automatiquement.`,
      confirm: 'Décomposer',
    })
    if (!ok) return
    setWorking(true)
    try {
      const rows = created.map((work) => {
        const format = saga.category === 'anime' ? work.format : null
        return {
          category: saga.category, media_type: mediaType, media_format: format, title: work.title,
          title_key: titleKey(saga.category, mediaType, work.title, format),
          synopsis: null, poster_url: null, genres: [], year: null, source: 'manual', source_id: null, source_url: null, active: true,
          seasons_count: saga.category === 'games' || work.format === 'film' ? null : work.seasons ?? 1, game_size_gb: null,
        }
      })
      const newIds: string[] = []
      for (let start = 0; start < rows.length; start += 40) {
        const { data, error } = await supabase.from('catalog_items').upsert(rows.slice(start, start + 40), { onConflict: 'title_key', ignoreDuplicates: true }).select('id')
        if (error) throw new Error(error.message)
        newIds.push(...(data ?? []).map((row) => row.id as string))
      }
      const hidden = await supabase.from('catalog_items').update({ active: false }).eq('id', saga.id)
      if (hidden.error) throw new Error(`Les œuvres sont créées, mais « ${saga.title} » n’a pas pu être masquée : ${hidden.error.message}`)
      await onChanged()
      setSagaTexts((current) => { const next = { ...current }; delete next[saga.id]; return next })
      onMessage(`« ${saga.title} » décomposée : ${plural(newIds.length, 'fiche créée', 'fiches créées')}${existing.length ? `, ${plural(existing.length, 'œuvre')} déjà présente${existing.length > 1 ? 's' : ''}` : ''}. La fiche regroupée est masquée.`, true)
      if (newIds.length && !posterJobRunning) void onRunPosterJob('complete', 'all', newIds)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Décomposition impossible.')
    } finally { setWorking(false) }
  }

  async function rename(list: { item: CatalogItem; suggestion: NonNullable<ReturnType<typeof suggestTitle>> }[]) {
    if (!supabase || !list.length) return
    setWorking(true)
    let done = 0
    const conflicts: string[] = []
    for (const { item, suggestion } of list) {
      const title = (edits[item.id] ?? suggestion.title).trim()
      if (!title) continue
      const patch: Partial<CatalogItem> = { title, title_key: titleKey(item.category, item.media_type, title, item.media_format ?? null) }
      if (!item.seasons_count && suggestion.seasons_count && item.category !== 'games') patch.seasons_count = suggestion.seasons_count
      if (!item.year && suggestion.year) patch.year = suggestion.year
      const { error } = await supabase.from('catalog_items').update(patch).eq('id', item.id)
      if (error) conflicts.push(error.code === '23505' ? `« ${title} » existe déjà (doublon à fusionner)` : `${item.title} : ${error.message}`)
      else done++
    }
    await onChanged()
    setWorking(false)
    onMessage(`${plural(done, 'titre')} nettoyé${done > 1 ? 's' : ''}.${conflicts.length ? ` ${conflicts.length} non modifié${conflicts.length > 1 ? 's' : ''} : ${conflicts.slice(0, 3).join(' ; ')}` : ''}`, !conflicts.length)
  }
  async function renameAll() {
    const ok = await confirm({ title: `Nettoyer ${pending.length} titres ?`, body: 'Les balises de release, suffixes de saisons et capitales seront retirés selon les propositions affichées. Les affiches, prix et saisons ne changent pas. Vérifiez la liste avant de confirmer.', confirm: 'Appliquer les propositions' })
    if (ok) await rename(pending)
  }

  return <div className="admin-health">
    <section className="admin-card">
      <div className="admin-panel-head"><div><h2>Fiches incomplètes</h2><p>Cliquez sur un problème pour voir les titres concernés.</p></div>
        <div className="admin-row-actions"><button type="button" disabled={!translatable.length || posterJobRunning} onClick={() => void onRunPosterJob('translate', 'all', translatable.map((item) => item.id))}><Languages size={16} /> Traduire {plural(translatable.length, 'description')}</button><button type="button" className="button-primary" disabled={!incomplete.length || posterJobRunning} onClick={() => void onRunPosterJob('complete', 'all', incomplete.map((item) => item.id))}><Sparkles size={16} /> Compléter {plural(incomplete.length, 'fiche')}</button></div></div>
      <div className="issue-chips">{(Object.entries(counts) as [HealthIssue, number][]).map(([issue, count]) => <button type="button" key={issue} className={`issue-chip ${count ? '' : 'is-ok'}`} disabled={!count} onClick={() => onShowIssue(issue)}><span>{issueLabels[issue]}</span><strong>{count.toLocaleString('fr-FR')}</strong></button>)}</div>
      {counts.measure > 0 && <p className="scan-help">Les fiches sans mesure doivent être vérifiées à partir de vos fichiers ou de la fiche de l’œuvre. Cliquez sur « Saisons ou taille manquantes » ci-dessus pour les ouvrir et saisir une valeur exacte.</p>}
    </section>

    {sagas.length > 0 && <section className="admin-card">
      <div className="admin-panel-head"><div><h2><Layers size={20} aria-hidden="true" /> Sagas et regroupements à décomposer</h2><p>Ces fiches regroupent plusieurs œuvres (saga rangée par ordre de visionnage, collection de films, fichiers en vrac). Vérifiez la liste, une œuvre par ligne : « Titre ; 2 saisons » ou « Titre ; film ».</p></div></div>
      <div className="saga-list">{sagas.map((saga) => {
        const preset = sagaPreset(saga.title)
        const text = sagaTexts[saga.id] ?? formatWorks(preset?.works ?? [])
        const count = parseWorks(text).length
        return <div className="saga-card" key={saga.id}>
          <div className="saga-head"><Cover item={saga} sizes="44px" /><div><strong>{saga.title}</strong><small>{kindLabel(saga)} · {measureLabel(saga)}</small></div></div>
          <p className="admin-help">{preset ? preset.note : /^\[\s*\d+\s+fichiers?\s*\]$/i.test(saga.title.trim()) ? 'Cette fiche vient d’un rapport de disque et ne désigne aucune œuvre : retirez-la du catalogue.' : 'Aucune liste connue : saisissez les œuvres, ou scannez le dossier, le scanner découpe désormais les sagas automatiquement.'}</p>
          {isNoiseEntry(saga.title) ? <div className="admin-row-actions"><button type="button" className="button-danger" disabled={working} onClick={() => void removeNoise(saga)}><Trash2 size={15} /> Retirer cette fiche</button><button type="button" disabled={working} onClick={() => void hideSaga(saga)}><EyeOff size={15} /> Seulement masquer</button></div> : <><label className="saga-editor"><span className="visually-hidden">Œuvres de {saga.title}</span><textarea rows={Math.min(14, Math.max(4, count + 1))} value={text} onChange={(event) => setSagaTexts((current) => ({ ...current, [saga.id]: event.target.value }))} placeholder={'Titre de l’œuvre ; 2 saisons\nTitre du film ; film'} /></label>
          <div className="admin-row-actions"><button type="button" className="button-primary" disabled={working || !count} onClick={() => void decompose(saga)}><Layers size={15} /> Créer {plural(count, 'œuvre')} et masquer la fiche</button><button type="button" disabled={working} onClick={() => void hideSaga(saga)}><EyeOff size={15} /> Seulement masquer</button><button type="button" onClick={() => ignoreSaga(saga.id)}>Ce n’est pas une saga</button></div></>}
        </div>
      })}</div>
    </section>}

    <section className="admin-card">
      <div className="admin-panel-head"><div><h2>Titres à nettoyer</h2><p>{pending.length ? `${plural(pending.length, 'proposition')} : balises de release, suffixes « (5) », capitales criées. Modifiez une proposition avant de l’appliquer si besoin.` : 'Tous les titres sont propres.'}</p></div>
        {pending.length > 0 && <button type="button" className="button-primary" disabled={working} onClick={() => void renameAll()}><WandSparkles size={16} /> Tout appliquer</button>}</div>
      <div className="rename-list">{pending.slice(0, shown).map(({ item, suggestion }) => <div className="rename-row" key={item.id}>
        <Cover item={item} sizes="44px" />
        <div className="rename-before"><small>{categoryLabel(item.category)}</small><s>{item.title}</s></div>
        <ArrowRight size={16} aria-hidden="true" />
        <label className="rename-after"><span className="visually-hidden">Nouveau titre pour {item.title}</span><input value={edits[item.id] ?? suggestion.title} onChange={(event) => setEdits((value) => ({ ...value, [item.id]: event.target.value }))} /></label>
        <div className="rename-extra">{!item.seasons_count && suggestion.seasons_count ? <em>+ {suggestion.seasons_count} saisons</em> : null}{!item.year && suggestion.year ? <em>+ {suggestion.year}</em> : null}</div>
        <div className="admin-row-actions"><button type="button" disabled={working} onClick={() => void rename([{ item, suggestion }])}><Check size={15} /> Appliquer</button><button type="button" onClick={() => setSkipped((value) => new Set(value).add(item.id))}>Ignorer</button></div>
      </div>)}</div>
      {pending.length > shown && <button type="button" className="button-ghost" onClick={() => setShown((value) => value + 60)}>Afficher plus ({pending.length - shown} restantes)</button>}
    </section>

    <section className="admin-card">
      <div className="admin-panel-head"><div><h2>Doublons probables</h2><p>{duplicates.length ? 'Ces fiches désignent sans doute la même œuvre. Gardez la plus complète, reportez-y les saisons puis supprimez l’autre.' : 'Aucun doublon détecté.'}</p></div></div>
      <div className="duplicate-list">{duplicates.map((group) => <div className="duplicate-group" key={group.map((item) => item.id).join()}><Copy size={16} aria-hidden="true" />{group.map((item) => <button type="button" key={item.id} className="duplicate-item" onClick={() => onEdit(item)}><Cover item={item} sizes="40px" /><span><strong>{item.title}</strong><small>{kindLabel(item)} · {measureLabel(item)} · {item.poster_url ? 'affiche' : 'sans affiche'} · {item.active ? 'publié' : 'masqué'}</small></span></button>)}</div>)}</div>
    </section>
  </div>
}
