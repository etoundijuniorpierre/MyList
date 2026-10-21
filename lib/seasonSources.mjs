const normalized = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const titlesOf = node => [...new Set([node?.title?.english, node?.title?.romaji, node?.title?.native, ...(node?.synonyms ?? [])].filter(Boolean))]
const fields = 'id format title { english romaji native } synonyms startDate { year month day } coverImage { large } siteUrl'
const nodes = depth => `${fields} relations { edges { relationType node { ${depth ? nodes(depth - 1) : 'id format title { english romaji native }'} } } }`
async function json(url, options, fetcher) {
  const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error('Source indisponible')
  return response.json()
}
function franchise(title) {
  return normalized(title).replace(/\b(?:season|saison)\s*\d+\b/g, '').replace(/\b\d+(?:st|nd|rd|th)?\s*(?:season|saison)\b/g, '').replace(/\s+(?:\d+|i{1,3}|iv|v|vi{0,3}|ix|x)$/, '').trim()
}
export function safeAnimeSeasons(root, expected, today = new Date().toISOString().slice(0, 10), source = 'anilist') {
  if (!root || !Number.isInteger(expected) || expected < 1 || expected > 12) return []
  const bases = titlesOf(root).map(franchise).filter(title => title.length >= 8)
  const sameWork = node => titlesOf(node).some(title => bases.some(base => { const text = franchise(title); return text === base || text.startsWith(`${base} `) }))
  const known = new Map(), queue = [root]
  let incomplete = false
  while (queue.length) {
    const node = queue.shift()
    if (!node || known.has(node.id) || !['TV', 'TV_SHORT', 'ONA'].includes(node.format) || !sameWork(node)) continue
    // A cour/part can be only half a season. Never assign it another season number.
    if (titlesOf(node).some(title => /\b(?:part|cour)\s*(?:\d+|[ivx]+)\b/i.test(title))) return []
    const date = node.startDate
    if (!date?.year) { incomplete = true; continue }
    const premiere = `${date.year}-${String(date.month || 1).padStart(2, '0')}-${String(date.day || 1).padStart(2, '0')}`
    if (premiere > today) continue
    known.set(node.id, node)
    for (const edge of node.relations?.edges ?? []) if (['SEQUEL', 'PREQUEL'].includes(edge.relationType)) queue.push(edge.node)
    if (known.size > 12) return []
  }
  if (incomplete || known.size !== expected) return []
  const ordered = [...known.values()].sort((a, b) => (a.startDate.year * 10000 + (a.startDate.month || 1) * 100 + (a.startDate.day || 1)) - (b.startDate.year * 10000 + (b.startDate.month || 1) * 100 + (b.startDate.day || 1)))
  const dates = ordered.map(node => JSON.stringify(node.startDate))
  if (new Set(dates).size !== dates.length) return []
  return ordered.map((node, index) => ({ number: index + 1, title: node.title.english || node.title.romaji || node.title.native, poster_url: node.coverImage?.large ?? null, year: node.startDate.year,
    source, source_id: String(node.id), source_url: source === 'anilist' ? `https://anilist.co/anime/${node.id}` : `https://myanimelist.net/anime/${node.id}` }))
}
async function anilistSeasons(input, fetcher) {
  let selector, variables
  if (input.source === 'anilist' && input.id) { selector = 'id: $id'; variables = { id: Number(input.id) } }
  else if (input.source === 'jikan-anime' && input.id) { selector = 'idMal: $id'; variables = { id: Number(input.id) } }
  else {
    const search = await json('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: `query ($search: String!) { Page(perPage: 8) { media(search: $search, type: ANIME, isAdult: false) { ${fields} } } }`, variables: { search: input.titles[0] } }) }, fetcher)
    const matches = (search.data?.Page?.media ?? []).filter(node => ['TV', 'TV_SHORT', 'ONA'].includes(node.format) && (!input.year || node.startDate?.year === input.year) && titlesOf(node).some(title => input.titles.some(alias => normalized(alias) === normalized(title))))
    if (matches.length !== 1) return []
    selector = 'id: $id'; variables = { id: matches[0].id }
  }
  const payload = await json('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: `query ($id: Int!) { Media(${selector}, type: ANIME, isAdult: false) { ${nodes(2)} } }`, variables }) }, fetcher)
  if (payload.errors) throw new Error('AniList ne répond pas')
  return safeAnimeSeasons(payload.data?.Media, input.expected)
}
async function jikanSeasons(input, fetcher) {
  if (!input.expected || input.expected > 12) return []
  let id = input.source === 'jikan-anime' ? input.id : null
  if (!id) {
    const result = await json(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(input.titles[0])}&limit=5&sfw=true`, {}, fetcher)
    const matches = (result.data ?? []).filter(node => ['TV', 'TV Special', 'ONA'].includes(node.type) && (!input.year || (node.year ?? node.aired?.prop?.from?.year) === input.year)
      && [node.title, node.title_english, ...(node.titles ?? []).map(title => title.title)].filter(Boolean).some(title => input.titles.some(alias => normalized(alias) === normalized(title))))
    if (matches.length !== 1) return []
    id = String(matches[0].mal_id)
  }
  const first = (await json(`https://api.jikan.moe/v4/anime/${id}/full`, {}, fetcher)).data
  if (!first) return []
  const toNode = raw => ({ id: raw.mal_id, format: raw.type === 'TV' ? 'TV' : raw.type === 'ONA' ? 'ONA' : raw.type,
    title: { english: raw.title_english || raw.title, romaji: raw.title }, synonyms: (raw.titles ?? []).map(title => title.title),
    startDate: { year: raw.aired?.prop?.from?.year ?? raw.year, month: raw.aired?.prop?.from?.month, day: raw.aired?.prop?.from?.day },
    coverImage: { large: raw.images?.jpg?.large_image_url ?? raw.images?.jpg?.image_url }, relations: { edges: [] } })
  const root = toNode(first), bases = titlesOf(root).map(franchise).filter(title => title.length >= 8)
  const known = new Map([[root.id, root]]), queue = [first], fetched = new Set([root.id])
  while (queue.length && fetched.size <= 12) {
    const raw = queue.shift(), parent = known.get(raw.mal_id)
    if (!['TV', 'ONA'].includes(raw.type)) continue
    for (const relation of raw.relations ?? []) {
      if (!['Sequel', 'Prequel'].includes(relation.relation)) continue
      for (const entry of relation.entry ?? []) {
        if (entry.type !== 'anime' || !bases.some(base => franchise(entry.name) === base || franchise(entry.name).startsWith(`${base} `))) continue
        if (!fetched.has(entry.mal_id)) {
          if (fetched.size >= 12) return []
          fetched.add(entry.mal_id)
          const child = (await json(`https://api.jikan.moe/v4/anime/${entry.mal_id}/full`, {}, fetcher)).data
          if (!child) return []
          known.set(child.mal_id, toNode(child)); queue.push(child)
        }
        parent.relations.edges.push({ relationType: relation.relation.toUpperCase(), node: known.get(entry.mal_id) })
      }
    }
  }
  return safeAnimeSeasons(root, input.expected, undefined, 'jikan-anime')
}
async function animeSeasons(input, fetcher) {
  if (!input.expected || input.expected > 12) return []
  try { const found = await anilistSeasons(input, fetcher); if (found.length) return found } catch { /* Use the independent MAL identities and relations. */ }
  return jikanSeasons(input, fetcher)
}
async function tvSeasons(input, fetcher) {
  let id = input.source === 'tvmaze' ? input.id : null
  if (!id) {
    for (const title of input.titles.slice(0, 2)) {
      const search = await json(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(title)}`, {}, fetcher)
      const matches = search.map(entry => entry.show).filter(show => input.titles.some(alias => normalized(alias) === normalized(show.name)) && (!input.year || Number(show.premiered?.slice(0, 4)) === input.year) && (input.category !== 'anime' || show.type === 'Animation'))
      const ids = [...new Set(matches.map(show => show.id))]
      if (ids.length > 1) return []
      if (ids.length === 1) { id = String(ids[0]); break }
    }
  }
  if (!id) return []
  const today = new Date().toISOString().slice(0, 10)
  const rows = await json(`https://api.tvmaze.com/shows/${id}/seasons`, {}, fetcher)
  return rows.filter(row => Number.isInteger(row.number) && row.number > 0 && row.number <= 999 && row.premiereDate && row.premiereDate <= today).map(row => ({ number: row.number,
    title: row.name?.trim() && !/^(?:season|saison)\s*\d+$/i.test(row.name.trim()) ? row.name.trim() : null,
    poster_url: row.image?.original ?? row.image?.medium ?? null, year: Number(row.premiereDate.slice(0, 4)), source: 'tvmaze', source_id: String(row.id), source_url: row.url ?? `https://www.tvmaze.com/shows/${id}` }))
}
export async function resolveSeasonDetails(input, fetcher = fetch) {
  const responses = await Promise.allSettled([tvSeasons(input, fetcher), input.category === 'anime' ? animeSeasons(input, fetcher) : Promise.resolve([])])
  const tv = responses[0].status === 'fulfilled' ? responses[0].value : []
  const anime = responses[1].status === 'fulfilled' ? responses[1].value : []
  if (!tv.length && !anime.length && (responses[0].status === 'rejected' && input.category !== 'anime' || input.category === 'anime' && responses[1].status === 'rejected')) throw new Error('Sources indisponibles')
  const rows = new Map(tv.map(row => [row.number, row]))
  anime.forEach(row => rows.set(row.number, { ...rows.get(row.number), ...row }))
  const seasons = [...rows.values()].sort((a, b) => a.number - b.number)
  return { seasons, note: !seasons.length ? 'Aucune correspondance de saisons suffisamment sûre. Les numéros disponibles sont conservés ; vous pouvez compléter les titres et affiches manuellement.'
    : input.category === 'anime' && !anime.length ? 'Découpage officiel conservé. Les parties, films et OAV ne sont pas transformés automatiquement en saisons ; les titres propres non confirmés restent à compléter.' : null }
}
