import { Check, CircleAlert, LoaderCircle, X } from 'lucide-react'
import type { ItemSaveJob } from './itemSaveQueue'

export function ItemSaveStatus({ jobs, onRetry, onResume, onDismiss }: {
  jobs: ItemSaveJob[]
  onRetry: (key: string) => void
  onResume: (job: ItemSaveJob) => void
  onDismiss: (key: string) => void
}) {
  if (!jobs.length) return null
  return <section className="item-save-status" aria-label="Suivi des enregistrements">
    <h2>Enregistrements</h2>
    <p>Vous pouvez modifier une autre fiche pendant l’enregistrement.</p>
    <ul>{jobs.map(job => <li key={job.key} className={job.status === 'failed' ? 'has-error' : ''}>
      <span aria-hidden="true">{job.status === 'saved' ? <Check size={16} /> : job.status === 'failed' ? <CircleAlert size={16} /> : <LoaderCircle className="spin" size={16} />}</span>
      <div role={job.status === 'failed' ? 'alert' : 'status'}><strong>{job.input.title}</strong><span>{job.status === 'queued' ? 'En attente' : job.status === 'saving' ? 'Enregistrement…' : job.status === 'saved' ? 'Enregistré' : job.error}</span></div>
      {job.status === 'failed' && <><button type="button" onClick={() => onRetry(job.key)}>Réessayer</button><button type="button" onClick={() => onResume(job)}>Reprendre la correction</button></>}
      {(job.status === 'saved' || job.status === 'failed') && <button type="button" onClick={() => onDismiss(job.key)} aria-label={`Fermer le suivi de ${job.input.title}`}><X size={15} /></button>}
    </li>)}</ul>
  </section>
}
