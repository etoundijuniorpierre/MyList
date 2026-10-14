import { useCallback, useEffect, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'

interface ConfirmOptions { title: string; body: string; confirm: string; danger?: boolean; typed?: string }

/** Confirmation intégrée au design (au lieu de window.confirm), avec saisie obligatoire pour les suppressions massives. */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [typed, setTyped] = useState('')
  const resolver = useRef<(value: boolean) => void>(undefined)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (options && !element.open) element.showModal()
    if (!options && element.open) element.close()
  }, [options])
  const confirm = useCallback((next: ConfirmOptions) => new Promise<boolean>((resolve) => { resolver.current = resolve; setTyped(''); setOptions(next) }), [])
  const settle = (value: boolean) => { resolver.current?.(value); resolver.current = undefined; setOptions(null) }
  const element = <dialog ref={dialog} className="confirm-dialog" aria-labelledby="confirm-title" onClose={() => settle(false)}>
    {options && <form method="dialog" onSubmit={(event) => { event.preventDefault(); if (!options.typed || typed === options.typed) settle(true) }}>
      <TriangleAlert size={24} className={options.danger ? 'is-danger' : ''} aria-hidden="true" />
      <h2 id="confirm-title">{options.title}</h2>
      <p>{options.body}</p>
      {options.typed && <label>Tapez <strong>{options.typed}</strong> pour confirmer<input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus autoComplete="off" /></label>}
      <div className="confirm-actions"><button type="button" className="button-ghost" onClick={() => settle(false)}>Annuler</button><button className={options.danger ? 'button-danger' : 'button-primary'} disabled={Boolean(options.typed) && typed !== options.typed} autoFocus={!options.typed}>{options.confirm}</button></div>
    </form>}
  </dialog>
  return { confirm, element }
}

export type Confirm = ReturnType<typeof useConfirm>['confirm']
