import type { SubtitleLine } from '@/types'

// ---------------------------------------------------------------------------
// time helpers
// ---------------------------------------------------------------------------

/** "01:23:45,678" | "01:23:45.678" | "23:45.678" -> seconds */
function parseHms(ts: string): number | null {
  const m = ts.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/)
  if (!m) return null
  const h = m[1] ? parseInt(m[1], 10) : 0
  const min = parseInt(m[2], 10)
  const sec = parseInt(m[3], 10)
  const frac = m[4].padEnd(3, '0').slice(0, 3)
  return h * 3600 + min * 60 + sec + parseInt(frac, 10) / 1000
}

/** ASS/SSA time "0:01:23.45" (centiseconds) -> seconds */
function parseAssTime(ts: string): number | null {
  const m = ts.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})\.(\d{1,2})$/)
  if (!m) return null
  return (
    parseInt(m[1], 10) * 3600 +
    parseInt(m[2], 10) * 60 +
    parseInt(m[3], 10) +
    parseInt(m[4].padEnd(2, '0'), 10) / 100
  )
}

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------

function parseSrt(content: string): SubtitleLine[] {
  const lines: SubtitleLine[] = []
  const blocks = content.replace(/\r/g, '').split(/\n\n+/)
  for (const block of blocks) {
    const rows = block.split('\n').filter((r) => r.trim() !== '')
    if (rows.length === 0) continue
    const timeIdx = rows.findIndex((r) => r.includes('-->'))
    if (timeIdx === -1) continue
    const tm = rows[timeIdx].match(
      /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/,
    )
    if (!tm) continue
    const start = parseHms(tm[1])
    const end = parseHms(tm[2])
    if (start === null || end === null) continue
    const text = rows
      .slice(timeIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (text) lines.push({ id: 0, start, end, text })
  }
  return lines
}

// ---------------------------------------------------------------------------
// WebVTT
// ---------------------------------------------------------------------------

function parseVtt(content: string): SubtitleLine[] {
  const body = content
    .replace(/\r/g, '')
    .replace(/^WEBVTT[^\n]*\n/, '')
  const lines: SubtitleLine[] = []
  const blocks = body.split(/\n\n+/)
  for (const block of blocks) {
    const rows = block.split('\n').filter((r) => r.trim() !== '')
    if (rows.length === 0) continue
    if (/^(NOTE|STYLE|REGION)/.test(rows[0])) continue
    const timeIdx = rows.findIndex((r) => r.includes('-->'))
    if (timeIdx === -1) continue
    const tm = rows[timeIdx].match(
      /((?:\d{1,2}:)?\d{1,2}:\d{2}\.\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}\.\d{1,3})/,
    )
    if (!tm) continue
    const start = parseHms(tm[1])
    const end = parseHms(tm[2])
    if (start === null || end === null) continue
    const text = rows
      .slice(timeIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (text) lines.push({ id: 0, start, end, text })
  }
  return lines
}

// ---------------------------------------------------------------------------
// ASS / SSA
// ---------------------------------------------------------------------------

function parseAss(content: string): SubtitleLine[] {
  const lines: SubtitleLine[] = []
  const raw = content.replace(/\r/g, '').split('\n')
  let inEvents = false
  let fmt: string[] = []
  for (const row of raw) {
    const trimmed = row.trim()
    if (/^\[events\]/i.test(trimmed)) {
      inEvents = true
      continue
    }
    if (/^\[.*\]/.test(trimmed)) {
      inEvents = false
      continue
    }
    if (!inEvents) continue
    if (/^format:/i.test(trimmed)) {
      fmt = trimmed
        .slice(7)
        .split(',')
        .map((s) => s.trim().toLowerCase())
      continue
    }
    if (!/^dialogue:/i.test(trimmed)) continue
    const startIdx = fmt.indexOf('start')
    const endIdx = fmt.indexOf('end')
    const textIdx = fmt.indexOf('text')
    if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue
    const parts = trimmed.slice(9).split(',')
    // text field may contain commas: everything from textIdx on is the text
    const start = parseAssTime(parts[startIdx] ?? '')
    const end = parseAssTime(parts[endIdx] ?? '')
    if (start === null || end === null) continue
    const text = parts
      .slice(textIdx)
      .join(',')
      .replace(/\{[^}]*\}/g, '') // override tags
      .replace(/\\[nN]/g, ' ')
      .replace(/\\h/g, ' ')
      .trim()
    if (text) lines.push({ id: 0, start, end, text })
  }
  return lines
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export function parseSubtitleFile(fileName: string, content: string): SubtitleLine[] {
  const ext = (fileName.toLowerCase().split('.').pop() ?? '') as string
  let parsed: SubtitleLine[]
  if (ext === 'ass' || ext === 'ssa' || content.includes('[Script Info]')) {
    parsed = parseAss(content)
  } else if (ext === 'vtt' || content.trimStart().startsWith('WEBVTT')) {
    parsed = parseVtt(content)
  } else {
    parsed = parseSrt(content)
  }
  parsed.sort((a, b) => a.start - b.start)
  return parsed
    .filter((l) => l.end > l.start)
    .map((l, i) => ({ ...l, id: i }))
}

/** binary search: index of the line active at time t, or -1 */
export function activeLineIndex(lines: SubtitleLine[], t: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].start <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (ans === -1) return -1
  // active only while within the line window; if in a gap, still return the
  // most recent line so the panel keeps showing context
  return ans
}

/** translation matching: nearest line whose window overlaps t */
export function translationAt(lines: SubtitleLine[], t: number): string | null {
  if (lines.length === 0) return null
  const idx = activeLineIndex(lines, t)
  if (idx === -1) return lines[0].start > t ? null : lines[lines.length - 1].text
  const l = lines[idx]
  if (t <= l.end + 0.5) return l.text
  return null
}

/**
 * Detect subtitle script language: CJK characters → Chinese mode ('zh'),
 * Latin script → English mode ('en'). Samples up to 60 lines.
 */
export function detectScriptLang(lines: SubtitleLine[]): 'zh' | 'en' {
  let cjk = 0
  let latin = 0
  for (const l of lines.slice(0, 60)) {
    for (const ch of l.text) {
      if (/[㐀-鿿豈-﫿]/.test(ch)) cjk++
      else if (/[a-zA-Z]/.test(ch)) latin++
    }
  }
  return cjk >= latin ? 'zh' : 'en'
}
