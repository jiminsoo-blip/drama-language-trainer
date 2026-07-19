import type { RecentSession } from '@/types'

const PREFIX = 'cdt:session:'
const MAX_SESSIONS = 12

export function sessionIdFor(parts: {
  videoName: string | null
  subsName: string | null
  pdfName?: string | null
}): string {
  return parts.videoName ?? parts.subsName ?? parts.pdfName ?? 'unknown'
}

export function saveSession(session: RecentSession): void {
  try {
    localStorage.setItem(PREFIX + session.id, JSON.stringify(session))
    // prune old sessions beyond the cap
    const all = listSessions()
    if (all.length > MAX_SESSIONS) {
      all.slice(MAX_SESSIONS).forEach((s) => deleteSession(s.id))
    }
  } catch {
    // ignore
  }
}

export function listSessions(): RecentSession[] {
  const out: RecentSession[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(PREFIX)) continue
      try {
        out.push(JSON.parse(localStorage.getItem(key) ?? '') as RecentSession)
      } catch {
        // skip malformed
      }
    }
  } catch {
    // ignore
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function deleteSession(id: string): void {
  try {
    localStorage.removeItem(PREFIX + id)
  } catch {
    // ignore
  }
}

export function baseName(fileName: string | null): string | null {
  if (!fileName) return null
  return fileName.replace(/\.[^.]+$/, '')
}
