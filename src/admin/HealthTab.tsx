import { useMemo, useState } from 'react'
import { ArrowRight, Check, Copy, Sparkles, WandSparkles } from 'lucide-react'
import { supabase } from '../supabase'
import { Cover } from '../media'
import { kindLabel, measureLabel, plural } from '../display'
import { issueLabels, itemIssues, probableDuplicates, suggestTitle, type HealthIssue } from '../titleHealth'
import { categoryLabel, titleKey, type CatalogItem, type Category } from '../types'
import type { PosterJobKind } from '../App'
import type { Confirm } from './useConfirm'

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
        <button type="button" className="button-primary" disabled={!incomplete.length || posterJobRunning} onClick={() => void onRunPosterJob('complete', 'all', incomplete.map((item) => item.id))}><Sparkles size={16} /> Compléter {plural(incomplete.length, 'fiche')}</button></div>
      <div className="issue-chips">{(Object.entries(counts) as [HealthIssue, number][]).map(([issue, count]) => <button type="button" key={issue} className={`issue-chip ${count ? '' : 'is-ok'}`} disabled={!count} onClick={() => onShowIssue(issue)}><span>{issueLabels[issue]}</span><strong>{count.toLocaleString('fr-FR')}</strong></button>)}</div>
    </section>

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
