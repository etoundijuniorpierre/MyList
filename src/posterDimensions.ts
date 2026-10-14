export function imageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    const timeout = window.setTimeout(() => { image.src = ''; resolve(null) }, 10_000)
    image.onload = () => { window.clearTimeout(timeout); resolve({ width: image.naturalWidth, height: image.naturalHeight }) }
    image.onerror = () => { window.clearTimeout(timeout); resolve(null) }
    image.src = url
  })
}

export async function isLandscapePoster(url: string | null, ratio = 1): Promise<boolean> {
  if (!url) return false
  const dimensions = await imageDimensions(url)
  // A missing or unreadable image also qualifies for repair.
  return !dimensions || dimensions.height === 0 || dimensions.width / dimensions.height > ratio
}
