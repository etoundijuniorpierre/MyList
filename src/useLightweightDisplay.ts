import { useSyncExternalStore } from 'react'

let media: MediaQueryList | undefined
function displayQuery() {
  return media ??= window.matchMedia('(max-width: 680px), (max-width: 980px) and (pointer: coarse)')
}
function subscribe(listener: () => void) {
  const query = displayQuery()
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

/** Ne pas monter les images décoratives évite aussi leur téléchargement sur mobile. */
export function useLightweightDisplay() {
  return useSyncExternalStore(subscribe, () => displayQuery().matches, () => true)
}
