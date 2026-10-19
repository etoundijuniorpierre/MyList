export function syncModal(element: HTMLDialogElement | null, visible: boolean, registerHost: (host: HTMLElement) => () => void) {
  if (!element) return
  if (visible) {
    if (!element.open) element.showModal()
    return registerHost(element)
  }
  if (element.open) {
    element.close()
    releaseTouchFocus()
  }
}

/** Native dialogs restore their opener's focus. On touch, dismiss the keyboard
 * and focus glow, unless focus has already moved into another open dialog. */
export function releaseTouchFocus() {
  if (typeof window === 'undefined' || !window.matchMedia?.('(hover: none), (pointer: coarse)').matches || typeof document === 'undefined') return
  const focused = document.activeElement as HTMLElement | null
  if (focused?.closest?.('dialog[open]')) return
  focused?.blur?.()
}

// Un événement « close » d'une ancienne ouverture peut arriver après une réouverture.
export function isDialogDismissal(element: HTMLDialogElement | null, requestedOpen: boolean) {
  return requestedOpen && element !== null && !element.open
}
