import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Copy, Heart, LoaderCircle, Send, Trash2, TrendingDown } from 'lucide-react'
import { Cover, formatPrice } from '../media'
import { discountProgress, itemPrice, standardItemPrice } from '../pricing'
import { categoryMeta, kindLabel, measureLabel, plural, setPageMeta } from '../display'
import { categories } from '../types'
import { useSite } from './context'

const NAME_KEY = 'mylist-customer-name'

export function SelectionPage({ loading }: { loading: boolean }) {
  const { selectedItems: items, toggle, clearSelection, prices, gameTiers, gameDiscount, settings, notify } = useSite()
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } })
  const [confirmClear, setConfirmClear] = useState(false)
  useEffect(() => { setPageMeta('Mon panier') }, [])
  useEffect(() => { try { localStorage.setItem(NAME_KEY, name) } catch { /* Le prénom reste facultatif. */ } }, [name])
  const priced = items.map((item) => ({ item, pricing: itemPrice(item, items, prices, gameTiers, gameDiscount), standard: standardItemPrice(item, prices, gameTiers) }))
  const missingPrice = priced.some(({ pricing }) => !pricing)
  const currencies = [...new Set(priced.map(({ pricing }) => pricing?.currency).filter(Boolean))]
  const currency = currencies.length === 1 ? currencies[0]! : null
  const total = !missingPrice && currency ? priced.reduce((sum, { pricing }) => sum + (pricing?.amount ?? 0), 0) : null
  const standardTotal = priced.every(({ standard }) => standard !== null) ? priced.reduce((sum, { standard }) => sum + (standard ?? 0), 0) : null
  const savings = total !== null && standardTotal !== null && standardTotal > total ? standardTotal - total : 0
  const progress = discountProgress(items, prices, gameDiscount, formatPrice)
  const canSend = Boolean(items.length && settings.whatsapp_number && total !== null)

  function message() {
    const lines = categories.flatMap((category) => {
      const entries = priced.filter(({ item }) => item.category === category.key)
      return entries.length ? [`*${category.label.toUpperCase()}*`, ...entries.map(({ item, pricing }, index) => `${index + 1}. ${item.title}${item.media_type === 'chinese-drama' || item.media_type === 'korean-drama' || item.media_format === 'film' ? ` [${kindLabel(item)}]` : ''} (${pricing?.detail ?? measureLabel(item)})${pricing ? ` — ${formatPrice(pricing.amount, pricing.currency)}` : ''}`), ''] : []
    })
    const greeting = name.trim() ? `Bonjour, c’est ${name.trim()}. Je souhaite ce panier Ma Liste :` : 'Bonjour, je souhaite ce panier Ma Liste :'
    return `${greeting}\n\n${lines.join('\n')}\n${total !== null && currency ? `*Total : ${formatPrice(total, currency)}*` : ''}${savings && currency ? `\n(remises incluses : −${formatPrice(savings, currency)})` : ''}\n\nMerci !`
  }
  function send() {
    if (!canSend) return
    window.open(`https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent(message())}`, '_blank', 'noopener,noreferrer')
  }
  async function copy() {
    try { await navigator.clipboard.writeText(message()); notify('Liste copiée dans le presse-papiers.') }
    catch { notify('La copie est bloquée par le navigateur.') }
  }

  return <main id="contenu" tabIndex={-1} className="interior-page selection-page">
    <div className="page-intro"><span className="eyebrow">Vos choix</span><h1>Mon panier</h1><p>{items.length ? `${plural(items.length, 'titre')} prêt${items.length > 1 ? 's' : ''} à partir.` : 'Regroupez vos coups de cœur avant de nous les envoyer.'}</p></div>
    {loading && !items.length ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={26} aria-hidden="true" /><p>Chargement du panier…</p></div>
      : !items.length ? <div className="empty-state"><Heart size={30} aria-hidden="true" /><h2>Votre panier est vide</h2><p>Ajoutez quelques titres depuis les univers.</p><div className="universe-links compact">{categories.map((entry) => <Link key={entry.key} to={categoryMeta[entry.key].route} style={{ '--accent': categoryMeta[entry.key].accent } as CSSProperties}><span>{entry.label}</span><ArrowRight size={16} aria-hidden="true" /></Link>)}</div></div>
      : <div className="selection-layout">
        <div className="selection-items">
          {progress.length > 0 && <div className="progress-panel" aria-label="Remises de volume">{progress.map((entry) => <div key={entry.key} className={`progress-item ${entry.reached ? 'is-reached' : ''}`}>
            <div className="progress-text">{entry.reached ? <Check size={16} aria-hidden="true" /> : <TrendingDown size={16} aria-hidden="true" />}<span>{entry.reached ? <><strong>{entry.label} :</strong> tarif réduit activé, {entry.reward}.</> : <><strong>{entry.label} :</strong> encore {plural(entry.target - entry.current, entry.unit)} pour passer à {entry.reward}.</>}</span></div>
            <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={entry.target} aria-valuenow={Math.min(entry.current, entry.target)} aria-label={`${entry.label} : ${entry.current} sur ${entry.target}`}><span style={{ width: `${Math.min(100, entry.current / entry.target * 100)}%` }} /></div>
          </div>)}</div>}
          {categories.map((category) => {
            const entries = priced.filter(({ item }) => item.category === category.key)
            if (!entries.length) return null
            const sub = entries.every(({ pricing }) => pricing && pricing.currency === entries[0].pricing?.currency) ? entries.reduce((sum, { pricing }) => sum + pricing!.amount, 0) : null
            return <section className="selection-group" key={category.key} style={{ '--accent': categoryMeta[category.key].accent } as CSSProperties} aria-label={category.label}>
              <div className="selection-group-head"><h2>{category.label}</h2><span>{plural(entries.length, 'titre')}{sub !== null && entries[0].pricing ? ` · ${formatPrice(sub, entries[0].pricing.currency)}` : ''}</span></div>
              {entries.map(({ item, pricing, standard }) => <div className="selection-row" key={item.id}>
                <Link to={`${categoryMeta[item.category].route}?titre=${encodeURIComponent(item.id)}`} className="selection-cover" aria-label={`Voir la fiche de ${item.title}`}><Cover item={item} sizes="72px" /></Link>
                <div className="selection-info"><span className="row-kind">{kindLabel(item)}</span><h3>{item.title}</h3><p>{pricing?.detail ?? measureLabel(item)}</p></div>
                <div className="row-end">
                  <strong>{pricing ? formatPrice(pricing.amount, pricing.currency) : 'Prix à venir'}</strong>
                  {pricing && standard !== null && standard > pricing.amount && <s>{formatPrice(standard, pricing.currency)}</s>}
                  <button type="button" className="icon-button" onClick={() => toggle(item)} aria-label={`Retirer ${item.title} du panier`}><Trash2 size={17} /></button>
                </div>
              </div>)}
            </section>
          })}
          <div className="selection-tools">{confirmClear ? <><span>Vider tout le panier ?</span><button type="button" className="button-danger" onClick={() => { clearSelection(); setConfirmClear(false) }}>Oui, vider</button><button type="button" className="button-ghost" onClick={() => setConfirmClear(false)}>Annuler</button></> : <button type="button" className="text-button" onClick={() => setConfirmClear(true)}><Trash2 size={14} /> Vider le panier</button>}</div>
        </div>
        <aside className="summary-card" aria-labelledby="summary-title">
          <span className="eyebrow">Récapitulatif</span>
          <h2 id="summary-title">Votre demande</h2>
          <div className="summary-line"><span>Titres</span><strong>{items.length}</strong></div>
          {savings > 0 && currency && <div className="summary-line summary-savings"><span>Remises de volume</span><strong>−{formatPrice(savings, currency)}</strong></div>}
          <div className="summary-total"><span>Total estimé</span><strong>{total !== null && currency ? formatPrice(total, currency) : 'À définir'}</strong></div>
          <label className="summary-name">Votre prénom <small>(facultatif)</small><input value={name} onChange={(event) => setName(event.target.value.slice(0, 40))} autoComplete="given-name" placeholder="Pour personnaliser le message" /></label>
          {missingPrice && <p className="notice">Le prix de certains titres n’est pas encore défini : l’envoi sera possible dès qu’il le sera.</p>}
          {currencies.length > 1 && <p className="notice">Les tarifs utilisent plusieurs devises : contactez-nous directement.</p>}
          {!settings.whatsapp_number && <p className="notice">Le numéro WhatsApp de réception n’est pas encore configuré.</p>}
          <button type="button" className="button-whatsapp full" onClick={send} disabled={!canSend}><Send size={17} /> Envoyer sur WhatsApp</button>
          <button type="button" className="button-ghost full" onClick={() => void copy()}><Copy size={16} /> Copier la liste</button>
          <p className="summary-footnote">WhatsApp s’ouvre avec votre liste et le total. Vous relisez le message avant de l’envoyer.</p>
        </aside>
      </div>}
  </main>
}
