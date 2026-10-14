export type GameCandidate = { name: string; background_image: string | null }

function normalizedTitle(value: string): string {
  return value.replace(/[™®©]/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// The provider may add punctuation or a trademark, but a different installment
// or edition must never satisfy an automatic poster search.
export function sameGameTitle(found: string, query: string): boolean {
  const actual = normalizedTitle(found)
  const wanted = normalizedTitle(query)
  return Boolean(actual && wanted && (actual === wanted || actual.replace(/ /g, '') === wanted.replace(/ /g, '')))
}

export function hasMatchingCover<T extends GameCandidate>(results: T[], query: string): boolean {
  return results.some((game) => Boolean(game.background_image && sameGameTitle(game.name, query)))
}

export function betterFallback<T extends GameCandidate>(current: T[], incoming: T[], query: string): T[] {
  if (!incoming.length) return current
  if (!current.length) return incoming
  const currentExact = current.some((game) => sameGameTitle(game.name, query))
  const incomingExact = incoming.some((game) => sameGameTitle(game.name, query))
  return incomingExact && !currentExact ? incoming : current
}
