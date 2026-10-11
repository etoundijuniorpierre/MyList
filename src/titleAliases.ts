const aliases: [RegExp, string][] = [
  [/\bGOW\b/gi, 'God of War'],
  [/\bGTA\b/gi, 'Grand Theft Auto'],
  [/\bCOD\b/gi, 'Call of Duty'],
  [/\bRDR\b/gi, 'Red Dead Redemption'],
  [/\bNFS\b/gi, 'Need for Speed'],
  [/\bTLOU\b/gi, 'The Last of Us'],
  [/\bRE\s*([2-9])\b/gi, 'Resident Evil $1'],
  [/\bDBZ\b/gi, 'Dragon Ball Z'],
  [/\bAOT\b/gi, 'Attack on Titan'],
  [/\bOPM\b/gi, 'One Punch Man'],
  [/\bSAO\b/gi, 'Sword Art Online'],
]

export function expandKnownAlias(title: string): string {
  return aliases.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), title).replace(/\s+/g, ' ').trim()
}

export function searchQueries(title: string): string[] {
  const base = title.trim()
  const expanded = expandKnownAlias(base)
  const candidates = expanded.toLowerCase() === base.toLowerCase() ? [base] : [expanded, base]
  // « Animal Kingdom 2016 » vient d'un nom de dossier : la fiche s'appelle « Animal Kingdom ».
  const withoutYear = candidates.map((entry) => entry.replace(/\s+(?:19|20)\d{2}$/, '').trim()).filter(Boolean)
  return [...new Set([...candidates, ...withoutYear])]
}
