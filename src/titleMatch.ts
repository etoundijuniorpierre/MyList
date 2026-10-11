import { normalizeTitle } from './types'
import { searchQueries } from './titleAliases'

function bigrams(value: string): string[] {
  const padded = ` ${value} `
  return Array.from({ length: padded.length - 1 }, (_, index) => padded.slice(index, index + 2))
}

// Coefficient de Dice : tolère une faute de frappe ou un mot en trop sans accepter n'importe quoi.
export function similarity(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  const counts = new Map<string, number>()
  for (const pair of bigrams(left)) counts.set(pair, (counts.get(pair) ?? 0) + 1)
  let shared = 0
  for (const pair of bigrams(right)) {
    const remaining = counts.get(pair) ?? 0
    if (remaining > 0) { counts.set(pair, remaining - 1); shared++ }
  }
  return (2 * shared) / (bigrams(left).length + bigrams(right).length)
}

const romanNumeral = /^(?:i{1,3}|iv|v|vi{1,3}|ix|x|xi{1,2})$/

// « Far Cry 2 » et « Far Cry 3 » se ressemblent trop : le numéro d'opus doit concorder.
function installment(value: string): string | null {
  const token = value.split(' ').pop() ?? ''
  if (/^\d{1,2}$/.test(token)) return token
  return romanNumeral.test(token) ? token : null
}

// Les dossiers perdent souvent l'article : « Blacklist » pour « The Blacklist ».
const leadingArticle = /^(?:the|an?|le|la|les|el|los|las|un|una|os|a) /

function variants(value: string): string[] {
  const stripped = value.replace(leadingArticle, '')
  return stripped === value ? [value] : [value, stripped]
}

export function titleScore(title: string, query: string): number {
  const found = normalizeTitle(title.replace(/\s*\([^)]*\)$/, ''))
  const scores = searchQueries(query).flatMap((candidate) => {
    const wanted = normalizeTitle(candidate)
    if (!found || !wanted) return [0]
    if (installment(found) !== installment(wanted)) return [0]
    // La forme compacte rattrape les sigles : « R.E.V.O. » devient « r e v o » face à « revo ».
    return variants(found).flatMap((left) => variants(wanted).flatMap((right) => [
      similarity(left, right),
      similarity(left.replace(/ /g, ''), right.replace(/ /g, '')),
    ]))
  })
  return scores.length ? Math.max(...scores) : 0
}

// Seuil volontairement haut : une mauvaise affiche est pire qu'une fiche sans affiche.
export function isExactTitle(title: string, query: string): boolean {
  return titleScore(title, query) >= 0.9
}
