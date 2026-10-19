import { useState, type FormEvent } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { supabase } from '../supabase'
import { orderPriceCategories, orderPricingError } from '../orderPricing'
import type { OrderPricing, PriceRule, SiteSettings } from '../types'

const labels: Record<PriceRule['category'], string> = { series: 'Séries', anime: 'Animés · séries', 'anime-film': 'Films d’animation', novelas: 'Novelas', dramas: 'Dramas chinois et coréens' }
const numberOrNull = (value: string) => value === '' ? null : Number(value)

function copyGrid(value: OrderPricing): OrderPricing {
  return {
    prices: orderPriceCategories.map(category => ({ category, standard_price: null, threshold_seasons: null, threshold_price: null, currency: null, ...value.prices.find(rule => rule.category === category) })),
    gameTiers: value.gameTiers.map(tier => ({ min_gb: tier.min_gb, max_gb: tier.max_gb, price: tier.price, currency: tier.currency })),
    gameDiscount: { ...value.gameDiscount },
  }
}

export function OrderPricingPanel({ current, settings, onSaved }: { current: OrderPricing; settings: SiteSettings; onSaved: (value: OrderPricing | null) => void }) {
  const saved = settings.order_pricing
  const initial = saved && !orderPricingError(saved) ? saved : current
  const [custom, setCustom] = useState(Boolean(saved))
  const [draft, setDraft] = useState(() => copyGrid(initial))
  const [code, setCode] = useState(() => initial.prices.find(rule => rule.currency)?.currency ?? initial.gameTiers[0]?.currency ?? initial.gameDiscount.currency ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function changeRule(category: PriceRule['category'], field: 'standard_price' | 'threshold_seasons' | 'threshold_price', value: string) {
    setDraft(current => ({ ...current, prices: current.prices.map(rule => rule.category === category ? { ...rule, [field]: numberOrNull(value) } : rule) }))
  }
  function copyCurrent() {
    setDraft(copyGrid(current)); setCustom(true); setError('')
    setCode(current.prices.find(rule => rule.currency)?.currency ?? current.gameTiers[0]?.currency ?? current.gameDiscount.currency ?? '')
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!supabase || busy) return
    const currency = code.trim().toUpperCase()
    const values: OrderPricing | null = custom ? {
      prices: draft.prices.map(rule => ({ ...rule, currency: rule.standard_price === null ? null : currency })),
      gameTiers: draft.gameTiers.map(tier => ({ ...tier, currency })),
      gameDiscount: { ...draft.gameDiscount, currency: draft.gameDiscount.price_per_game === null ? null : currency },
    } : null
    const invalid = values ? orderPricingError(values) : null
    if (invalid) { setError(invalid); return }
    setBusy(true); setError('')
    try {
      // One atomic update; unchanged catalog rates and WhatsApp number are omitted.
      const { data, error } = await supabase.from('site_settings').update({ order_pricing: values }).eq('id', true)
        .select('order_pricing').abortSignal(AbortSignal.timeout(10000)).single()
      if (error) throw new Error(['PGRST204', '42703'].includes(error.code) ? 'La configuration des commandes doit être activée dans Supabase avec la migration order_pricing_settings.' : 'Enregistrement impossible. Vérifiez la connexion et votre session administrateur, puis réessayez.')
      if (!data || (data.order_pricing && orderPricingError(data.order_pricing))) throw new Error('La grille enregistrée n’a pas pu être vérifiée.')
      onSaved(data.order_pricing as OrderPricing | null)
    } catch (failure) {
      setError(failure instanceof Error && failure.name !== 'TimeoutError' ? failure.message : 'La sauvegarde prend trop de temps. Vos saisies sont conservées ; réessayez.')
    } finally { setBusy(false) }
  }
  return <section className="admin-panel">
    <div className="admin-panel-head"><div><h2>Tarifs des commandes hors catalogue</h2><p>Cette grille sert aux estimations des titres absents du catalogue sur la page « Commander ». Les prix sont revérifiés avant l’ouverture de WhatsApp.</p></div></div>
    <form className="price-form" onSubmit={save} aria-busy={busy}>
      <label className="order-pricing-mode"><input type="checkbox" checked={custom} disabled={busy} onChange={event => setCustom(event.target.checked)} /> Définir une grille spécifique pour les commandes hors catalogue</label>
      {!custom && <p className="scan-help">Les commandes utilisent actuellement les tarifs du catalogue. Activez la grille spécifique ou reprenez les tarifs actuels pour les adapter.</p>}
      <button type="button" className="button-secondary" disabled={busy} onClick={copyCurrent}>Reprendre tous les tarifs actuels du catalogue</button>
      <fieldset className="order-pricing-fields" disabled={!custom || busy}>
        <legend className="visually-hidden">Grille de prix des commandes</legend>
        <label>Devise commune (code ISO à 3 lettres)<input value={code} maxLength={3} placeholder="XAF, XOF, EUR…" onChange={event => setCode(event.target.value.toUpperCase().slice(0, 3))} /></label>
        {orderPriceCategories.map(category => {
          const rule = draft.prices.find(entry => entry.category === category)!
          return <div className="price-group" key={category}><h3>{labels[category]}</h3><div className="price-grid">
            <label>{category === 'anime-film' ? 'Prix fixe par film' : 'Prix standard par saison'}<input type="number" min="0.01" step="0.01" value={rule.standard_price ?? ''} placeholder="Non défini" onChange={event => changeRule(category, 'standard_price', event.target.value)} /></label>
            {category !== 'anime-film' && <><label>Nombre de saisons pour la remise<input type="number" min="2" step="1" value={rule.threshold_seasons ?? ''} placeholder="Ex. 3" onChange={event => changeRule(category, 'threshold_seasons', event.target.value)} /></label><label>Prix par saison dès ce seuil<input type="number" min="0.01" step="0.01" value={rule.threshold_price ?? ''} placeholder="Sans remise" onChange={event => changeRule(category, 'threshold_price', event.target.value)} /></label></>}
          </div></div>
        })}
        <div className="price-group"><h3>Jeux PC · paliers de poids</h3><p>Poids arrondi au Go supérieur. Sans poids connu, le prix reste à confirmer sur WhatsApp.</p>
          {draft.gameTiers.map((tier, index) => <div className="tier-row" key={index}>
            <label>De (Go)<input type="number" required min="1" step="1" value={tier.min_gb || ''} onChange={event => setDraft(current => ({ ...current, gameTiers: current.gameTiers.map((entry, i) => i === index ? { ...entry, min_gb: Number(event.target.value) } : entry) }))} /></label>
            <label>À (Go)<input type="number" required min="1" step="1" value={tier.max_gb || ''} onChange={event => setDraft(current => ({ ...current, gameTiers: current.gameTiers.map((entry, i) => i === index ? { ...entry, max_gb: Number(event.target.value) } : entry) }))} /></label>
            <label>Prix<input type="number" required min="0.01" step="0.01" value={tier.price || ''} onChange={event => setDraft(current => ({ ...current, gameTiers: current.gameTiers.map((entry, i) => i === index ? { ...entry, price: Number(event.target.value) } : entry) }))} /></label>
            <button type="button" className="button-secondary" onClick={() => setDraft(current => ({ ...current, gameTiers: current.gameTiers.filter((_, i) => i !== index) }))}>Retirer</button>
          </div>)}
          <button type="button" className="button-secondary" onClick={() => setDraft(current => ({ ...current, gameTiers: [...current.gameTiers, { min_gb: (current.gameTiers.at(-1)?.max_gb ?? 0) + 1, max_gb: (current.gameTiers.at(-1)?.max_gb ?? 0) + 50, price: 0, currency: code }] }))}>Ajouter un palier</button>
        </div>
        <div className="price-group"><h3>Remise selon le nombre de jeux</h3><p>Une commande d’un seul jeu utilise son palier de poids. Ce tarif de volume nécessite une commande regroupant le nombre de jeux indiqué.</p><div className="price-grid">
          <label>Nombre de jeux requis<input type="number" min="2" step="1" value={draft.gameDiscount.min_games ?? ''} placeholder="Sans remise" onChange={event => setDraft(current => ({ ...current, gameDiscount: { ...current.gameDiscount, min_games: numberOrNull(event.target.value) } }))} /></label>
          <label>Prix par jeu dès ce nombre<input type="number" min="0.01" step="0.01" value={draft.gameDiscount.price_per_game ?? ''} placeholder="Non défini" onChange={event => setDraft(current => ({ ...current, gameDiscount: { ...current.gameDiscount, price_per_game: numberOrNull(event.target.value) } }))} /></label>
        </div></div>
      </fieldset>
      <p className="scan-help">Laissez un tarif vide pour afficher « Prix à confirmer ». Un prix nul ou un chevauchement de paliers ne peut pas être enregistré.</p>
      {error && <p className="order-warning" role="alert">{error}</p>}
      <button type="submit" className="button-primary" disabled={busy || !supabase}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} {busy ? 'Enregistrement…' : 'Enregistrer les tarifs des commandes'}</button>
    </form>
  </section>
}
