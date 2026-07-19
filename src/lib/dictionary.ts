import { numberedToToneMarks } from '@/lib/chinese'

// CC-CEDICT is licensed CC BY-SA 4.0 — https://cc-cedict.org/wiki/
// Processed locally into public/data/cedict.json by scripts/process_cedict.py.
// Korean glosses are pre-translated OFFLINE into public/data/cedict_ko.json by
// scripts_offline_dict/build_ko_dict.py (Argos Translate en→ko model) — the app
// makes zero network requests at runtime.

export interface DictEntry {
  word: string
  pinyin: string // tone marks
  definitions: string[]
  /** bundled Korean glosses, index-aligned with definitions; null when unavailable */
  definitionsKo: string[] | null
}

export interface CedictPayload {
  _meta: { source: string; license: string; entries: number }
  data: Record<string, [string, string]>
}

let cache: CedictPayload | null = null
let inflight: Promise<CedictPayload> | null = null

export function loadDictionary(): Promise<CedictPayload> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = fetch(`${import.meta.env.BASE_URL}data/cedict.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`사전 로드 실패 (HTTP ${r.status})`)
      return r.json() as Promise<CedictPayload>
    })
    .then((p) => {
      cache = p
      return p
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function isDictionaryLoaded(): boolean {
  return cache !== null
}

let koCache: Record<string, string> | null = null
let koInflight: Promise<Record<string, string>> | null = null

/**
 * Bundled word -> Korean glosses ("ko1; ko2", index-aligned with the English
 * senses). Resolves to {} when the file has not been built yet — callers then
 * show English-only entries.
 */
export function loadKoreanMap(): Promise<Record<string, string>> {
  if (koCache) return Promise.resolve(koCache)
  if (koInflight) return koInflight
  koInflight = fetch(`${import.meta.env.BASE_URL}data/cedict_ko.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
    .then((m) => {
      koCache = m
      return m
    })
    .catch(() => {
      koCache = {}
      return {}
    })
    .finally(() => {
      koInflight = null
    })
  return koInflight
}

function toEntry(word: string, raw: [string, string], koMap?: Record<string, string>): DictEntry {
  const ko = koMap?.[word]
  return {
    word,
    pinyin: numberedToToneMarks(raw[0]),
    definitions: raw[1].split('|').filter(Boolean),
    definitionsKo: ko ? ko.split(';').map((s) => s.trim()).filter(Boolean) : null,
  }
}

/**
 * Look up a word. Exact match first; otherwise the longest dictionary word
 * contained in (or equal to a prefix of) the input, then per-character entries.
 */
export function lookupWord(
  payload: CedictPayload,
  word: string,
  koMap?: Record<string, string>,
): {
  main: DictEntry | null
  chars: DictEntry[]
} {
  const data = payload.data
  let main: DictEntry | null = null
  if (data[word]) {
    main = toEntry(word, data[word], koMap)
  } else {
    // longest prefix present in the dictionary
    for (let len = word.length - 1; len >= 1 && !main; len--) {
      const sub = word.slice(0, len)
      if (len >= 2 && data[sub]) main = toEntry(sub, data[sub], koMap)
    }
  }
  const chars: DictEntry[] = []
  if (word.length > 1) {
    for (const ch of word) {
      if (data[ch]) chars.push(toEntry(ch, data[ch], koMap))
    }
  }
  return { main, chars }
}

/**
 * Longest dictionary entry starting at `start` in `text` (up to maxLen chars).
 * Returns the match length (>= 1), so callers can slice the selected substring.
 */
export function longestMatch(
  payload: CedictPayload,
  text: string,
  start: number,
  maxLen: number,
): number {
  const data = payload.data
  const max = Math.min(maxLen, text.length - start)
  let best = 0
  for (let len = 1; len <= max; len++) {
    if (data[text.slice(start, start + len)]) best = len
  }
  return Math.max(best, 1)
}

export function hasWord(payload: CedictPayload, word: string): boolean {
  return word in payload.data
}
