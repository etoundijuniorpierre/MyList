import type { Category, MediaType } from './types'
import { normalizeTitle } from './types'
import { expandKnownAlias } from './titleAliases'

export interface ScannedItem {
  id: string
  title: string
  category: Category
  media_type: MediaType
  media_format?: 'series' | 'film' | null
  seasons_count: number | null
  game_size_gb: number | null
  file_count: number
  path: string
  selected: boolean
  warning: string | null
  auto_category?: boolean
  parentId?: string
}

type ScanFile = Pick<File, 'name' | 'size' | 'webkitRelativePath'>
type Group = {
  title: string
  paths: string[]
  bytes: number
  videoCount: number
  gameCount: number
  seasons: Set<number>
  archives: Map<string, { title: string; bytes: number; path: string; count: number }>
  categoryHint: Category | null
  mediaFormat: 'series' | 'film' | null
  fromFolder: boolean
  suffixSeasons: number | null
}

const video = /\.(mkv|mp4|avi|mov|m4v|wmv|webm|ts)$/i
const game = /\.(exe|msi|iso|bin|cue|pak|vpk|zip|rar|7z|rpf|dat|doi|dd|cpk)$/i
const standaloneGame = /\.(iso|zip|rar|7z)$/i
const seasonFolder = /^(?:(?:saison|season)[ ._-]*\d{1,3}|s\d{1,3})$/i
const seasonMarker = /\b(?:saison|season)[ ._-]*\d{1,3}\b|\bS[ ._-]*\d{1,3}(?=$|[ ._-])/i
const videoContainer = /^(?:(?:.+\s+)?(?:all|complete)\s+(?:series|serie|seasons|saisons)|[aà] prendre|fini|en cours|pas vus?|films?|animations?|new anim[eé]s?|new anime|anim[eé]s? (?:nouveaux|r[eé]cents?)|automne|hiver|printemps|[eé]t[eé]|fall|winter|spring|summer|release)(?:[ _-]+\d{4})?$/i
const filmMarker = /\b(?:film|movie|theatrical|cin[eé]ma|long[- ]m[eé]trage|feature film)\b/i
const filmFolder = /^(?:films?|movies?|long[- ]m[eé]trages?|cin[eé]ma)$/i
const knownStandaloneAnime = new Set([
  'amer beton', 'aria the crepuscolo', 'asura', 'avalonia l etrange voyage',
  'odd taxi in the woods', 'oddtaxi in the woods', 'totsukuni no shoujo l enfant et le maudit', 'totsukuni no shoujo lenfant et le maudit', 'zuo ri qing kong',
  'the first slam dunk', 'final fantasy les creatures de l esprit', 'paprika', 'vampire hunter d',
  'one piece fan letter', 'rascal does not dream of a knapsack kid', 'rascal does not dream of a sister venturing out',
].map((title) => normalizeTitle(title)))
const animeAliases: Record<string, string> = {
  mikata: 'The Banished Court Magician Aims to Become the Strongest',
  'hojo mahou': 'The Banished Court Magician Aims to Become the Strongest',
  'agharen san wa hakarenai': 'Aharen San wa Hakarenai',
  'oddtaxi in the woods': 'Odd Taxi: In the Woods',
  'totsukuni no shoujo lenfant et le maudit': 'The Girl from the Other Side',
  'zuo ri qing kong': 'Crystal Sky of Yesterday',
}
const innerFolder = /^(bin|binaries|data|content|engine|assets|movies|video|videos|dlc|redist|_redist|_commonredist|commonredist|directx|vcredist|game|games|setup|md5|crack|cracks|crackfix|bonus|bonuses|extra|extras|patch|patchs|patches|update|updates|ost|soundtrack|docs?|manual|manuals|save|saves|config|tool|tools|support)$/i
const genericRoot = /^(?:[a-z]|media|m[eé]dias|collection|biblioth[eè]que|downloads?|t[eé]l[eé]chargements?|disque|drive|dossier|folder|files?)$/i

