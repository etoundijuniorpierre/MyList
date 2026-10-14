import { createContext, useContext } from 'react'
import type { CatalogItem, GameCountDiscount, GamePriceTier, PriceRule, SiteSettings } from '../types'

export interface Toast { id: number; text: string; action?: { label: string; run: () => void } }

export interface SiteState {
  items: CatalogItem[]
  selection: string[]
  selectedItems: CatalogItem[]
  toggle: (item: Pick<CatalogItem, 'id' | 'title'>) => void
  clearSelection: () => void
  prices: PriceRule[]
  gameTiers: GamePriceTier[]
  gameDiscount: GameCountDiscount
  settings: SiteSettings
  isAdmin: boolean
  openSearch: () => void
  notify: (text: string, action?: Toast['action']) => void
}

export const SiteContext = createContext<SiteState | null>(null)

export function useSite() {
  const value = useContext(SiteContext)
  if (!value) throw new Error('SiteContext manquant')
  return value
}
