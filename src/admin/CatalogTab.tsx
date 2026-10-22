import { useEffect, useMemo, useState } from 'react'
import { Download, Eye, EyeOff, Search, Sparkles, Trash2 } from 'lucide-react'
import { supabase } from '../supabase'
import { Cover } from '../media'
import { categoryMeta, kindLabel, measureLabel, plural } from '../display'
import { isCachedPosterUrl } from '../metadata'
import { issueLabels, itemIssues, type HealthIssue } from '../titleHealth'
import { categories, normalizeTitle, type CatalogItem, type Category } from '../types'
import type { PosterJobKind } from '../App'
import type { Confirm } from './useConfirm'
import { needsCoreCompletion } from '../metadataDecisions'

const PAGE = 50
type Status = 'all' | 'active' | 'hidden'
type Sort = 'recent' | 'az' | 'old'

interface Props {
  items: CatalogItem[]
  busy: boolean
  pendingIds: Set<string>
  posterJobRunning: boolean
  initialIssue: HealthIssue | ''
  confirm: Confirm
  onEdit: (item: CatalogItem) => void
  onChanged: () => Promise<void>
  onMessage: (text: string, success?: boolean) => void
  onRunPosterJob: (kind: PosterJobKind, filter: Category | 'all', ids?: string[]) => Promise<void>
}

