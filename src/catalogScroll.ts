export function scrollCatalogStart(marker: HTMLElement | null) {
  if (!marker) return
  const header = document.querySelector('.site-header')
  const offset = header?.getBoundingClientRect().height ?? 0
  const top = Math.max(0, marker.getBoundingClientRect().top + window.scrollY - offset - 8)
  window.scrollTo({ top, behavior: 'instant' })
}
