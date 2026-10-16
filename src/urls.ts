export function safeUrl(url: string | null) {
  if (!url) return undefined
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.href : undefined }
  catch { return undefined }
}
