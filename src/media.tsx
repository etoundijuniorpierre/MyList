import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { categoryLabel, type CatalogItem } from './types'

export function formatPrice(amount: number, currency: string) {
  try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount) }
  catch { return `${amount.toLocaleString('fr-FR')} ${currency}` }
}

const sourceNames: Record<string, string> = {
  tvmaze: 'TVMaze', tvdb: 'TheTVDB', tmdb: 'TMDB', rawg: 'RAWG', igdb: 'IGDB', steam: 'Steam', 'jikan-anime': 'MyAnimeList', gog: 'GOG', 'gog-dreamlist': 'GOG Dreamlist', nintendo: 'Nintendo', 'square-enix': 'Square Enix', mobygames: 'MobyGames',
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
  const { data, error } = await supabase.functions.invoke('translate-description', { body: { text } })
  if (error || typeof data?.text !== 'string' || !data.text.trim()) throw new Error('La traduction française de la description a échoué. Réessayez avant l’enregistrement.')
  return data.text.trim()
}

export function Cover({ item, className = '' }: { item: Pick<CatalogItem, 'title' | 'poster_url' | 'category'>; className?: string }) {
  const [failed, setFailed] = useState(false)
  const image = safeUrl(item.poster_url)
  const optimizedPath = image && import.meta.env.VITE_SUPABASE_URL && image.startsWith(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/posters/`)
    ? image.slice(image.indexOf('/storage/v1/object/public/posters/') + '/storage/v1/object/public/posters/'.length)
    : null
  const imageVariant = (width: number) => `/api/poster?path=${encodeURIComponent(optimizedPath ?? '')}&w=${width}`
  useEffect(() => { setFailed(false) }, [image])
  return <div className={`cover cover-${item.category} ${className}`}>
    {image && !failed ? <img className="cover-art" src={optimizedPath ? imageVariant(384) : image} srcSet={optimizedPath ? `${imageVariant(384)} 384w, ${imageVariant(640)} 640w` : undefined} sizes="(max-width: 480px) calc(100vw - 40px), (max-width: 760px) calc(50vw - 30px), (max-width: 1100px) calc(33vw - 24px), 300px" alt={`Affiche de ${item.title}`} loading="lazy" onError={(event) => { if (optimizedPath && event.currentTarget.dataset.fallback !== 'true') { event.currentTarget.dataset.fallback = 'true'; event.currentTarget.removeAttribute('srcset'); event.currentTarget.src = image } else setFailed(true) }} /> : <div className="cover-fallback"><span className="cover-orbit" /><strong>{item.title}</strong><small>MA LISTE / {categoryLabel(item.category).toUpperCase()}</small></div>}
  </div>
}

