import type { Category, MediaType } from './types'
import { normalizeTitle } from './types'
import { expandKnownAlias } from './titleAliases'

export interface ScannedItem {
  id: string
  title: string
  category: Category
  media_type: MediaType
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
  fromFolder: boolean
  suffixSeasons: number | null
}

const video = /\.(mkv|mp4|avi|mov|m4v|wmv|webm|ts)$/i
const game = /\.(exe|msi|iso|bin|cue|pak|vpk|zip|rar|7z|rpf|dat|doi|dd|cpk)$/i
const standaloneGame = /\.(iso|zip|rar|7z)$/i
const season = /(?:saison|season)[ ._-]*(\d{1,3})|\bS(\d{1,3})E\d{1,3}\b/i
const innerFolder = /^(bin|binaries|data|content|engine|assets|movies|video|videos|dlc|redist|_redist|_commonredist|commonredist|directx|vcredist|game|games|setup|md5|crack|cracks|crackfix|bonus|bonuses|extra|extras|patch|patchs|patches|update|updates|ost|soundtrack|docs?|manual|manuals|save|saves|config|tool|tools|support)$/i
const genericRoot = /^(?:[a-z]|media|m[eé]dias|collection|biblioth[eè]que|downloads?|t[eé]l[eé]chargements?|disque|drive|dossier|folder|files?)$/i

function folderCategory(name: string): Category | null {
  if (/^(?:games?|jeux(?: pc)?|pc games?)$/i.test(name)) return 'games'
  if (/^(?:anim[eé]s?|anime)$/i.test(name)) return 'anime'
  if (/^(?:novelas?|telenovelas?)$/i.test(name)) return 'novelas'
  if (/^(?:s[eé]ries?|series)$/i.test(name)) return 'series'
  return null
}

// Les dossiers portent souvent « (2) » ou « (1 2) » pour indiquer les saisons présentes.
export function seasonsFromSuffix(name: string): number | null {
  const match = name.match(/\((\d{1,2}(?:[\s,]+\d{1,2})*)\)\s*$/)
  if (!match) return null
  const numbers = match[1].split(/[\s,]+/).map(Number).filter((value) => value >= 1 && value <= 60)
  return numbers.length ? Math.max(...numbers) : null
}

function cleanTitle(value: string, isFile = false): string {
  let title = isFile ? value.replace(/\.(?:iso|zip|rar|7z|exe|msi|mkv|mp4|avi|mov|m4v|wmv|webm|ts)$/i, '') : value
  title = title.replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:www\.[^)]*|[^)]*\.(?:com|net|org))\)/gi, ' ')
    .replace(/^(?:rune|tenoke|dodi|fitgirl|corepack|empress|codex|skidrow|reloaded|plaza|hoodlum|razor1911|elamigos|xatab|kaos|flt|tinyiso|gog|masquerade|online[-_. ]?fix)[-_. ]+/i, ' ')
    .replace(/(?:[-_. ]+(?:CODEX|SKIDROW|RELOADED|Mephisto|STEAMPUNKS|SiMON|KAMUi|ElA|Black_Box|P2P))$/i, ' ')
    .replace(/\b(?:v[._ ]?\d+(?:[._]\d+)+|incl[._ ]*\d+[._ ]*DLC|FRENCH|MULTI\d*|REPACK)\b/gi, ' ')
    .replace(/\bby[._ ]+xatab\b/gi, ' ')
    .replace(/\(\d{4}\)$/g, ' ')
    .replace(/\s*\((?:\d{1,2}[\s,]*)+\)\s*$/g, ' ')
    .replace(/\b(?:saison|season)[ ._-]*\d{1,3}\b|\bS\d{1,3}E\d{1,3}\b/gi, ' ')
    .replace(/\bS\d{1,2}(?:\s*[-–]\s*S?\d{1,2})?\b/gi, ' ')
    .replace(/\b(?:int[eé]grales?|integrales?|completes?|complets?|vostfr|truefrench|subfrench|dvdrip|brrip|bdrip|hdtv|hdlight|web[-_. ]?dl|ac3|aac|dts|h\.?26[45]|10bits?)\b/gi, ' ')
    .replace(/\b(?:1080p|720p|2160p|x264|x265|hevc|bluray|webrip)\b/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/^GTA\b/i, 'Grand Theft Auto')
    .replace(/([a-z])([12]\d{3})\b/gi, '$1 $2')
    // « Teen Wolf -CHiLL » : groupe de release collé au tiret, contrairement à « Law & Order - SVU ».
    .replace(/\s[-–](?=\S)[A-Za-z0-9]{2,12}$/g, ' ')
    .replace(/\s+-\s*$/g, ' ')
    .replace(/^\s*-\s+/g, ' ')
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
  return cleanTitle(name, true).replace(/\b(?:e|episode)[ ._-]*\d+\b.*$/i, '').trim()
}

