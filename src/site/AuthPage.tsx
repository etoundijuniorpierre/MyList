import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Eye, EyeOff, Fingerprint, KeyRound, LockKeyhole, ShieldCheck, Timer } from 'lucide-react'
import { isConfigured, supabase } from '../supabase'
import { setPageMeta } from '../display'
import { markAdminActivity } from '../useIdleLogout'

const LOCK_KEY = 'mylist-admin-lock'
const FAIL_KEY = 'mylist-admin-fails'

function readNumber(key: string) { try { return Number(sessionStorage.getItem(key) ?? 0) || 0 } catch { return 0 } }
function writeNumber(key: string, value: number) { try { value ? sessionStorage.setItem(key, String(value)) : sessionStorage.removeItem(key) } catch { /* Stockage indisponible : la limite serveur reste active. */ } }

export function AuthPage({ isAdmin, adminReady }: { isAdmin: boolean; adminReady: boolean }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [caps, setCaps] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [lockedUntil, setLockedUntil] = useState(() => readNumber(LOCK_KEY))
  const [now, setNow] = useState(Date.now())
  const [params] = useSearchParams()
  const navigate = useNavigate()
  useEffect(() => { setPageMeta('Accès privé', 'noindex') ; return () => setPageMeta('') }, [])
  useEffect(() => {
    if (lockedUntil <= Date.now()) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [lockedUntil])
  if (adminReady && isAdmin) return <Navigate to="/admin" replace />
  const remaining = Math.max(0, Math.ceil((lockedUntil - now) / 1000))
  const reason = params.get('raison')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) { setMessage('La connexion sera disponible après configuration de Supabase.'); return }
    if (remaining) return
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-login`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify({ username: username.trim().toLowerCase(), password }) })
      const result = await response.json().catch(() => ({}))
      if (response.status === 429) {
        const until = Date.now() + 15 * 60_000
        writeNumber(LOCK_KEY, until); setLockedUntil(until); setNow(Date.now())
        throw new Error('locked')
      }
      if (!response.ok) throw new Error(result.error || 'Connexion impossible.')
      markAdminActivity()
      const { error } = await supabase.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token })
      if (error) throw error
      writeNumber(FAIL_KEY, 0); writeNumber(LOCK_KEY, 0)
      markAdminActivity()
      setPassword('')
      navigate('/admin', { replace: true })
    } catch (error) {
      if (error instanceof Error && error.message === 'locked') setMessage('Trop de tentatives. L’accès est suspendu pendant 15 minutes.')
      else {
        // Délai croissant après chaque échec : ralentit les essais au clavier, la limite serveur fait le reste.
        const fails = readNumber(FAIL_KEY) + 1
        writeNumber(FAIL_KEY, fails)
        if (fails >= 3) { const until = Date.now() + Math.min(60, 2 ** (fails - 2) * 5) * 1000; writeNumber(LOCK_KEY, until); setLockedUntil(until); setNow(Date.now()) }
        setMessage('Identifiants incorrects ou accès indisponible.')
      }
      setPassword('')
    } finally { setBusy(false) }
  }
  const capsCheck = (event: KeyboardEvent<HTMLInputElement>) => setCaps(event.getModifierState?.('CapsLock') ?? false)

  return <main id="contenu" tabIndex={-1} className="auth-page">
    <section className="auth-art" aria-hidden="true">
      <div className="vault"><div className="vault-ring" /><div className="vault-ring vault-ring-2" /><LockKeyhole size={54} strokeWidth={1.3} /></div>
      <p className="auth-art-caption">Espace réservé à l’administration</p>
    </section>
    <section className="auth-panel">
      <div className="auth-box">
        <span className="eyebrow"><ShieldCheck size={14} aria-hidden="true" /> Accès privé</span>
        <h1>Espace admin</h1>
        <p>Identifiez-vous pour gérer le catalogue, les tarifs et la réception des paniers.</p>
        {reason === 'inactivite' && <p className="form-message is-info" role="status"><Timer size={16} aria-hidden="true" /> Votre session a été fermée après une période d’inactivité.</p>}
        {reason === 'deconnexion' && <p className="form-message is-info" role="status"><ShieldCheck size={16} aria-hidden="true" /> Vous êtes déconnecté.</p>}
        <form onSubmit={submit} noValidate={false}>
          <label>Nom d’utilisateur<input required autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} pattern="[A-Za-z0-9_]{3,32}" disabled={Boolean(remaining)} /></label>
          <label>Mot de passe
            <span className="password-field">
              <input required type={reveal ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyUp={capsCheck} onKeyDown={capsCheck} minLength={6} maxLength={1024} disabled={Boolean(remaining)} aria-describedby={caps ? 'caps-warning' : undefined} />
              <button type="button" className="field-clear" onClick={() => setReveal(!reveal)} aria-label={reveal ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={reveal}>{reveal ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </span>
          </label>
          {caps && <p className="field-warning" id="caps-warning" role="status"><KeyRound size={14} aria-hidden="true" /> Majuscules verrouillées</p>}
          {message && <p className="form-message" role="alert">{message}</p>}
          {remaining > 0 && <p className="form-message is-locked" role="status"><Timer size={16} aria-hidden="true" /> Nouvel essai possible dans {remaining >= 60 ? `${Math.ceil(remaining / 60)} min` : `${remaining} s`}.</p>}
          <button className="button-primary full" disabled={busy || !isConfigured || Boolean(remaining)}>{busy ? 'Vérification…' : 'Se connecter'} <ArrowRight size={17} /></button>
        </form>
        <ul className="security-notes">
          <li><LockKeyhole size={14} aria-hidden="true" /> Connexion chiffrée, mot de passe jamais stocké sur le site</li>
          <li><Fingerprint size={14} aria-hidden="true" /> Tentatives limitées et surveillées côté serveur</li>
          <li><Timer size={14} aria-hidden="true" /> Déconnexion automatique après inactivité</li>
        </ul>
        {!isConfigured && <p className="notice">L’accès admin sera actif dès la configuration de Supabase.</p>}
        <Link className="auth-back-link" to="/"><ArrowLeft size={15} /> Retour au site</Link>
      </div>
    </section>
  </main>
}
