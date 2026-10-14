export const POSTER_JOB_KEY = 'mylist-poster-job-v1'
export type PosterJob = {
  version: 1; id: string; userId: string; kind: 'cache' | 'enrich' | 'repair-games'; ids: string[]
  phase?: 'scan' | 'search'
  candidateIds?: string[]
  label: string; completed: number; total: number; updated: number; stored: number; missing: number
  result?: string; error?: string
}
export function readPosterJob(): PosterJob | null {
  try {
    const job = JSON.parse(localStorage.getItem(POSTER_JOB_KEY) ?? 'null')
    return job?.version === 1 && typeof job.userId === 'string' && typeof job.id === 'string'
      && ['cache', 'enrich', 'repair-games'].includes(job.kind) && Array.isArray(job.ids) && job.ids.every((id: unknown) => typeof id === 'string')
      && (job.phase === undefined || ['scan', 'search'].includes(job.phase))
      && (job.candidateIds === undefined || (Array.isArray(job.candidateIds) && job.candidateIds.every((id: unknown) => typeof id === 'string')))
      && Number.isInteger(job.completed) && job.completed >= 0 && job.completed <= job.ids.length
      && job.total === job.ids.length ? job : null
  } catch { return null }
}
export function savePosterJob(job: PosterJob) {
  // Do not start a batch if its checkpoint cannot be persisted.
  localStorage.setItem(POSTER_JOB_KEY, JSON.stringify(job))
}
