export function projectKey(mapName: string, legacyName: string): string | undefined {
  const raw = Deno.env.get(mapName)
  if (raw) {
    try {
      const value = JSON.parse(raw)?.default
      if (typeof value === 'string' && value) return value
    } catch {
      // Older projects may only expose the legacy key below.
    }
  }
  return Deno.env.get(legacyName)
}
