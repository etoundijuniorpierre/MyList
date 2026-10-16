export function syncModal(element: HTMLDialogElement | null, visible: boolean, registerHost: (host: HTMLElement) => () => void) {
  if (!element) return
  if (visible) {
    if (!element.open) element.showModal()
    return registerHost(element)
  }
  if (element.open) element.close()
}

// Un événement « close » d'une ancienne ouverture peut arriver après une réouverture.
export function isDialogDismissal(element: HTMLDialogElement | null, requestedOpen: boolean) {
  return requestedOpen && element !== null && !element.open
}
