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
  /** Titre lu dans les noms de fichiers quand il diffère du dossier (ex. titre anglais). */
  alt_title?: string | null
  /** Numéros de saison repérés, pour expliquer le total proposé. */
  season_numbers?: number[]
  season_detail?: string | null
  /** Dossier de saga d'où vient cette œuvre (« Saint Seiya Saga », « Mobile Suit Gundam »). */
  franchise_of?: string | null
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
  // Sous-dossiers directs d'un dossier-titre : numéro de saison, null pour une suite sans numéro, 'skip' pour films/OAV/coffrets.
  subfolders: Map<string, SubfolderKind>
  rootVideos: number
  fileTitles: Map<string, { title: string; count: number }>
  subfolderPaths: Map<string, string[]>
}

type SubfolderKind = number | null | 'skip' | 'variant'

const video = /\.(mkv|mp4|avi|mov|m4v|wmv|webm|ts)$/i
const game = /\.(exe|msi|iso|bin|cue|pak|vpk|zip|rar|7z|rpf|dat|doi|dd|cpk)$/i
const standaloneGame = /\.(iso|zip|rar|7z)$/i
const seasonFolder = /^(?:(?:saison|season)[ ._-]*\d{1,3}|s\d{1,3})$/i
const seasonMarker = /\b(?:saison|season)[ ._-]*\d{1,3}\b|\bS[ ._-]*\d{1,3}(?=$|[ ._-])/i
const videoContainer = /^(?:(?:.+\s+)?(?:all|complete)\s+(?:series|serie|seasons|saisons)|[aà] prendre|finis?|termin[eé]s?|vus|d[eé]j[aà] vus?|en cours|pas vus?|films?|animations?|new anim[eé]s?|new anime|anim[eé]s? (?:nouveaux|r[eé]cents?)|automne|hiver|printemps|[eé]t[eé]|fall|winter|spring|summer|release)(?:[ _-]+\d{4})?$/i
const filmMarker = /\b(?:film|movie|theatrical|gekijouban|cin[eé]ma|long[- ]m[eé]trage|feature film)\b/i
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
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, première: 1, deuxième: 2, troisième: 3, quatrième: 4, cinquième: 5 }
  for (const match of value.matchAll(/\b(first|second|third|fourth|fifth|sixth|seventh|première|deuxième|troisième|quatrième|cinquième)[ ._]+(?:saison|season)\b/gi)) addRange(String(words[match[1].toLowerCase()]))
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
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/[「」『』【】]/g, ' ')
    .replace(/^\s*\(\d{1,3}\)\s*/, ' ')
    // « L'intégrale de Raconte-moi une histoire » : la mention précède le vrai titre.
    .replace(/\b(?:l['’-]\s*)?int[eé]grale\s+(?:de|des|du|d['’])\s*/gi, ' ')
    .replace(/\([^)]*\b(?:bonus|dvd|[eé]pisodes?|specials?|sp[eé]ciaux|fichiers?)\b[^)]*\)/gi, ' ')
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
    .replace(/\b(?:custom|notag|smilodon|vff|vf|vost|opus|jpn|zho|kor|av1|flac|engjapstfr|uncensored|integral|dvd|bdrip|attachments|\d{3,4}p|\dch)\b/gi, ' ')
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
    .replace(/\b(?:int[eé]grale?s?|integrale?s?|completes?|complets?|vostfr|truefrench|subfrench|dvdrip|brrip|bdrip|hdtv|hdlight|web[-_. ]?dl|ac3|aac|dts|h\.?26[45]|10bits?)\b/gi, ' ')
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
    .replace(/\s+\+\s*$/g, ' ')
    .replace(/\b(?:saison|season)\s*$/i, ' ')
    // Résidus d'un nom de release tronqué : crochet jamais refermé, « -DL », signature après tiret cadratin.
    .replace(/\s*[[{(][^\]})]*$/g, ' ')
    .replace(/(?:^|\s)-?DL\b/g, ' ')
    .replace(/\s+l['’-]\s*(?:int[eé]grale)?\s*$/i, ' ')
    .replace(/\b(?:BD|MUX|VO|LD|SD|XVID|XviD|MP3|BluRa|FANSUB|Fansub|HDrip|HDRip|DDL|VOSTF|10B)\b/g, ' ')
    .replace(/\b(?:remast(?:ered)?|remasteris[ée]e?|multilangue)\b/gi, ' ')
    .replace(/\s+—\s*\S+\s*$/g, ' ')
    .replace(/\b(?:en\s+hd\s+)?streaming\s+gratuitement\b.*$/i, ' ')
    .replace(/\s*[-–]*\s*\b(?:anime[- ]ultime|mavanime|voiranime(?:\s*tv)?|neko[- ]sama|toonanime|japmanga|zone[- ]telechargement(?:\s*com)?|vid[eé]o\s+dailymotion|dailymotion|wawacity|french[- ]anime|vostfree|anime[- ]sama)\b.*$/i, ' ')
    .replace(/\s(?:xvid|divx|x26[45]|h\.?26[45]|aac|ac3)[-.][A-Za-z0-9]+$/i, ' ')
    .replace(/\b(?:Tsundere[- ]Raws|Erai[- ]raws|ToonsHub|T3KASHi|SubsPlease|HorribleSubs|MSubs|Multi[- ]Subs)\b/gi, ' ')
    // « Zombie-Loan 01 - 11 » : plage d'épisodes en fin de nom.
    .replace(/\s\d{1,3}\s*[-–]\s*\d{1,3}\b.*$/g, ' ')
    .replace(/\s*\((?:19|20)\d{2}\)\s*/g, ' ')
    .replace(/\s[-–]\s+(?=[-–]\s)/g, ' ')
    .replace(/\s[-–]\s+\S$/g, ' ')
    .replace(/\s[-–]?S$/g, ' ')
    .replace(/[\s\-–—:&,(]+$/g, ' ')
    .replace(/\s+\+\s*$/g, ' ')
    .replace(/^[\s\-–—:+&,)]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(.{3,}?)\s*[-–]\s*\1$/i, '$1')
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

// Un dossier de films regroupés : chaque vidéo est un film distinct, même si les fichiers sont numérotés.
const filmCollection = /\b(?:films?|movies?|the movies|long[- ]m[eé]trages?|ghibli)\b|\bcollection\b.*\b(?:studio|films?|movies?)\b|\b(?:studio|films?|movies?)\b.*\bcollection\b/i

function isAnimatedFilm(path: string, episodeFolderPaths: Set<string>) {
  const parts = path.split('/').filter(Boolean)
  const name = parts.at(-1) ?? ''
  const parent = parts.at(-2) ?? ''
  const videoTitle = normalizeTitle(titleFromVideo(name))
  const noisySiteFilmLabel = /(?:\bstreaming\b.*\bfilm\s+streaming\b|\bfilm\s+streaming\b.*\b(?:vf|vostfr|complet|hd)\b)/i.test(name)
  const knownFilm = [...knownStandaloneAnime].some((title) => videoTitle.startsWith(title))
  const marked = (filmMarker.test(name) && !noisySiteFilmLabel) || filmFolder.test(parent) || filmCollection.test(parent) || /^(?:movie|film)\s+(?:[ivx]+|\d+)\b/i.test(parent)
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

const ignoredSubfolder = /\b(?:films?|movies?|gekijouban|oav|ova|ona|specials?|sp[eé]ciaux|bonus|extras?|subs?|sous[- ]titres?|ost|soundtrack)\b|\b(?:box|dvd|disc|disque|cd|vol(?:ume)?)\s*\d/i

/** Classe un sous-dossier de dossier-titre : saison numérotée, suite nommée (null), variante de langue ou contenu annexe. */
export function classifySubfolder(parentTitle: string, name: string): SubfolderKind {
  const spaced = name.replace(/[._]+/g, ' ')
  if (innerFolder.test(name) || filmFolder.test(name) || ignoredSubfolder.test(spaced)) return 'skip'
  const numbers = new Set<number>()
  addSeasonNumbers(spaced, numbers)
  const leading = name.match(/^\s*0?(\d{1,2})\s*(?:(?:[.)]|-+)\s*(?=\S)|$)/)
  if (leading) numbers.add(Number(leading[1]))
  if (numbers.size) return Math.max(...numbers)
  if (/\b(?:E|EP|episode|épisode)\s*\d{1,4}\b|[-–]\s*\d{1,4}\s*$/i.test(spaced)) return 'skip'
  const parent = normalizeTitle(cleanTitle(parentTitle))
  const own = normalizeTitle(cleanTitle(spaced))
  if (!own || own.replace(/\s/g, '') === parent.replace(/\s/g, '') || /^(?:vf|vostfr|vost|vo|multi|french|fr)$/.test(own)) return 'variant'
  // « PSYCHO-PASS 3 » sous « Psycho Pass » : le nombre restant est la saison.
  const rest = own.startsWith(parent) ? own.slice(parent.length).trim() : ''
  if (/^\d{1,2}$/.test(rest) && Number(rest) >= 2) return Number(rest)
  return null
}

const franchiseWord = /\b(?:saga|collection|franchise|univers|universe|trilog(?:y|ie)|anthologie|anthology|pack|all\s*series?|toutes?\s+les\s+s[eé]ries)\b/i
// Sagas dont les parties sont des œuvres distinctes (titres, années et fiches différentes), pas des saisons.
const knownSaga = /^(?:(?:mobile suit )?gundam|fate|monogatari|saint seiya|les chevaliers du zodiaque|to ?aru|dragon ball|macross|digimon|pokemon|yu gi oh|lupin(?: iii| the third)?|ghost in (?:the )?shell|pretty cure|precure|tenchi muyo|sailor moon|hellsing|evangelion|neon genesis evangelion)(?: (?:saga|series?|all series?|integrale|collection|pack|franchise|complete))?$/

export function isSagaFolder(title: string) {
  return franchiseWord.test(title) || knownSaga.test(normalizeTitle(cleanTitle(title) || title))
}

const orderPrefix = /^\s*0?\d{1,2}(?:\.\d+)*\s*(?:[.)]|-+)\s*/
// Contenu annexe d'une saga (films regroupés, bandes-son, coffrets) : jamais une œuvre à part.
const sagaAnnex = /(?:^|\s|-)(?:films?|movies?|ost|soundtracks?|subs?|sous[- ]titres?|bonus|extras?|specials?|oav|ova|ona)\W*$|\b(?:box|dvd|disc|disque|cd|vol(?:ume)?)\s*\d/i

/** Un sous-dossier porte-t-il le nom d'une autre œuvre (et pas seulement « S2 », « VF » ou le titre parent) ? */
function namesOtherWork(parentTitle: string, name: string) {
  const own = normalizeTitle(cleanTitle(name.replace(orderPrefix, '').replace(/[._]+/g, ' ')))
  return Boolean(own) && own.replace(/\s/g, '') !== normalizeTitle(cleanTitle(parentTitle)).replace(/\s/g, '') && !/^(?:vf|vostfr|vost|vo|multi|french|fr|s ?\d+|saison \d+|season \d+|\d+)$/.test(own)
}

/** Sous-dossiers qui sont des œuvres à part entière : dossier de saga, ou au moins trois suites sans numéro. */
export function franchiseSubfolders(parentTitle: string, subfolders: Map<string, SubfolderKind>) {
  if (isSagaFolder(parentTitle)) return [...subfolders].filter(([name, value]) => (value !== 'skip' || !sagaAnnex.test(name.replace(orderPrefix, '').replace(/[._]+/g, ' ').trim())) && namesOtherWork(parentTitle, name)).map(([name]) => name)
  const head = normalizeTitle(cleanTitle(parentTitle)).split(' ').find((word) => word.length >= 3)
  const ordered = [...subfolders].filter(([name, value]) => orderPrefix.test(name) && value !== 'variant'
    && Boolean(head) && normalizeTitle(name.replace(orderPrefix, '').replace(/[「」]/g, ' ')).includes(head!))
  if (ordered.length >= 2) return ordered.filter(([name]) => namesOtherWork(parentTitle, name) && !sagaAnnex.test(sagaWorkTitle(name).trim()) && !sagaAnnex.test(name.replace(/[「」]/g, ' ').trim())).map(([name]) => name)
  const unnamed = [...subfolders].filter(([, value]) => value === null).map(([name]) => name)
  return unnamed.length >= 3 ? unnamed : []
}

/** Titre d'une œuvre de saga sans son numéro d'ordre : « 10-Mobile Suit Gundam Wing » → « Mobile Suit Gundam Wing ». */
export function sagaWorkTitle(name: string) {
  return cleanTitle(name.replace(orderPrefix, '').replace(/\bC\.E\.\s*/g, 'CE').replace(/\((?:s[eé]rie[- ]?)?(?:oav|ova|ona|film|movie|tv|s[eé]rie)\)/gi, ' ').replace(/[._]+/g, ' '))
}

/** Total de saisons d'un dossier-titre : le plus grand numéro, ou le nombre de saisons distinctes si des suites ne sont pas numérotées. */
export function folderSeasonTotal(numbers: Set<number>, subfolders: Map<string, SubfolderKind>, rootVideos: number) {
  const numbered = new Set([...numbers].filter((value) => value >= 1 && value <= 60))
  for (const value of subfolders.values()) if (typeof value === 'number') numbered.add(value)
  const unnamed = [...subfolders].filter(([, value]) => value === null).map(([name]) => name)
  const variant = [...subfolders.values()].some((value) => value === 'variant')
  const implicit = !numbered.size && unnamed.length > 0 && (rootVideos > 0 || variant) ? 1 : 0
  const total = Math.max(0, ...numbered, numbered.size + unnamed.length + implicit)
  return { total, numbered: [...numbered].sort((a, b) => a - b), unnamed }
}

export function scanFolder(files: Iterable<ScanFile>): ScannedItem[] {
  // Espaces insécables et espaces exotiques (« Saison 1 » avec U+00A0) : sinon « Saison 1 » n'est pas reconnu.
  const unicodeSpaces = /[  -​  　﻿]/g
  const sourceFiles = Array.from(files).map((file) => ({ name: file.name.replace(unicodeSpaces, ' '), size: file.size, webkitRelativePath: (file.webkitRelativePath || '').replace(unicodeSpaces, ' ') })).filter((file) => !/\b(?:livre audio|audiobook|podcast|cours d['’]anglais)\b/i.test(`${file.name} ${file.webkitRelativePath || ''}`))
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
    // Sous-dossier direct du dossier-titre (null = fichier posé à la racine du titre).
    let titleSubfolder: string | null | undefined
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
      titleSubfolder = relative.length > 1 ? first : null
    } else if (fromFolder) {
      rawName = first
      title = cleanTitle(first)
      key = `folder:${parts.slice(0, offset + 1).join('/')}`
      titleSubfolder = relative.length > 2 ? relative[1] : null
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
      subfolders: new Map<string, SubfolderKind>(), rootVideos: 0, fileTitles: new Map<string, { title: string; count: number }>(), subfolderPaths: new Map<string, string[]>(),
    }
    entry.paths.push(path)
    entry.bytes += file.size
    if (video.test(file.name)) entry.videoCount++
    if (game.test(file.name)) entry.gameCount++
    if (entry.mediaFormat !== 'film') addSeasonNumbers(path, entry.seasons)
    if (video.test(file.name) && entry.mediaFormat !== 'film' && titleSubfolder !== undefined) {
      if (titleSubfolder === null) entry.rootVideos++
      else {
        if (!entry.subfolders.has(titleSubfolder)) entry.subfolders.set(titleSubfolder, classifySubfolder(rawName, titleSubfolder))
        entry.subfolderPaths.set(titleSubfolder, [...(entry.subfolderPaths.get(titleSubfolder) ?? []), path])
      }
      const fileTitle = titleFromVideo(file.name)
      const fileKey = normalizeTitle(fileTitle)
      if (fileKey.length >= 3) {
        const previous = entry.fileTitles.get(fileKey)
        entry.fileTitles.set(fileKey, { title: previous?.title ?? fileTitle, count: (previous?.count ?? 0) + 1 })
      }
    }
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

  const looseGroups = new Map<string, string[]>()
  const looseKey = (title: string) => normalizeTitle(title.replace(/\([^)]*\)/g, ' ').replace(/\s+[-–]?\s*\d{1,4}\s*$/, '')).replace(/\bzero\b/g, '0').replace(/\s/g, '')
  for (const [key, entry] of groups) {
    if (!key.startsWith('video:')) continue
    const stripped = entry.title.replace(/\([^)]*\)/g, ' ').replace(/\s+[-–]?\s*\d{1,4}\s*$/, '').replace(/\s+/g, ' ').trim()
    if (stripped.length >= 3 && looseKey(entry.title).length >= 3) looseGroups.set(looseKey(entry.title), [...(looseGroups.get(looseKey(entry.title)) ?? []), key])
  }
  for (const [loose, keys] of looseGroups) if (keys.length < 2 && !keys.some((key) => groups.get(key)!.title.replace(/\([^)]*\)/g, ' ').replace(/\s+[-–]?\s*\d{1,4}\s*$/, '').trim() !== groups.get(key)!.title)) looseGroups.delete(loose)
  for (const [loose, keys] of looseGroups) {
    const exact = [...groups].find(([key, entry]) => key.startsWith('video:') && !keys.includes(key) && looseKey(entry.title) === loose)?.[0]
    const all = exact ? [exact, ...keys] : keys
    const target = all.length >= 2 ? groups.get(all[0]) : undefined
    if (!target) continue
    // Le titre le plus court et sans numéro d'épisode représente le groupe.
    if (!exact) target.title = all.map((key) => groups.get(key)!.title.replace(/\([^)]*\)/g, ' ').replace(/\s+[-–]?\s*\d{1,4}\s*$/, '').replace(/\s+/g, ' ').trim()).filter((title) => title.length >= 3).sort((a, b) => a.length - b.length)[0] || target.title
    for (const key of all) {
      const entry = groups.get(key)
      if (!entry || entry === target) continue
      target.paths.push(...entry.paths); target.bytes += entry.bytes; target.videoCount += entry.videoCount
      for (const value of entry.seasons) target.seasons.add(value)
      groups.delete(key)
    }
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
    // « toaru SAGA », « Ghost In Shell » : un dossier qui regroupe plusieurs œuvres devient une fiche par œuvre.
    const franchiseParts = isVideo && entry.mediaFormat !== 'film' ? franchiseSubfolders(entry.title, entry.subfolders) : []
    const works: ScannedItem[] = []
    for (const name of franchiseParts) {
      const paths = entry.subfolderPaths.get(name) ?? []
      const subTitle = sagaWorkTitle(name)
      if (!subTitle) continue
      // Les saisons d'une œuvre se lisent dans ses propres sous-dossiers et épisodes, pas dans le numéro d'ordre de la saga.
      const numbers = new Set<number>()
      addSeasonNumbers(name.replace(orderPrefix, '').replace(/[._]+/g, ' '), numbers)
      const children = new Map<string, SubfolderKind>()
      let directVideos = 0
      for (const subPath of paths) {
        const parts = subPath.split('/')
        const index = parts.indexOf(name)
        const fileName = parts.at(-1) ?? ''
        const code = fileName.match(/\bS(\d{1,2})[ ._-]*E\d{1,4}/i)
        if (code && Number(code[1]) >= 1) numbers.add(Number(code[1]))
        if (index >= 0 && parts.length > index + 2) { const child = parts[index + 1]; if (!children.has(child)) children.set(child, classifySubfolder(subTitle, child)) }
        else directVideos++
      }
      const own = folderSeasonTotal(numbers, children, directVideos)
      const fileTitles = new Map<string, { title: string; count: number }>()
      for (const subPath of paths) {
        const fileTitle = cleanTitle(titleFromVideo(subPath.split('/').at(-1) ?? ''))
        const fileKey = normalizeTitle(fileTitle)
        if (fileKey) fileTitles.set(fileKey, { title: fileTitle, count: (fileTitles.get(fileKey)?.count ?? 0) + 1 })
      }
      const topFile = [...fileTitles.values()].sort((a, b) => b.count - a.count)[0]
      const workKey = normalizeTitle(subTitle).replace(/\s/g, '')
      const extra = topFile ? normalizeTitle(topFile.title).replace(normalizeTitle(subTitle), ' ').trim() : ''
      const fullTitle = topFile && topFile.count >= 2 && normalizeTitle(topFile.title).replace(/\s/g, '').includes(workKey) && extra.length > 3
        && !/^(?:(?:film|movie|episode|ova|oav|vostfr|vf|the|le|la)\s*)+$/.test(extra) && !/\d{1,4}$/.test(topFile.title) ? topFile.title : subTitle
      works.push({
        id: `${key}:work:${name}`, parentId: key, title: fullTitle, category: isAnime ? 'anime' : isNovela ? 'novelas' : 'series',
        media_type: isAnime ? 'anime' : null, media_format: isAnime ? 'series' : null,
        seasons_count: Math.max(1, own.total), game_size_gb: null, file_count: paths.length, path: paths[0] ?? entry.paths[0], selected: true,
        warning: `Œuvre séparée de la saga « ${entry.title} »${own.total ? '' : ' · Saison non indiquée : 1 proposée'}`,
        season_numbers: own.numbered, season_detail: own.total ? ([own.numbered.length ? `S${own.numbered.join(', S')}` : '', own.unnamed.length ? `${own.unnamed.length} partie(s) nommée(s)` : ''].filter(Boolean).join(' + ') || null) : null,
        franchise_of: entry.title,
      })
      entry.subfolders.delete(name)
    }
    // « Index I », « Index II », « Index III » : une même œuvre découpée par saison dans la saga.
    const byBase = new Map<string, ScannedItem[]>()
    for (const work of works) {
      let base = normalizeTitle(work.title)
      for (let previous = ''; previous !== base;) { previous = base; base = base.replace(/\s+(?:[ivx]{1,4}|\d|[a-z])$/, '') }
      base = base.replace(/\s/g, '')
      byBase.set(base, [...(byBase.get(base) ?? []), work])
    }
    for (const group of byBase.values()) {
      if (group.length === 1) { suggestions.push(group[0]); continue }
      const first = group[0]
      suggestions.push({
        ...first, title: first.title.replace(/(?:\s+(?:[IVX]{1,4}|\d|[A-Z]))+$/i, '').trim() || first.title,
        seasons_count: group.reduce((sum, work) => sum + (work.seasons_count ?? 1), 0),
        file_count: group.reduce((sum, work) => sum + work.file_count, 0),
        season_detail: `${group.length} parties regroupées (${group.map((work) => work.title).join(', ')})`,
        warning: `Œuvre séparée de la saga « ${entry.title} »`,
      })
    }
    if (franchiseParts.length && !entry.rootVideos && ![...entry.subfolders.values()].some((value) => value !== 'skip')) continue
    if (franchiseParts.length) {
      entry.seasons.clear()
      for (const [name, paths] of entry.subfolderPaths) if (entry.subfolders.has(name)) for (const subPath of paths) addSeasonNumbers(subPath, entry.seasons)
    }
    const folderSeasons = folderSeasonTotal(entry.seasons, entry.subfolders, entry.rootVideos)
    const seasons = folderSeasons.total || entry.suffixSeasons || 0
    const seasonDetail = !isVideo || entry.mediaFormat === 'film' || !seasons ? null : [
      folderSeasons.numbered.length ? `S${folderSeasons.numbered.join(', S')}` : '',
      folderSeasons.unnamed.length ? `${folderSeasons.unnamed.length} suite${folderSeasons.unnamed.length > 1 ? 's' : ''} sans numéro (${folderSeasons.unnamed.slice(0, 2).map((name) => cleanTitle(name)).join(', ')})` : '',
      entry.suffixSeasons && !folderSeasons.total ? `(${entry.suffixSeasons}) dans le nom` : '',
    ].filter(Boolean).join(' + ') || null
    const topFileTitle = [...entry.fileTitles.values()].sort((a, b) => b.count - a.count)[0]
    const altTitle = topFileTitle && topFileTitle.count >= 2 && normalizeTitle(cleanTitle(topFileTitle.title)) !== normalizeTitle(entry.title) ? cleanTitle(topFileTitle.title) || null : null
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
      alt_title: isVideo ? altTitle : null,
      season_numbers: isVideo ? folderSeasons.numbered : [],
      season_detail: seasonDetail,
    }
    const dedupeKey = `${category}:${category === 'anime' ? item.media_format : ''}:${normalizeTitle(item.title)}`
    const previous = unique.get(dedupeKey)
    if (previous && category === 'games') {
      const preferred = (item.game_size_gb ?? 0) > (previous.game_size_gb ?? 0) ? item : previous
      preferred.warning = [preferred.warning, 'Titre trouvé dans plusieurs dossiers : taille du plus grand conservée'].filter(Boolean).join(' · ')
      unique.set(dedupeKey, preferred)
    } else if (previous) {
      // Même titre dans deux dossiers (ex. « S1 » et « S4 » rangés séparément) : on additionne au lieu d'en perdre un.
      const numbers = [...new Set([...(previous.season_numbers ?? []), ...(item.season_numbers ?? [])])].sort((a, b) => a - b)
      if (previous.seasons_count !== null) previous.seasons_count = Math.max(previous.seasons_count, item.seasons_count ?? 0, ...numbers)
      previous.season_numbers = numbers
      previous.file_count += item.file_count
      previous.alt_title ??= item.alt_title
      previous.season_detail = [...new Set([previous.season_detail, item.season_detail].filter(Boolean))].join(' · ') || null
      const merged = numbers.length || !item.warning?.includes('Saison non indiquée') ? previous.warning?.replace(/Saison non indiquée : 1 proposée(?: · )?/, '') : previous.warning
      previous.warning = [merged || null, 'Trouvé dans plusieurs dossiers : saisons fusionnées'].filter(Boolean).join(' · ')
    } else {
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
  const emitted = new Set([...unique.values()].map((item) => item.id))
  // Une franchise entièrement découpée n'a plus de fiche parente : ses œuvres sont proposées seules.
  const orphans = suggestions.filter((suggestion) => suggestion.parentId && !emitted.has(suggestion.parentId) && !existing.has(`${suggestion.category}:${normalizeTitle(suggestion.title)}`))
    .map((suggestion) => ({ ...suggestion, parentId: undefined }))
  return [...unique.values()].flatMap((item) => [
    item,
    ...suggestions.filter((suggestion) => suggestion.parentId === item.id && !existing.has(`${suggestion.category}:${normalizeTitle(suggestion.title)}`)),
  ]).concat(orphans)
}
