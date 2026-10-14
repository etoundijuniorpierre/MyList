import { useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff, KeyRound, LogOut, MonitorSmartphone, ShieldCheck, Timer } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import { IDLE_KEY, idleChoices } from '../useIdleLogout'
import type { Confirm } from './useConfirm'

interface Props {
  user: User
  idleMinutes: number
  confirm: Confirm
  onIdleMinutes: (minutes: number) => void
  onSignOut: (reason: 'inactivite' | 'deconnexion', scope?: 'local' | 'global') => Promise<void>
  onMessage: (text: string, success?: boolean) => void
}

function strength(password: string) {
  let score = 0
  if (password.length >= 12) score++
  if (password.length >= 16) score++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++
  return Math.min(4, score)
}

function maskEmail(email: string | undefined) {
  if (!email) return '—'
  const [name, domain] = email.split('@')
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(2, name.length - 2))}@${domain}`
}

export function SecurityTab({ user, idleMinutes, confirm, onIdleMinutes, onSignOut, onMessage }: Props) {
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void supabase?.auth.getSession().then(({ data }) => setExpiresAt(data.session?.expires_at ? data.session.expires_at * 1000 : null)) }, [])
  const score = strength(password)
  const valid = password.length >= 12 && score >= 3 && password === repeat

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !valid) return
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { onMessage(/reauth|nonce/i.test(error.message) ? 'Supabase demande une nouvelle authentification : reconnectez-vous puis réessayez.' : `Mot de passe non modifié : ${error.message}`); return }
    setPassword(''); setRepeat('')
    onMessage('Mot de passe modifié. Les autres appareils devront se reconnecter.', true)
  }
  async function signOutEverywhere() {
    const ok = await confirm({ title: 'Déconnecter tous les appareils ?', body: 'Toutes les sessions admin ouvertes (téléphone, autre ordinateur, cet appareil) seront fermées.', confirm: 'Tout déconnecter', danger: true })
    if (ok) await onSignOut('deconnexion', 'global')
  }
  return <div className="admin-security">
    <section className="admin-card">
      <h2><ShieldCheck size={20} aria-hidden="true" /> Session en cours</h2>
      <dl className="session-facts">
        <div><dt>Compte</dt><dd>{maskEmail(user.email)}</dd></div>
        <div><dt>Dernière connexion</dt><dd>{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd></div>
        <div><dt>Jeton renouvelé jusqu’à</dt><dd>{expiresAt ? new Date(expiresAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</dd></div>
      </dl>
      <div className="security-actions">
        <button type="button" className="button-ghost" onClick={() => void onSignOut('deconnexion')}><LogOut size={16} /> Se déconnecter</button>
        <button type="button" className="button-danger" onClick={() => void signOutEverywhere()}><MonitorSmartphone size={16} /> Déconnecter tous les appareils</button>
      </div>
    </section>

    <section className="admin-card">
      <h2><Timer size={20} aria-hidden="true" /> Verrouillage automatique</h2>
      <p className="admin-help">Sans clic ni frappe pendant ce délai, la session se ferme dans tous les onglets. Un avertissement apparaît une minute avant. Les traitements longs (affiches, descriptions) suspendent le minuteur.</p>
      <div className="segmented" role="group" aria-label="Délai d’inactivité">{idleChoices.map((value) => <button type="button" key={value} className={idleMinutes === value ? 'is-on' : ''} aria-pressed={idleMinutes === value} onClick={() => { try { localStorage.setItem(IDLE_KEY, String(value)) } catch { /* ignoré */ } onIdleMinutes(value) }}>{value} min</button>)}</div>
    </section>

    <section className="admin-card">
      <h2><KeyRound size={20} aria-hidden="true" /> Changer le mot de passe</h2>
      <form className="price-form" onSubmit={changePassword}>
        <label>Nouveau mot de passe<span className="password-field"><input type={reveal ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} /><button type="button" className="field-clear" onClick={() => setReveal(!reveal)} aria-label={reveal ? 'Masquer' : 'Afficher'}>{reveal ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
        <div className={`strength strength-${score}`} aria-live="polite"><span /><span /><span /><span /><small>{!password ? '12 caractères minimum, avec majuscules, chiffres ou symboles' : ['Très faible', 'Faible', 'Moyen', 'Solide', 'Excellent'][score]}</small></div>
        <label>Confirmer<input type={reveal ? 'text' : 'password'} autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} /></label>
        {repeat && repeat !== password && <p className="field-warning">Les deux mots de passe diffèrent.</p>}
        <button className="button-primary" disabled={!valid || busy}>{busy ? 'Enregistrement…' : 'Modifier le mot de passe'}</button>
      </form>
    </section>

    <section className="admin-card">
      <h2>Protections actives</h2>
      <ul className="protection-list">
        <li><strong>Droits vérifiés par la base</strong> : chaque modification passe par les règles RLS de Supabase, pas seulement par l’interface.</li>
        <li><strong>Connexion par nom d’utilisateur</strong> : l’e-mail reste privé, les échecs renvoient un message générique et sont limités à 8 tentatives par 15 minutes.</li>
        <li><strong>Aucune clé secrète dans le navigateur</strong> : les clés d’API (TheTVDB, IGDB, RAWG) restent dans les fonctions serveur.</li>
        <li><strong>En-têtes de sécurité</strong> : CSP stricte, interdiction d’intégrer le site dans un cadre, pages privées exclues des moteurs de recherche.</li>
        <li><strong>Espace discret</strong> : aucun lien d’administration n’apparaît dans la navigation publique.</li>
      </ul>
    </section>
  </div>
}