export function CatalogTab({ items, busy, pendingIds, posterJobRunning, initialIssue, confirm, onEdit, onChanged, onMessage, onRunPosterJob }: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [status, setStatus] = useState<Status>('all')
  const [issue, setIssue] = useState<HealthIssue | ''>(initialIssue)
  const [sort, setSort] = useState<Sort>('recent')
  const [page, setPage] = useState(1)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState(false)
  useEffect(() => { setIssue(initialIssue) }, [initialIssue])
  useEffect(() => { setPage(1) }, [query, category, status, issue, sort])
  const issuesById = useMemo(() => new Map(items.map((item) => [item.id, itemIssues(item)])), [items])
  const filtered = useMemo(() => {
    const needle = normalizeTitle(query)
    const list = items.filter((item) => (category === 'all' || item.category === category)
      && (status === 'all' || (status === 'active' ? item.active : !item.active))
      && (!issue || (issuesById.get(item.id) ?? []).includes(issue))
      && (!needle || normalizeTitle(`${item.title} ${item.genres.join(' ')}`).includes(needle)))
    if (sort === 'az') list.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }))
    else list.sort((a, b) => (sort === 'old' ? 1 : -1) * (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    return list
  }, [items, issuesById, query, category, status, issue, sort])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE))
  const current = Math.min(page, pageCount)
  const visible = filtered.slice((current - 1) * PAGE, current * PAGE)
  const allVisibleChecked = visible.length > 0 && visible.every((item) => checked.has(item.id))
  const checkedItems = items.filter((item) => checked.has(item.id))

  async function inChunks(ids: string[], run: (chunk: string[]) => PromiseLike<{ error: { message: string } | null }>) {
    for (let start = 0; start < ids.length; start += 100) {
      const { error } = await run(ids.slice(start, start + 100))
      if (error) throw new Error(error.message)
    }
  }
  async function setActive(ids: string[], active: boolean) {
    if (!supabase || !ids.length) return
    if (ids.some(id => pendingIds.has(id))) { onMessage('Une fiche sélectionnée est en cours d’enregistrement. Attendez sa confirmation.'); return }
    setWorking(true)
    try {
      await inChunks(ids, (chunk) => supabase!.from('catalog_items').update({ active }).in('id', chunk))
      await onChanged(); setChecked(new Set())
      onMessage(`${plural(ids.length, 'titre')} ${active ? 'publié' : 'masqué'}${ids.length > 1 ? 's' : ''}.`, true)
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Modification impossible.') }
    finally { setWorking(false) }
  }
  async function remove(list: CatalogItem[]) {
    if (!supabase || !list.length) return
    if (list.some(item => pendingIds.has(item.id))) { onMessage('Une fiche sélectionnée est en cours d’enregistrement. Attendez sa confirmation.'); return }
    const ok = await confirm(list.length === 1
      ? { title: 'Supprimer ce titre ?', body: `« ${list[0].title} » sera retiré définitivement du catalogue. Pour le cacher sans le perdre, utilisez plutôt « Masquer ».`, confirm: 'Supprimer', danger: true }
      : { title: `Supprimer ${list.length} titres ?`, body: 'Cette suppression est définitive. Exportez une sauvegarde avant si vous avez un doute.', confirm: 'Supprimer définitivement', danger: true, typed: 'SUPPRIMER' })
    if (!ok) return
    setWorking(true)
    try {
      await inChunks(list.map((item) => item.id), (chunk) => supabase!.from('catalog_items').delete().in('id', chunk))
      await onChanged(); setChecked(new Set())
      onMessage(`${plural(list.length, 'titre')} supprimé${list.length > 1 ? 's' : ''}.`, true)
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Suppression impossible.') }
    finally { setWorking(false) }
  }
  function exportRows(list: CatalogItem[], format: 'csv' | 'json') {
    const fields = ['id', 'category', 'media_type', 'media_format', 'title', 'year', 'seasons_count', 'game_size_gb', 'genres', 'active', 'poster_url', 'source', 'source_url', 'synopsis'] as const
    const body = format === 'json' ? JSON.stringify(list, null, 2)
      : '﻿' + [fields.join(';'), ...list.map((item) => fields.map((field) => { const value = item[field]; const text = Array.isArray(value) ? value.join(', ') : value ?? ''; return `"${String(text).replace(/"/g, '""')}"` }).join(';'))].join('\r\n')
    const url = URL.createObjectURL(new Blob([body], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `ma-liste-${new Date().toISOString().slice(0, 10)}.${format}`
    link.click(); URL.revokeObjectURL(url)
  }
  const disabled = busy || working

  return <section className="admin-panel">
    <div className="admin-panel-head">
      <div><h2>Titres enregistrés</h2><p>{plural(filtered.length, 'titre')}{filtered.length !== items.length ? ` sur ${items.length.toLocaleString('fr-FR')}` : ''}</p></div>
      <div className="head-actions">
        <button type="button" className="button-ghost" onClick={() => exportRows(checkedItems.length ? checkedItems : filtered, 'csv')}><Download size={15} /> CSV</button>
        <button type="button" className="button-ghost" onClick={() => exportRows(checkedItems.length ? checkedItems : filtered, 'json')}><Download size={15} /> Sauvegarde JSON</button>
      </div>
    </div>
    <div className="admin-filters">
      <label className="search-field"><Search size={17} aria-hidden="true" /><span className="visually-hidden">Rechercher un titre</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un titre ou un genre…" /></label>
      <label className="select-field"><span className="visually-hidden">Univers</span><select value={category} onChange={(event) => setCategory(event.target.value as Category | 'all')}><option value="all">Tous les univers</option>{categories.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>
      <label className="select-field"><span className="visually-hidden">Statut</span><select value={status} onChange={(event) => setStatus(event.target.value as Status)}><option value="all">Publiés et masqués</option><option value="active">Publiés</option><option value="hidden">Masqués</option></select></label>
      <label className="select-field"><span className="visually-hidden">Problème</span><select value={issue} onChange={(event) => setIssue(event.target.value as HealthIssue | '')}><option value="">Toutes les fiches</option>{(Object.entries(issueLabels) as [HealthIssue, string][]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="select-field"><span className="visually-hidden">Tri</span><select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="recent">Plus récents</option><option value="old">Plus anciens</option><option value="az">A → Z</option></select></label>
    </div>
    <div className="job-actions">
      <button type="button" className="button-ghost" disabled={disabled || posterJobRunning || !filtered.some(needsCoreCompletion)} onClick={() => void onRunPosterJob('complete', 'all', filtered.filter(needsCoreCompletion).map((item) => item.id))}><Sparkles size={15} /> Compléter les fiches affichées</button>
      <button type="button" className="button-ghost" disabled={disabled || posterJobRunning || !items.some((item) => item.poster_url && !isCachedPosterUrl(item.poster_url))} onClick={() => void onRunPosterJob('cache', category)}>Copier les affiches sur Supabase</button>
      <button type="button" className="button-ghost" title="Vérifie les proportions et ne remplace que les affiches paysage ou illisibles." disabled={disabled || posterJobRunning || !items.some((item) => item.category === 'games' && item.poster_url)} onClick={() => void onRunPosterJob('repair-games', 'games')}>Corriger les jaquettes paysage</button>
    </div>
    {checked.size > 0 && <div className="bulk-bar" role="region" aria-label="Actions groupées">
      <strong>{plural(checked.size, 'titre')} sélectionné{checked.size > 1 ? 's' : ''}</strong>
      <button type="button" className="button-ghost" disabled={disabled} onClick={() => void setActive([...checked], true)}><Eye size={15} /> Publier</button>
      <button type="button" className="button-ghost" disabled={disabled} onClick={() => void setActive([...checked], false)}><EyeOff size={15} /> Masquer</button>
      <button type="button" className="button-ghost" disabled={disabled || posterJobRunning} onClick={() => void onRunPosterJob('complete', 'all', [...checked])}><Sparkles size={15} /> Compléter</button>
      <button type="button" className="button-danger" disabled={disabled} onClick={() => void remove(checkedItems)}><Trash2 size={15} /> Supprimer</button>
      <button type="button" className="text-button" onClick={() => setChecked(new Set())}>Tout désélectionner</button>
    </div>}
    <div className="admin-list" role="list">
      {visible.length > 0 && <label className="admin-row admin-row-head"><input type="checkbox" checked={allVisibleChecked} onChange={(event) => setChecked((value) => { const next = new Set(value); visible.forEach((item) => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next })} /> <span>Sélectionner la page</span>{filtered.length > visible.length && <button type="button" className="text-button" onClick={() => setChecked(new Set(filtered.map((item) => item.id)))}>Sélectionner les {filtered.length.toLocaleString('fr-FR')}</button>}</label>}
      {visible.map((item) => {
        const problems = issuesById.get(item.id) ?? []
        const saving = pendingIds.has(item.id)
        return <div className={`admin-row ${item.active ? '' : 'is-hidden'}`} role="listitem" key={item.id}>
          <input type="checkbox" aria-label={`Sélectionner ${item.title}`} checked={checked.has(item.id)} onChange={(event) => setChecked((value) => { const next = new Set(value); event.target.checked ? next.add(item.id) : next.delete(item.id); return next })} />
          <Cover item={item} sizes="52px" />
          <div className="admin-row-title">
            <strong>{item.title}</strong>
            <span><i style={{ background: categoryMeta[item.category].accent }} aria-hidden="true" />{kindLabel(item)} · {measureLabel(item)} · {item.year ?? 'année ?'}{item.genres.length ? ` · ${item.genres.slice(0, 3).join(', ')}` : ''}</span>
            {problems.length > 0 && <span className="row-issues">{problems.map((entry) => <em key={entry}>{issueLabels[entry]}</em>)}</span>}
          </div>
          <span className={`status-badge ${item.active ? 'is-on' : ''}`}>{item.active ? 'Publié' : 'Masqué'}</span>
          <div className="admin-row-actions">
            <button type="button" disabled={saving} onClick={() => onEdit(item)}>{saving ? 'Enregistrement…' : 'Modifier'}</button>
            <button type="button" disabled={disabled || saving} onClick={() => void setActive([item.id], !item.active)}>{item.active ? 'Masquer' : 'Publier'}</button>
            <a href={`${categoryMeta[item.category].route}?titre=${encodeURIComponent(item.id)}`} target="_blank" rel="noopener" aria-label={`Voir ${item.title} sur le site`}><Eye size={15} /></a>
            <button type="button" className="danger-text" disabled={disabled || saving} aria-label={`Supprimer ${item.title}`} onClick={() => void remove([item])}><Trash2 size={16} /></button>
          </div>
        </div>
      })}
      {!filtered.length && <p className="empty-admin">Aucun titre ne correspond à ces filtres.</p>}
    </div>
    {pageCount > 1 && <nav className="admin-pagination" aria-label="Pages"><button type="button" className="button-ghost" disabled={current === 1} onClick={() => setPage(current - 1)}>Précédent</button><span>Page {current} sur {pageCount}</span><button type="button" className="button-ghost" disabled={current === pageCount} onClick={() => setPage(current + 1)}>Suivant</button></nav>}
  </section>
}