function folderCategory(name: string): Category | null {
  if (/^(?:games?|jeux(?: pc)?|pc games?)$/i.test(name)) return 'games'
  if (/^(?:anim[eé]s?|anime|animations?|new anim[eé]s?|new anime)$/i.test(name)) return 'anime'
  // Cette application n’a pas de catégorie film distincte. Les dossiers « Films »
  // et saisons de diffusion rencontrés dans une vidéothèque d’animés contiennent
  // des animés et servent de simples sous-répertoires.
  if (/^(?:films?|automne|hiver|printemps|[eé]t[eé]|fall|winter|spring|summer)(?:[ _-]+\d{4})?$/i.test(name)) return 'anime'
  if (/^(?:novelas?|telenovelas?)$/i.test(name)) return 'novelas'
  if (/^(?:a\s*voir|ok)$/i.test(name)) return 'anime'
  if (/^(?:s[eé]ries?|series)$/i.test(name)) return 'series'
  return null
}

function rootCategory(name: string): Category | null {
  return folderCategory(name) ?? (/\b(?:anim[eé]s?|anime)\b/i.test(name) ? 'anime' : null)
}

function addSeasonNumbers(value: string, target: Set<number>) {
  const addRange = (first: string, last?: string) => {
    const start = Number(first)
    const end = last ? Number(last) : start
    if (start < 1 || end > 60 || end < start || end - start > 20) return
    for (let number = start; number <= end; number++) target.add(number)
  }

  const namedRange = /\b(?:saison|season)[ ._]*0?(\d{1,2})\s*[-–]\s*(?:saison|season)[ ._]*0?(\d{1,2})/gi
  for (const match of value.matchAll(namedRange)) addRange(match[1], match[2])
  const named = /\b(?:saison|season)[ ._]*0?(\d{1,2})/gi
  for (const match of value.matchAll(named)) {
    const prefix = value.slice(0, match.index)
    if (/\b\d{1,2}(?:st|nd|rd|th|er|e|ème|eme)\s+$/i.test(prefix)) continue
    addRange(match[1])
  }
  const ordinal = /\b0?(\d{1,2})(?:st|nd|rd|th|er|e|ème|eme)\s+(?:saison|season)\b/gi
  for (const match of value.matchAll(ordinal)) addRange(match[1])

  // Les packs d’animés utilisent souvent « S01 - 01 » pour épisode 1 et
  // « S01-S02 » pour deux saisons. Le second nombre compte comme saison
  // uniquement si son S est présent, afin de ne pas prendre le numéro d’épisode.
  const prefixed = /\bS[ ._-]*0?(\d{1,2})(?:\s*[-–]\s*S[ ._-]*0?(\d{1,2}))?(?=E\d{1,3}|\b|[ ._-])/gi
  for (const match of value.matchAll(prefixed)) addRange(match[1], match[2])
}

// Les dossiers portent souvent « (2) » ou « (1 2) » pour indiquer les saisons présentes.
export function seasonsFromSuffix(name: string): number | null {
  const match = name.match(/\((\d{1,2}(?:[\s,]+\d{1,2})*)\)\s*$/)
  if (!match) return null
  const numbers = match[1].split(/[\s,]+/).map(Number).filter((value) => value >= 1 && value <= 60)
  return numbers.length ? Math.max(...numbers) : null
}

