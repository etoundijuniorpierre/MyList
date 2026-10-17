import { needsCompletion } from '../metadataDecisions'
import { useMemo, type CSSProperties } from 'react'
import { ArrowRight, CircleAlert, FolderSearch, ListPlus, MessageCircle, Plus, Sparkles } from 'lucide-react'
import { Cover } from '../media'
import { categoryMeta, plural } from '../display'
import { itemIssues, issueLabels, type HealthIssue } from '../titleHealth'
import { categories, type CatalogItem, type GamePriceTier, type PriceRule, type SiteSettings } from '../types'
import type { AdminTab } from './tabs'

interface Props {
  items: CatalogItem[]
  prices: PriceRule[]
  gameTiers: GamePriceTier[]
  settings: SiteSettings
  posterJobRunning: boolean
  onGo: (tab: AdminTab, issue?: HealthIssue) => void
  onComplete: () => void
}

export function Overview({ items, prices, gameTiers, settings, posterJobRunning, onGo, onComplete }: Props) {
  const stats = useMemo(() => categories.map((entry) => {
    const list = items.filter((item) => item.category === entry.key)
    const pct = (test: (item: CatalogItem) => boolean) => list.length ? Math.round(list.filter(test).length / list.length * 100) : 0
    return { ...entry, total: list.length, hidden: list.filter((item) => !item.active).length, poster: pct((item) => Boolean(item.poster_url)), synopsis: pct((item) => Boolean(item.synopsis?.trim())), genres: pct((item) => item.genres.length > 0) }
  }), [items])
  const issues = useMemo(() => {
    const counts: Record<HealthIssue, number> = { poster: 0, synopsis: 0, genres: 0, year: 0, measure: 0, title: 0, seasons: 0 }
    for (const item of items) for (const issue of itemIssues(item)) counts[issue]++
    return counts
  }, [items])
  const recent = useMemo(() => [...items].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, 8), [items])
  const incomplete = items.filter(needsCompletion).length
  const unpriced = (['series', 'anime', 'novelas', 'dramas'] as const).filter((category) => items.some((item) => item.category === category) && prices.find((rule) => rule.category === category)?.standard_price == null)
  const checklist = [
    { ok: Boolean(settings.whatsapp_number), text: settings.whatsapp_number ? 'Numéro WhatsApp configuré' : 'Aucun numéro WhatsApp : les visiteurs ne peuvent pas envoyer leur panier', tab: 'settings' as AdminTab },
    { ok: !unpriced.length, text: unpriced.length ? `Sans tarif : ${unpriced.map((category) => categories.find((entry) => entry.key === category)!.label).join(', ')}` : 'Tous les univers ont un tarif', tab: 'prices' as AdminTab },
    { ok: !items.some((item) => item.category === 'games') || gameTiers.length > 0, text: gameTiers.length ? `${plural(gameTiers.length, 'palier')} de prix pour les jeux` : 'Aucun palier de prix pour les jeux PC', tab: 'prices' as AdminTab },
    { ok: issues.title === 0, text: issues.title ? `${plural(issues.title, 'titre')} à nettoyer (balises, capitales, suffixes)` : 'Titres propres', tab: 'health' as AdminTab },
  ]
  return <div className="admin-overview">
    <div className="kpi-grid">
      <div className="kpi"><span>Titres au catalogue</span><strong>{items.length.toLocaleString('fr-FR')}</strong><small>{plural(items.filter((item) => !item.active).length, 'masqué')}</small></div>
      <div className="kpi"><span>Avec affiche</span><strong>{items.length ? Math.round((1 - issues.poster / items.length) * 100) : 0} %</strong><small>{plural(issues.poster, 'manquante')}</small></div>
      <div className="kpi"><span>Avec description</span><strong>{items.length ? Math.round((1 - issues.synopsis / items.length) * 100) : 0} %</strong><small>{plural(issues.synopsis, 'manquante')}</small></div>
      <div className="kpi"><span>Saisons au total</span><strong>{items.reduce((sum, item) => sum + (item.seasons_count ?? 0), 0).toLocaleString('fr-FR')}</strong><small>{Math.round(items.reduce((sum, item) => sum + (Number(item.game_size_gb) || 0), 0)).toLocaleString('fr-FR')} Go de jeux</small></div>
    </div>

    <div className="overview-columns">
      <section className="admin-card">
        <h2>État de la boutique</h2>
        <ul className="checklist">{checklist.map((entry) => <li key={entry.text} className={entry.ok ? 'is-ok' : 'is-warn'}><span aria-hidden="true">{entry.ok ? '✓' : '!'}</span><p>{entry.text}</p>{!entry.ok && <button type="button" className="text-button" onClick={() => onGo(entry.tab)}>Régler <ArrowRight size={14} /></button>}</li>)}</ul>
        <div className="quick-actions">
          <button type="button" className="quick" onClick={() => onGo('add')}><Plus size={18} /> Ajouter un titre</button>
          <button type="button" className="quick" onClick={() => onGo('scan')}><FolderSearch size={18} /> Scanner un disque</button>
          <button type="button" className="quick" onClick={() => onGo('bulk')}><ListPlus size={18} /> Importer une liste</button>
          <button type="button" className="quick" onClick={() => onGo('settings')}><MessageCircle size={18} /> WhatsApp</button>
        </div>
      </section>
      <section className="admin-card">
        <h2>Qualité des fiches</h2>
        <ul className="issue-list">{(Object.entries(issues) as [HealthIssue, number][]).filter(([, count]) => count).map(([issue, count]) => <li key={issue}><button type="button" onClick={() => onGo(issue === 'title' ? 'health' : 'catalog', issue)}><CircleAlert size={15} aria-hidden="true" /> <span>{issueLabels[issue]}</span><strong>{count.toLocaleString('fr-FR')}</strong></button></li>)}</ul>
        <button type="button" className="button-primary full" disabled={!incomplete || posterJobRunning} onClick={onComplete}><Sparkles size={17} /> {posterJobRunning ? 'Traitement en cours…' : `Compléter ${plural(incomplete, 'fiche')} automatiquement`}</button>
        <p className="admin-help">Interroge AniList, MyAnimeList, Kitsu, TVMaze, TheTVDB, IGDB/RAWG/Steam et Wikipédia. Seuls les champs vides sont remplis ; la traduction française est automatique.</p>
      </section>
    </div>

    <section className="admin-card">
      <h2>Par univers</h2>
      <div className="universe-table" role="table" aria-label="Complétude par univers">
        <div role="row" className="universe-row head"><span role="columnheader">Univers</span><span role="columnheader">Titres</span><span role="columnheader">Affiches</span><span role="columnheader">Descriptions</span><span role="columnheader">Genres</span></div>
        {stats.map((entry) => <div role="row" className="universe-row" key={entry.key} style={{ '--accent': categoryMeta[entry.key].accent } as CSSProperties}>
          <span role="cell" className="universe-name">{entry.label}</span>
          <span role="cell">{entry.total.toLocaleString('fr-FR')}{entry.hidden ? <small> · {entry.hidden} masqué{entry.hidden > 1 ? 's' : ''}</small> : null}</span>
          {[entry.poster, entry.synopsis, entry.genres].map((value, index) => <span role="cell" key={index} className="meter-cell"><span className="meter"><span style={{ width: `${value}%` }} /></span>{value} %</span>)}
        </div>)}
      </div>
    </section>

    <section className="admin-card">
      <h2>Derniers ajouts</h2>
      <div className="recent-grid">{recent.map((item) => <div className="recent-item" key={item.id}><Cover item={item} sizes="80px" /><span>{item.title}</span></div>)}</div>
    </section>
  </div>
}