export function scanFolder(files: Iterable<ScanFile>): ScannedItem[] {
  const sourceFiles = Array.from(files)
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
    const categoryHint = singleGame ? 'games' : nestedCategory && (parts.length > 3 || genericRoot.test(root)) ? nestedCategory : folderCategory(root)
    const offset = !singleGame && nestedCategory && categoryHint === nestedCategory ? 2 : 1
    const relative = parts.slice(offset)
    const first = relative[0]
    if (!first) continue
    const collection = categoryHint === 'games' && collectionPaths.has(parts.slice(0, offset + 1).join('/'))
    if (collection && relative.length < 3) continue

    let title: string
    let key: string
    let rawName = root
    let fromFolder = singleGame || relative.length > 1
    if (singleGame) {
      title = cleanTitle(root)
      key = `folder:${root}`
    } else if (collection) {
      rawName = relative[1]
      title = cleanTitle(relative[1])
      key = `folder:${parts.slice(0, offset + 2).join('/')}`
      fromFolder = true
    } else if (fromFolder && !categoryHint && (season.test(first) || innerFolder.test(first))) {
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

    const entry = groups.get(key) ?? {
      title, paths: [], bytes: 0, videoCount: 0, gameCount: 0,
      seasons: new Set<number>(), archives: new Map<string, { title: string; bytes: number; path: string; count: number }>(), categoryHint, fromFolder,
      suffixSeasons: seasonsFromSuffix(rawName),
    }
    entry.paths.push(path)
    entry.bytes += file.size
    if (video.test(file.name)) entry.videoCount++
    if (game.test(file.name)) entry.gameCount++
    const match = path.match(season)
    if (match) entry.seasons.add(Number(match[1] ?? match[2]))
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
    const isNovela = isVideo && !isAnime && (entry.categoryHint === 'novelas' || /(?:novelas?|telenovelas?)/i.test(entry.paths[0]))
    const category: Category = isVideo ? (isAnime ? 'anime' : isNovela ? 'novelas' : 'series') : 'games'
    const warnings: string[] = []
    const seasons = entry.seasons.size || entry.suffixSeasons || 0
    if (isVideo && !seasons) warnings.push('Saison non indiquée : 1 proposée')
    if (category === 'games' && entry.fromFolder && (entry.archives.size > 1 || /\b(?:trilogie|quadrilogie|collection)\b|\d+\s*[-&]\s*\d+|\s&\s/i.test(entry.title))) {
      warnings.push('Ce dossier peut contenir plusieurs jeux : vérifiez la fiche et la taille')
    }
    if (category === 'games' && /^(?:[a-z]\s){3,}[a-z]$/i.test(entry.title)) warnings.push('Nom abrégé : corrigez le titre avant l’import')
    const item: ScannedItem = {
      id: key, title: entry.title, category, media_type: isAnime ? 'anime' : null,
      seasons_count: isVideo ? Math.max(1, seasons) : null,
      game_size_gb: category === 'games' ? Math.max(0.01, Math.round(entry.bytes / 1e9 * 100) / 100) : null,
      file_count: entry.paths.length, path: entry.paths[0], selected: true,
      auto_category: !entry.categoryHint,
      warning: warnings.length ? warnings.join(' · ') : null,
    }
    const dedupeKey = `${category}:${normalizeTitle(item.title)}`
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
