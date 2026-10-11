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
  const expanded = expandKnownAlias(title)
  return expanded.toLowerCase() === title.trim().toLowerCase() ? [title.trim()] : [expanded, title.trim()]
}
