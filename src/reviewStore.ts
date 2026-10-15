import type { Candidate } from './metadataMatch'

/** Fiches que la recherche automatique n'a pas osé compléter, avec les œuvres qu'elle a trouvées. */
export interface ReviewEntry {
  itemId: string
  title: string
  query: string | null
  candidates: Candidate[]
  /** L'administrateur a indiqué qu'aucune proposition ne convient : la recherche automatique ne la reprend plus. */
  dismissed?: boolean
  at: number
}

export const REVIEW_KEY = 'mylist-review-v1'
export const REVIEW_EVENT = 'mylist-review-change'

export function readReviews(): Record<string, ReviewEntry> {
  try {
    const value = JSON.parse(localStorage.getItem(REVIEW_KEY) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, ReviewEntry> : {}
  } catch { return {} }
}

function write(entries: Record<string, ReviewEntry>) {
  try { localStorage.setItem(REVIEW_KEY, JSON.stringify(entries)) } catch {
    // Stockage plein : on garde les entrées les plus récentes plutôt que de tout perdre.
    const recent = Object.fromEntries(Object.entries(entries).sort((a, b) => b[1].at - a[1].at).slice(0, 150))
    try { localStorage.setItem(REVIEW_KEY, JSON.stringify(recent)) } catch { /* Le navigateur refuse tout stockage. */ }
  }
  window.dispatchEvent(new Event(REVIEW_EVENT))
}

/** Candidats allégés (description raccourcie) : plusieurs centaines de fiches tiennent dans le stockage du navigateur. */
export function saveReview(itemId: string, title: string, candidates: Candidate[], query: string | null = null) {
  const entries = readReviews()
  entries[itemId] = {
    itemId, title, query, at: Date.now(),
    candidates: candidates.slice(0, 6).map((candidate) => ({ ...candidate, aliases: candidate.aliases.slice(0, 6), synopsis: candidate.synopsis && candidate.synopsis.length > 900 ? `${candidate.synopsis.slice(0, 900).replace(/\s+\S*$/, '')}…` : candidate.synopsis })),
  }
  write(entries)
}

export function dismissReview(itemId: string, title: string) {
  const entries = readReviews()
  entries[itemId] = { itemId, title, query: null, candidates: [], dismissed: true, at: Date.now() }
  write(entries)
}

export function removeReview(itemId: string) {
  const entries = readReviews()
  if (!(itemId in entries)) return
  delete entries[itemId]
  write(entries)
}
