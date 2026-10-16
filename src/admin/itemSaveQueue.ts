import type { ItemInput } from '../types'

export interface ItemSaveJob {
  key: string
  owner: string
  input: ItemInput
  itemId?: string
  status: 'queued' | 'saving' | 'saved' | 'failed'
  error?: string
  locks: string[]
}

interface Options {
  owner: () => string | null
  save: (job: ItemSaveJob) => Promise<void>
  notify: (text: string) => void
}

/** Deux fiches indépendantes peuvent s'enregistrer simultanément. */
export class ItemSaveQueue {
  private jobs: ItemSaveJob[] = []
  private listeners = new Set<() => void>()
  private running = new Map<string, string[]>()
  constructor(private options: Options) {}

  snapshot = () => this.jobs
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { this.listeners.forEach(listener => listener()) }
  private update(key: string, patch: Partial<ItemSaveJob>) {
    this.jobs = this.jobs.map(job => job.key === key ? { ...job, ...patch } : job)
    this.emit()
  }
  enqueue(input: ItemInput, itemId?: string, extraLocks: string[] = []) {
    const owner = this.options.owner()
    if (!owner) throw new Error('Reconnectez-vous pour enregistrer cette fiche.')
    const job: ItemSaveJob = { key: crypto.randomUUID(), owner, input: { ...input, genres: [...input.genres] }, itemId, status: 'queued',
      locks: [...extraLocks, ...(itemId ? [`id:${itemId}`] : []), `title:${input.title_key}`, ...(input.source_id ? [`source:${input.source}:${input.source_id}`] : [])] }
    this.jobs = [...this.jobs.filter(entry => entry.status !== 'saved'), job]
    this.emit()
    this.pump()
    return job.key
  }
  retry = (key: string) => {
    const job = this.jobs.find(entry => entry.key === key)
    if (!job || job.status !== 'failed' || job.owner !== this.options.owner()) return
    this.update(key, { status: 'queued', error: undefined })
    this.pump()
  }
  dismiss = (key: string) => {
    this.jobs = this.jobs.filter(job => job.key !== key || job.status === 'saving' || job.status === 'queued')
    this.emit()
  }
  private pump() {
    // Les tâches d'une session précédente ne sont jamais relancées sous un autre compte.
    const blocked = new Set([...this.running.values()].flat())
    for (const job of this.jobs) {
      if (job.status !== 'queued' || job.owner !== this.options.owner()) continue
      if (this.running.size >= 2) break
      const locks = job.locks
      if (locks.some(key => blocked.has(key))) { locks.forEach(key => blocked.add(key)); continue }
      locks.forEach(key => blocked.add(key))
      this.running.set(job.key, locks)
      this.update(job.key, { status: 'saving' })
      void this.run(job)
    }
  }
  private async run(job: ItemSaveJob) {
    try {
      await this.options.save(job)
      this.update(job.key, { status: 'saved' })
      if (job.owner === this.options.owner()) this.options.notify(`« ${job.input.title} » : fiche enregistrée.`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Enregistrement impossible.'
      this.update(job.key, { status: 'failed', error: reason })
      if (job.owner === this.options.owner()) this.options.notify(`« ${job.input.title} » : échec. Vos modifications sont conservées dans le suivi des enregistrements.`)
    } finally {
      this.running.delete(job.key)
      this.pump()
    }
  }
}
