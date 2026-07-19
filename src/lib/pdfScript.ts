// Dual-language PDF script parsing: pure functions over extracted text lines.
// Chinese sentence + Korean translation on the same line; wraps across lines.

export interface ScriptSentence {
  id: number
  chinese: string
  korean: string
}

const CJK_RE = /[㐀-鿿豈-﫿]/
const HANGUL_RE = /[가-힣ᄀ-ᇿㄱ-㆏]/
const PAGE_MARKER_RE = /^\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/
const DATE_LINE_RE = /^\s*\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*[.\-/일]?/

export function hasCjk(s: string): boolean {
  return CJK_RE.test(s)
}
export function hasHangul(s: string): boolean {
  return HANGUL_RE.test(s)
}

/** true for header/footer noise lines (page markers, dates, ascii-only titles) */
function isNoiseLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (PAGE_MARKER_RE.test(t)) return true
  if (DATE_LINE_RE.test(t)) return true
  return false
}

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

const SENTENCE_BREAK = '\u0001'

// CJK punctuation (for space handling)
const CJK_PUNCT = '\u3002\uff0c\uff1f\uff01\uff1a\uff1b\u3001\u2026\u2014\u300c\u300d\u300e\u300f\uff08\uff09\u300a\u300b\u201c\u201d\u2018\u2019'

/**
 * Normalize Chinese text extracted from PDFs.
 * Two extraction styles exist in the wild:
 *  - "spaced-out": nearly every CJK char is separated by spaces (pypdf-style)
 *    -> single spaces between CJK chars are artifacts and are removed
 *  - "phrase" style: spaces appear only at phrase boundaries (pdfjs-style)
 *    -> single spaces are meaningful and preserved
 * The style is detected per text; double-space runs are always kept as breaks.
 */
export function cleanupChinese(raw: string): string {
  let s = raw
  s = s.replace(/ {2,}|\t+/g, SENTENCE_BREAK) // preserve deliberate breaks
  const cjkCount = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const spacedPairs = (s.match(/(?=[\u3400-\u9fff\uf900-\ufaff] [\u3400-\u9fff\uf900-\ufaff])/g) ?? []).length
  if (cjkCount > 0 && spacedPairs / cjkCount > 0.2) {
    // spaced-out style: drop single spaces between CJK chars / CJK punctuation
    const pair = new RegExp(
      `([\\u3400-\\u9fff\\uf900-\\ufaff${CJK_PUNCT}]) ([\\u3400-\\u9fff\\uf900-\\ufaff${CJK_PUNCT}])`,
      'g',
    )
    let prev = ''
    while (prev !== s) {
      prev = s
      s = s.replace(pair, '$1$2')
    }
  }
  s = s.replace(new RegExp(SENTENCE_BREAK, 'g'), ' ')
  s = s.replace(/ {2,}/g, ' ')
  // trim space after opening quotes / before closing quotes & CJK punctuation
  s = s.replace(/([\u201c\u2018\u300c\u300e\uff08\u300a]) /g, '$1')
  s = s.replace(/ ([\u201d\u2019\u300d\u300f\uff09\u300b])/g, '$1')
  s = s.replace(/ ([\uff0c\u3002\uff1f\uff01\uff1a\uff1b\u3001\u2026\u2014])/g, '$1')
  return s.trim()
}

export function cleanupKorean(raw: string): string {
  let s = raw.replace(/\s{2,}/g, ' ').trim()
  // no space before sentence punctuation
  s = s.replace(/ ([?!.,…·]+)/g, '$1')
  // space after opening quote, remove it
  s = s.replace(/“ /g, '“')
  return s.trim()
}

// ---------------------------------------------------------------------------
// line splitting
// ---------------------------------------------------------------------------

interface SplitLine {
  chinese: string
  korean: string
  onlyChinese: boolean
  onlyKorean: boolean
  fragmentKorean: boolean // short spaceless continuation (e.g. '서', '하니까')
}

