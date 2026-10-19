import { useEffect, type RefObject } from 'react'

/** Touching outside a search or dismissing the software keyboard ends editing.
 * No viewport resets: pinch zoom and desktop keyboard navigation remain usable. */
export function useTouchSearchFocus(input: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const field = input.current
      if (event.pointerType !== 'touch' || document.activeElement !== field || !(event.target instanceof Element)) return
      if (!field?.closest('label')?.contains(event.target) && event.target !== field) field?.blur()
    }
    const viewport = window.visualViewport
    let editingHeight = viewport?.height ?? 0
    const focus = () => { editingHeight = viewport?.height ?? 0 }
    const resize = () => {
      if (!viewport || document.activeElement !== input.current || !window.matchMedia('(hover: none), (pointer: coarse)').matches) return
      if (viewport.height > editingHeight + 120) input.current?.blur()
      editingHeight = Math.min(editingHeight, viewport.height)
    }
    const field = input.current
    document.addEventListener('pointerdown', outside, { passive: true })
    field?.addEventListener('focus', focus)
    viewport?.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside)
      field?.removeEventListener('focus', focus)
      viewport?.removeEventListener('resize', resize)
    }
  }, [input])
}
