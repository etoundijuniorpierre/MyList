import { useEffect, useState, type CSSProperties } from 'react'
import { titleHue } from './display'
import { supabase } from './supabase'
import { categoryLabel, type CatalogItem } from './types'

export function formatPrice(amount: number, currency: string) {
  try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount) }
  catch { return `${amount.toLocaleString('fr-FR')} ${currency}` }
}

const sourceNames: Record<string, string> = {
  tvmaze: 'TVMaze', tvdb: 'TheTVDB', tmdb: 'TMDB', rawg: 'RAWG', igdb: 'IGDB', steam: 'Steam', anilist: 'AniList', kitsu: 'Kitsu', 'jikan-anime': 'MyAnimeList', gog: 'GOG', 'gog-dreamlist': 'GOG Dreamlist', nintendo: 'Nintendo', 'square-enix': 'Square Enix', mobygames: 'MobyGames',
}

export function sourceLabel(source: string, posterUrl: string | null) {
  if (source === 'wikipedia') return posterUrl ? 'Image : Wikimedia Commons' : 'Source : Wikipédia'
  return `Source : ${sourceNames[source] ?? source}`
}

export function safeUrl(url: string | null) {
  if (!url) return undefined
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.href : undefined }
  catch { return undefined }
}

export async function translateSynopsisToFrench(synopsis: string | null) {
  const text = synopsis?.trim()
  if (!text || !supabase) return text || null
  // Keep each request comfortably below the edge function and upstream URL limits.
  const chunks: string[] = []
  let chunk = ''
  for (const sentence of text.match(/[^.!?\n]+[.!?\n]*|[.!?\n]+/g) ?? [text]) {
    if (chunk && chunk.length + sentence.length > 1400) { chunks.push(chunk.trim()); chunk = '' }
    if (sentence.length > 1400) {
      const words = sentence.split(/\s+/)
      for (const word of words) {
        if (chunk && chunk.length + word.length + 1 > 1400) { chunks.push(chunk.trim()); chunk = '' }
        chunk += `${chunk ? ' ' : ''}${word}`
      }
    } else chunk += sentence
  }
  if (chunk.trim()) chunks.push(chunk.trim())
  const translated: string[] = []
  for (const part of chunks) {
    const { data, error } = await supabase.functions.invoke('translate-description', { body: { text: part } })
    if (error || typeof data?.text !== 'string' || !data.text.trim()) throw new Error('La traduction française de la description a échoué. Vérifiez l’accès à la fonction Supabase puis relancez-la.')
    translated.push(data.text.trim())
  }
  return translated.join(' ')
}

export function Cover({ item, className = '', priority = false, sizes = '(max-width: 480px) 45vw, (max-width: 900px) 30vw, 220px' }: { item: Pick<CatalogItem, 'title' | 'poster_url' | 'category'>; className?: string; priority?: boolean; sizes?: string }) {
  const [failed, setFailed] = useState(false)
  const image = safeUrl(item.poster_url)
  const optimizedPath = image && import.meta.env.VITE_SUPABASE_URL && image.startsWith(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/posters/`)
    ? image.slice(image.indexOf('/storage/v1/object/public/posters/') + '/storage/v1/object/public/posters/'.length)
    : null
  const imageVariant = (width: number) => `/api/poster?path=${encodeURIComponent(optimizedPath ?? '')}&w=${width}`
  useEffect(() => { setFailed(false) }, [image])
  return <div className={`cover cover-${item.category} ${className}`}>
    {image && !failed ? <img className="cover-art" src={optimizedPath ? imageVariant(384) : image} srcSet={optimizedPath ? `${imageVariant(240)} 240w, ${imageVariant(384)} 384w, ${imageVariant(640)} 640w` : undefined} sizes={sizes} width={384} height={576} alt="" decoding="async" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} onError={(event) => { if (optimizedPath && event.currentTarget.dataset.fallback !== 'true') { event.currentTarget.dataset.fallback = 'true'; event.currentTarget.removeAttribute('srcset'); event.currentTarget.src = image } else setFailed(true) }} />
      : <div className="cover-fallback" style={{ '--hue': titleHue(item.title) } as CSSProperties} aria-hidden="true"><span className="cover-grain" /><small>{categoryLabel(item.category)}</small><strong>{item.title}</strong></div>}
  </div>
}