function splitLine(line: string): SplitLine | null {
  if (isNoiseLine(line)) return null
  const m = line.match(HANGUL_RE)
  const cjk = hasCjk(line)
  if (!m) {
    if (!cjk) return null // ascii-only header/footer (series title etc.)
    return { chinese: line, korean: '', onlyChinese: true, onlyKorean: false, fragmentKorean: false }
  }
  const idx = m.index ?? 0
  const chinese = line.slice(0, idx)
  const korean = line.slice(idx)
  if (!hasCjk(chinese)) {
    const t = korean.trim()
    const fragment = !/\s/.test(t) && t.length <= 4
    return { chinese: '', korean, onlyChinese: false, onlyKorean: true, fragmentKorean: fragment }
  }
  return { chinese, korean, onlyChinese: false, onlyKorean: false, fragmentKorean: false }
}

// ---------------------------------------------------------------------------
// reassembly
// ---------------------------------------------------------------------------

/**
 * Parse extracted PDF text (pages separated by \n or form-feed) into
 * aligned Chinese/Korean sentence records.
 */
export function parseScriptText(text: string): ScriptSentence[] {
  const out: ScriptSentence[] = []
  let curChinese = ''
  let curKorean = ''

  const flush = () => {
    const c = cleanupChinese(curChinese)
    const k = cleanupKorean(curKorean)
    if (c) out.push({ id: out.length, chinese: c, korean: k })
    curChinese = ''
    curKorean = ''
  }

  for (const rawLine of text.split(/\r?\n|\f/)) {
    const parts = splitLine(rawLine)
    if (!parts) continue

    if (!parts.onlyChinese && !parts.onlyKorean) {
      // both languages on one line
      if (curKorean.trim()) flush()
      curChinese += parts.chinese
      curKorean += (curKorean && parts.korean ? ' ' : '') + parts.korean
    } else if (parts.onlyChinese) {
      // Chinese continuation (or a new record whose translation comes later)
      if (curKorean.trim()) flush()
      curChinese += parts.chinese
    } else {
      // Korean continuation
      if (!curChinese.trim() && !curKorean.trim()) continue
      const prevEndsHangul = HANGUL_RE.test(curKorean.slice(-1))
      curKorean += parts.fragmentKorean && prevEndsHangul ? parts.korean.trim() : ' ' + parts.korean.trim()
    }
  }
  flush()
  return out
}

// ---------------------------------------------------------------------------
// estimated sync (PDF has no timestamps)
// ---------------------------------------------------------------------------

import type { SubtitleLine } from '@/types'

function charWeight(sentence: string): number {
  return Math.max(sentence.replace(/\s/g, '').length, 1)
}

/** cumulative character weights: base start fraction of each sentence */
export function cumulativeFractions(sentences: ScriptSentence[]): number[] {
  const weights = sentences.map((s) => charWeight(s.chinese))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const fracs: number[] = []
  let cum = 0
  for (const w of weights) {
    fracs.push(cum / total)
    cum += w
  }
  return fracs
}

/**
 * Distribute sentence times proportionally to Chinese character counts across
 * the video duration, then shift by the user-calibrated global offset.
 * Each line's end is the next line's estimated start (so AB repeat works).
 */
export function buildEstimatedLines(
  sentences: ScriptSentence[],
  duration: number,
  offset: number,
): SubtitleLine[] {
  const fracs = cumulativeFractions(sentences)
  const starts = fracs.map((f) => f * duration + offset)
  return sentences.map((s, i) => {
    const start = Math.min(Math.max(starts[i], 0), Math.max(duration - 0.1, 0))
    const rawEnd = i + 1 < sentences.length ? starts[i + 1] : duration
    const end = Math.min(Math.max(rawEnd, start + 0.1), duration)
    return { id: i, start, end, text: s.chinese }
  })
}
