export function scrollPageForNavigation(previousPath: string, destination: { pathname: string; hash: string }) {
  if (previousPath === destination.pathname || destination.hash) return
  const reset = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  reset()
  // La fermeture du menu ou d'une modale peut restaurer le focus après le rendu.
  const frame = window.requestAnimationFrame(reset)
  return () => window.cancelAnimationFrame(frame)
}

export function scrollCatalogStart(marker: HTMLElement | null) {
  if (!marker) return
  const header = document.querySelector('.site-header')
  const offset = header?.getBoundingClientRect().height ?? 0
  const top = Math.max(0, marker.getBoundingClientRect().top + window.scrollY - offset - 8)
  window.scrollTo({ top, behavior: 'instant' })
}
