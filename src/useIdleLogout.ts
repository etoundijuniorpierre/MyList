import { useEffect, useRef, useState } from 'react'

const ACTIVITY_KEY = 'mylist-admin-activity'
export const IDLE_KEY = 'mylist-admin-idle-minutes'
export const idleChoices = [10, 20, 30, 60] as const

export function readIdleMinutes() {
  try { const value = Number(localStorage.getItem(IDLE_KEY)); return idleChoices.includes(value as typeof idleChoices[number]) ? value : 20 } catch { return 20 }
}

function lastActivity() { try { return Number(localStorage.getItem(ACTIVITY_KEY)) || Date.now() } catch { return Date.now() } }
export function markAdminActivity() { touch() }

function touch() { try { localStorage.setItem(ACTIVITY_KEY, String(Date.now())) } catch { /* La session reste protégée par le minuteur local. */ } }

/**
 * Ferme la session admin après une période sans activité, dans tous les onglets.
 * Un avertissement apparaît une minute avant ; un traitement en cours suspend le minuteur.
 */
export function useIdleLogout(enabled: boolean, paused: boolean, minutes: number, onExpire: () => void) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const expire = useRef(onExpire)
  expire.current = onExpire
  useEffect(() => {
    if (!enabled) { setSecondsLeft(null); return }
    // Une session restaurée après une longue absence est fermée dès l'ouverture, sans attendre.
    try { if (!localStorage.getItem(ACTIVITY_KEY)) touch() } catch { /* ignoré */ }
    let lastWrite = 0
    const activity = () => { const now = Date.now(); if (now - lastWrite > 4000) { lastWrite = now; touch(); setSecondsLeft(null) } }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((name) => window.addEventListener(name, activity, { passive: true }))
    const check = () => {
      if (paused) { touch(); return }
      const left = Math.round((lastActivity() + minutes * 60_000 - Date.now()) / 1000)
      if (left <= 0) { setSecondsLeft(null); expire.current() }
      else setSecondsLeft(left <= 60 ? left : null)
    }
    check()
    const timer = window.setInterval(check, 1000)
    const visible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', visible)
    return () => {
      events.forEach((name) => window.removeEventListener(name, activity))
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [enabled, paused, minutes])
  return { secondsLeft, stayActive: () => { touch(); setSecondsLeft(null) } }
}