export function cleanTitle(value: string, isFile = false): string {
  let title = isFile ? value.replace(/\.(?:iso|zip|rar|7z|exe|msi|mkv|mp4|avi|mov|m4v|wmv|webm|ts)$/i, '') : value
  title = title.replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s*\((?=[^)]*\b(?:HDR10?|Atmos|BDRip|BluRay|1080p|720p|HEVC|x265|WEB[- ]?DL|AAC|AC3|EAC3)\b)[^)]*\)/gi, ' ')
    .replace(/\((?:www\.[^)]*|[^)]*\.(?:com|net|org))\)/gi, ' ')
    .replace(/^(?:rune|tenoke|dodi|fitgirl|corepack|empress|codex|skidrow|reloaded|plaza|hoodlum|razor1911|elamigos|xatab|kaos|flt|tinyiso|gog|masquerade|online[-_. ]?fix)[-_. ]+/i, ' ')
    // Le groupe de release est collé par un tiret ou un point ; sinon « Gears of War Reloaded » perdrait un mot du titre.
    .replace(/(?:[-_.]+\s*(?:CODEX|SKIDROW|RELOADED|Mephisto|STEAMPUNKS|SiMON|KAMUi|ElA|Black_Box|P2P))$/i, ' ')
    .replace(/\b(?:v[._ ]?\d+(?:[._]\d+)+|incl[._ ]*\d+[._ ]*DLC|FRENCH|MULTI\d*|REPACK)\b/gi, ' ')
    .replace(/\s*[-–]\s*Tsundere[- ]Raws\b.*$/i, ' ')
    .replace(/\s*[-–]\s*Gum Gum(?: Streaming)?\b.*$/i, ' ')
    .replace(/^(?:\s*\d{1,2}[.)_-]\s*)+/, ' ')
    .replace(/\s*[-–]\s*(?:ADKami|JetAnime|AnimeResistance|YouTube)\b.*$/i, ' ')
    .replace(/\s+épisode[ ._-]*0?\d{1,4}\b.*$/i, ' ')
    .replace(/\s+(?:OAV|OVA)\s*\d*\s*$/i, ' ')
    .replace(/\bS\d{1,3}[ ._-]*(?:partie|part|cour)[ ._-]*\d{1,3}\b/gi, ' ')
    .replace(/\s*[»|]\s*(?:s[eé]rie|film)\b.*$/i, ' ')
    .replace(/\s+(?:streaming|telecharger|t[eé]l[eé]charger)\s+(?:animes?|anime|series?|films?)\b.*$/i, ' ')
    .replace(/\s+-\s*(?:streaming|film|s[eé]rie)\b.*$/i, ' ')
    .replace(/\s*\+\s*\d*\s*(?:specials?|oavs?|t[eé]l[eé]films?)\b.*$/i, ' ')
    .replace(/\b(?:S\d{1,2}[ ._-]*E\d{1,4}|(?:episode|épisode|ep|e)[ ._-]*0?\d{1,4})\b.*$/i, ' ')
    .replace(/\b(?:dvd\s*box|dvd\s*rip|dual\s*audio|multi\s*subs)\b.*$/i, ' ')
    .replace(/\s+-?(?:DL|DDP\d|FUNi|CR|ADN|NC|E-AC-3|MPEG2|REMUX|SceneGuardians|Monkey D[. ]Lulu)\b.*$/i, ' ')
    .replace(/\b(?:custom|notag|smilodon|vff|vost|opus|av1|flac|engjapstfr|uncensored|integral|dvd|bdrip|attachments|\d{3,4}p|\dch)\b/gi, ' ')
    .replace(/\bby[._ ]+xatab\b/gi, ' ')
    .replace(/\(\d{4}\)$/g, ' ')
    .replace(/\s*\((?:\d{1,2}[\s,]*)+\)\s*$/g, ' ')
    .replace(/\(\s*$/g, ' ')
    .replace(/\b(?:saison|season)[ ._-]*\d{1,3}\b|\b\d{1,3}(?:st|nd|rd|th|er|e|ème|eme)\s+(?:saison|season)\b|\bS\d{1,3}E\d{1,3}\b/gi, ' ')
    .replace(/\bS\d{1,2}(?:\s*[-–]\s*S?\d{1,2})?\b/gi, ' ')
    // « The Knick 1 2 », « Westworld 12 3 4 » : liste de saisons sans parenthèses. Deux nombres ou plus
    // pour ne pas toucher un opus unique comme « Far Cry 5 » ou un titre tel que « Catch 22 ».
    .replace(/\s\d{1,2}(?:\s+\d{1,2})+\s*$/g, ' ')
    // Étiquettes de release en capitales, retirées sans le drapeau i pour épargner les vrais mots (« Web of Shadows »).
    .replace(/\b(?:WEB|EAC3|DDP?|AMZN|NF|DSNP|ATVP|HMAX|MAX|REMUX|PROPER|REPACK|FW)\b/g, ' ')
    // Retiré d'un bloc, sinon « Complete Edition » laisse « Edition » orphelin dans le titre.
    .replace(/\b(?:complete|definitive|ultimate|deluxe|gold|goty|game of the year|remastered?)\s+edition\b/gi, ' ')
    .replace(/\b(?:int[eé]grales?|integrales?|completes?|complets?|vostfr|truefrench|subfrench|dvdrip|brrip|bdrip|hdtv|hdlight|web[-_. ]?dl|ac3|aac|dts|h\.?26[45]|10bits?)\b/gi, ' ')
    .replace(/\b(?:1080p|720p|2160p|x264|x265|hevc|bluray|webrip)\b/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/^GTA\b/i, 'Grand Theft Auto')
    .replace(/([a-z])([12]\d{3})\b/gi, '$1 $2')
    // « Teen Wolf -CHiLL » : groupe de release collé au tiret, contrairement à « Law & Order - SVU ».
    .replace(/\s[-–](?=\S)[A-Za-z0-9]{2,12}$/g, ' ')
    .replace(/\s+-\s*$/g, ' ')
    .replace(/^\s*-\s+/g, ' ')
    .replace(/\s*\(\d{4}\)\s*$/g, ' ')
    .replace(/\s*\(\s*\)\s*$/g, ' ')
    .replace(/\s+[-–]\s*(?:\d{1,2}(?:\s*[~-]\s*\d{1,2})?|\d{1,2}v\d+)\s*$/i, ' ')
    .replace(/\s+[25]\s+[01]\s*$/g, ' ')
    .replace(/\s*\+\s*$/g, ' ')
    .replace(/\b(?:saison|season)\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return expandKnownAlias(title)
}

function archiveTitle(name: string): string | null {
  if (!standaloneGame.test(name)) return null
  const title = cleanTitle(name, true).replace(/(?:[ ._-]+part\d+)$/i, '').trim()
  if (/^(?:setup|gsetup|md5|data\d*|fg-\d+|redist)$/i.test(title) || /(?:patch\w*|update\w*|upd[._ -]*\d+|crackfix|redist|smokepatch|directx|visual c\+\+|dlc)/i.test(title)) return null
  return title
}

function titleFromVideo(name: string): string {
  return cleanTitle(name, true)
    .replace(/\s+épisode[ ._-]*0?\d{1,4}\b.*$/i, '')
    .replace(/\b(?:s\d{1,2}\s*)?(?:e|episode|épisode|ep)(?:[ ._-]*\d{1,4})?\b.*$/i, '')
    .replace(/^regarder\s+/i, '')
    .replace(/\s+[._ -]+\d{1,4}\s*$/i, '')
    .replace(/\s+/g, ' ').trim()
}

function episodeNumber(name: string): number | null {
  const match = name.match(/\bS\d{1,2}[ ._-]*E[ ._-]*0?(\d{1,4})\b/i)
    ?? name.match(/\b(?:episode|ep)\s*[._-]*0?(\d{1,4})\b/i)
    ?? name.match(/\bE0?(\d{1,4})(?=$|[ ._\-[(])/i)
    // Older releases often number the file as "Title - 07 (2018_05_05 ...)" or
    // "Title - 07 VF". Requiring an episode-like suffix avoids treating film parts as episodes.
    ?? name.match(/[-–]\s*0?(\d{1,3})(?=\s*(?:\(\s*(?:19|20)\d{2}[_. -]\d{2}|\[[^\]]+\]|(?:vf|vostfr|vost|multi\d*|sub(?:bed|french)?|1080p|720p|2160p|x26[45]|hevc|bluray|webrip|bdrip|aac|ac3)\b|$))/i)
    // Some libraries omit the separator: "Shokugeki No Soma 050 VOSTFR 2018".
    ?? name.match(/\s0?(\d{1,3})\s+(?=(?:vf|vostfr|vost|multi\d*|sub(?:bed|french)?|1080p|720p|2160p|x26[45]|hevc|bluray|webrip|bdrip|aac|ac3)\b)/i)
    ?? name.match(/^\s*0?(\d{1,3})\s*(?=[._-])/i)
  const value = Number(match?.[1])
  return Number.isInteger(value) && value >= 0 && value <= 9999 ? value : null
}

function episodeFolders(files: ScanFile[]): Set<string> {
  const episodes = new Map<string, Set<number>>()
  for (const file of files) {
    if (!video.test(file.name)) continue
    const number = episodeNumber(file.name)
    if (number === null) continue
    const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean)
    const parent = parts.slice(0, -1).join('/')
    const parentName = parts.at(-2) ?? ''
    // Loose collection folders contain a mix of films and episodes. Treat only
    // title folders as episode groups, never broad shelves such as "PAS VUS".
    if (videoContainer.test(parentName) || folderCategory(parentName) || filmFolder.test(parentName) || innerFolder.test(parentName)) continue
    const values = episodes.get(parent) ?? new Set<number>()
    values.add(number)
    episodes.set(parent, values)
  }
  return new Set([...episodes].filter(([, numbers]) => numbers.size >= 2).map(([path]) => path))
}

function isAnimatedFilm(path: string, episodeFolderPaths: Set<string>) {
  const parts = path.split('/').filter(Boolean)
  const name = parts.at(-1) ?? ''
  const parent = parts.at(-2) ?? ''
  const videoTitle = normalizeTitle(titleFromVideo(name))
  const noisySiteFilmLabel = /(?:\bstreaming\b.*\bfilm\s+streaming\b|\bfilm\s+streaming\b.*\b(?:vf|vostfr|complet|hd)\b)/i.test(name)
  const knownFilm = [...knownStandaloneAnime].some((title) => videoTitle.startsWith(title))
  const marked = (filmMarker.test(name) && !noisySiteFilmLabel) || filmFolder.test(parent) || /^(?:movie|film)\s+(?:[ivx]+|\d+)\b/i.test(parent)
  const episode = episodeNumber(name) !== null || episodeFolderPaths.has(parts.slice(0, -1).join('/'))
    || seasonMarker.test(path) || /\b(?:ONA|OVA|OAV)\b/i.test(path)
  const seasonFolderPresent = parts.slice(0, -1).some((part) => seasonFolder.test(part) || seasonMarker.test(part))
  const year = /\b(?:19|20)\d{2}\b/.test(name)
  if (/^sakra(?:\s|$)/i.test(videoTitle)) return false // live-action film sometimes stored inside the anime directory
  return marked || (knownFilm && !episode)
    || (year && !episode && !seasonFolderPresent)
}

function filmTitle(path: string, name: string) {
  const raw = name.replace(/\.(?:mkv|mp4|avi|mov|m4v|wmv|webm|ts)$/i, '')
  const rawTitle = raw.replace(/[._+]+/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/^\s*regarder\s+/i, ' ').replace(/\bepisode\s*\d{1,4}\b.*$/i, ' ')
    .replace(/\bthe\s+movie\b/i, ' - ')
    .replace(/\bmovie\b\s*[-–:]?\s*/i, ' - ')
    .replace(/\ble\s+film\b/i, ' ')
    .replace(/\(\s*(?:movie|film)\s*\)/gi, ' ')
    .replace(/\b(?:movie|film|theatrical)\s*#?\s*\d*\s*$/i, ' ')
    .replace(/\s+special\s+\d+\s*$/i, ' Special')
    .replace(/\b(?:vostfr|vost|truefrench|subfrench|vf|ddl|streaming|1080p|720p|2160p|x264|x265|hevc|bluray|webrip|bdrip|brrip|dvdrip|multi\d*|dual audio|aac|ac3|dts)\b.*$/i, ' ')
    .replace(/\s*\(?\b(?:19|20)\d{2}\)?\s*(?:fansub)?\s*$/i, ' ')
  const title = cleanTitle(rawTitle.replace(/[()［］「」]+/g, ' ').replace(/\b(?:19|20)\d{2}\b/g, ' ').replace(/\s+(?:film|movie|theatrical)(?:\s*\d+)?\s*$/i, ' ').replace(/\s+[-–]\s*[-–]\s+/g, ' - ').replace(/[\s._-]+$/g, ' '))
  if (title && !/^\d{1,4}$/.test(title) && !/^movie\s+[ivx]+\b/i.test(title)) return title
  const parts = path.split('/').filter(Boolean)
  const parent = parts.at(-2) ?? ''
  if (/^(?:movie|film)\s+(?:[ivx]+|\d+)\b/i.test(parent)) {
    return cleanTitle(parent.replace(/^(?:movie|film)\s+(?:[ivx]+|\d+)\s*/i, '').replace(/[「」]/g, ' '))
  }
  const folder = [...parts].reverse().find((part) => part !== name && !filmFolder.test(part) && !seasonFolder.test(part) && !seasonMarker.test(part))
  return folder ? cleanTitle(folder) : title
}

export function scanFolder(files: Iterable<ScanFile>): ScannedItem[] {
  const sourceFiles = Array.from(files).filter((file) => !/\b(?:livre audio|audiobook|podcast|cours d['’]anglais)\b/i.test(`${file.name} ${file.webkitRelativePath || ''}`))
  const episodeFolderPaths = episodeFolders(sourceFiles)
  const singleGameRoots = new Set<string>()
  const potentialCollections = new Map<string, { children: Set<string>; directPayload: boolean }>()
  for (const file of sourceFiles) {
    const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean)
    const root = parts[0]
    const gamesOffset = folderCategory(root) === 'games' ? 1 : folderCategory(parts[1] ?? '') === 'games' && genericRoot.test(root) ? 2 : 0
    if (gamesOffset && parts.length > gamesOffset + 1) {
      const parent = parts.slice(0, gamesOffset + 1).join('/')
      const collection = potentialCollections.get(parent) ?? { children: new Set<string>(), directPayload: false }
      if (parts.length === gamesOffset + 2 && game.test(file.name)) collection.directPayload = true
      if (parts.length > gamesOffset + 2 && game.test(file.name) && !innerFolder.test(parts[gamesOffset + 1])) {
        collection.children.add(parts[gamesOffset + 1])
      }
      potentialCollections.set(parent, collection)
    }
    if (!root || folderCategory(root) || genericRoot.test(root)) continue
    if ((parts.length === 2 && game.test(file.name)) || (parts.length > 2 && innerFolder.test(parts[1]))) {
      singleGameRoots.add(root)
    }
  }
  const collectionPaths = new Set([...potentialCollections].filter(([, value]) => !value.directPayload && value.children.size > 1).map(([path]) => path))
  const groups = new Map<string, Group>()
  for (const file of sourceFiles) {
    const path = file.webkitRelativePath || file.name
    const parts = path.split('/').filter(Boolean)
    if (parts.length < 2) continue
    const root = parts[0]
    const singleGame = singleGameRoots.has(root)
    const nestedCategory = singleGame ? null : folderCategory(parts[1])
    const categoryHint = singleGame ? 'games' : nestedCategory && (parts.length > 3 || genericRoot.test(root)) ? nestedCategory : rootCategory(root)
    let offset = !singleGame && nestedCategory && categoryHint === nestedCategory ? 2 : 1
    while (categoryHint && categoryHint !== 'games' && offset < parts.length - 1 && videoContainer.test(parts[offset])) offset++
    const relative = parts.slice(offset)
    const first = relative[0]
    if (!first) continue
    if (categoryHint && categoryHint !== 'games' && /_attachments\.(?:zip|rar|7z)$/i.test(file.name)) continue
    const collection = categoryHint === 'games' && collectionPaths.has(parts.slice(0, offset + 1).join('/'))
    if (collection && relative.length < 3) continue

    let title: string
    let key: string
    let rawName = root
    let fromFolder = singleGame || relative.length > 1
    const animatedVideo = video.test(file.name) && (categoryHint === 'anime' || /\b(?:anime|anim[eé]s?)\b/i.test(path))
    const film = animatedVideo && isAnimatedFilm(path, episodeFolderPaths)
    if (film) {
      title = filmTitle(path, file.name)
      key = `film:${normalizeTitle(title)}`
      rawName = title
      fromFolder = true
    } else if (singleGame) {
      title = cleanTitle(root)
      key = `folder:${root}`
    } else if (collection) {
      rawName = relative[1]
      title = cleanTitle(relative[1])
      key = `folder:${parts.slice(0, offset + 2).join('/')}`
      fromFolder = true
    } else if (fromFolder && !categoryHint && (seasonFolder.test(first) || innerFolder.test(first))) {
      title = cleanTitle(root)
      key = `folder:${root}`
    } else if (fromFolder) {
      rawName = first
      title = cleanTitle(first)
      key = `folder:${parts.slice(0, offset + 1).join('/')}`
    } else if (video.test(file.name)) {
      title = titleFromVideo(file.name) || cleanTitle(root)
      key = `video:${title}`
    } else {
      const candidate = archiveTitle(file.name)
      if (!candidate) continue // Ignore desktop.ini, icônes et installateurs isolés.
      title = candidate
      key = `game:${title}`
      fromFolder = false
    }

    const mediaFormat: Group['mediaFormat'] = film ? 'film' : video.test(file.name) ? 'series' : null
    const entry = groups.get(key) ?? {
      title, paths: [], bytes: 0, videoCount: 0, gameCount: 0,
      seasons: new Set<number>(), archives: new Map<string, { title: string; bytes: number; path: string; count: number }>(), categoryHint, mediaFormat, fromFolder,
      suffixSeasons: seasonsFromSuffix(rawName),
    }
    entry.paths.push(path)
    entry.bytes += file.size
    if (video.test(file.name)) entry.videoCount++
    if (game.test(file.name)) entry.gameCount++
    if (entry.mediaFormat !== 'film') addSeasonNumbers(path, entry.seasons)
    if (fromFolder && (relative.length === (collection ? 3 : 2) || (singleGame && relative.length === 1))) {
      const archive = archiveTitle(file.name)
      if (archive) {
        const archiveKey = normalizeTitle(archive).replace(/\bpart \d+$/, '').replace(/\b(\d+)[ab]$/, '$1')
        const previous = entry.archives.get(archiveKey)
        entry.archives.set(archiveKey, {
          title: previous?.title ?? archive, bytes: (previous?.bytes ?? 0) + file.size,
          path: previous?.path ?? path, count: (previous?.count ?? 0) + 1,
        })
      }
    }
    groups.set(key, entry)
  }

  const unique = new Map<string, ScannedItem>()
  const suggestions: ScannedItem[] = []
  for (const [key, entry] of groups) {
    if (!entry.categoryHint && !entry.videoCount && !entry.gameCount) continue
    const isVideo = entry.categoryHint !== 'games' && (entry.categoryHint === 'anime' || entry.categoryHint === 'series' || entry.categoryHint === 'novelas' || entry.videoCount > 0)
    const isAnime = isVideo && (entry.categoryHint === 'anime' || /anim[eé]/i.test(entry.paths[0]))
    if (isAnime && /^sakra(?:\s+2023)?(?:\s|$)/i.test(normalizeTitle(entry.title))) continue
    const isNovela = isVideo && !isAnime && (entry.categoryHint === 'novelas' || /(?:novelas?|telenovelas?)/i.test(entry.paths[0]))
    const category: Category = isVideo ? (isAnime ? 'anime' : isNovela ? 'novelas' : 'series') : 'games'
    const warnings: string[] = []
    const seasons = Math.max(0, ...entry.seasons) || entry.suffixSeasons || 0
    if (isVideo && entry.mediaFormat !== 'film' && !seasons) warnings.push('Saison non indiquée : 1 proposée')
    if (category === 'games' && entry.fromFolder && (entry.archives.size > 1 || /\b(?:trilogie|quadrilogie|collection)\b|\d+\s*[-&]\s*\d+|\s&\s/i.test(entry.title))) {
      warnings.push('Ce dossier peut contenir plusieurs jeux : vérifiez la fiche et la taille')
    }
    if (category === 'games' && /^(?:[a-z]\s){3,}[a-z]$/i.test(entry.title)) warnings.push('Nom abrégé : corrigez le titre avant l’import')
    const item: ScannedItem = {
      id: key, title: category === 'anime' ? animeAliases[normalizeTitle(entry.title)] ?? entry.title : entry.title,
      category, media_type: isAnime ? 'anime' : null,
      media_format: isAnime ? entry.mediaFormat ?? 'series' : null,
      seasons_count: isVideo && entry.mediaFormat !== 'film' ? Math.max(1, seasons) : null,
      game_size_gb: category === 'games' ? Math.max(0.01, Math.round(entry.bytes / 1e9 * 100) / 100) : null,
      file_count: entry.paths.length, path: entry.paths[0], selected: true,
      auto_category: !entry.categoryHint,
      warning: warnings.length ? warnings.join(' · ') : null,
    }
    const dedupeKey = `${category}:${category === 'anime' ? item.media_format : ''}:${normalizeTitle(item.title)}`
    const previous = unique.get(dedupeKey)
    if (previous && category === 'games') {
      const preferred = (item.game_size_gb ?? 0) > (previous.game_size_gb ?? 0) ? item : previous
      preferred.warning = [preferred.warning, 'Titre trouvé dans plusieurs dossiers : taille du plus grand conservée'].filter(Boolean).join(' · ')
      unique.set(dedupeKey, preferred)
    } else if (!previous) {
      unique.set(dedupeKey, item)
    }
    if (category === 'games' && entry.fromFolder && entry.archives.size > 1) {
      for (const [archiveKey, archive] of entry.archives) {
        suggestions.push({
          id: `${key}:archive:${archiveKey}`, parentId: key, title: archive.title,
          category: 'games', media_type: null, seasons_count: null,
          game_size_gb: Math.max(0.01, Math.round(archive.bytes / 1e9 * 100) / 100),
          file_count: archive.count, path: archive.path, selected: false,
          auto_category: false,
          warning: 'Jeu possible dans ce dossier : décochez la fiche globale si vous importez les jeux séparément',
        })
      }
    }
  }
  const existing = new Set([...unique.values()].map((item) => `${item.category}:${normalizeTitle(item.title)}`))
  return [...unique.values()].flatMap((item) => [
    item,
    ...suggestions.filter((suggestion) => suggestion.parentId === item.id && !existing.has(`${suggestion.category}:${normalizeTitle(suggestion.title)}`)),
  ])
}
