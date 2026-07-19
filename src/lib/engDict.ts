// English → Korean dictionary for English-mode word lookup.
// Built OFFLINE from kengdic (MPL 2.0 / LGPL 2.0+) by
// scripts_offline_dict/build_eng_ko.py into public/data/eng_ko.json —
// the app makes zero network requests at runtime.

let cache: Record<string, string[]> | null = null
let inflight: Promise<Record<string, string[]>> | null = null

/** bundled english -> Korean glosses map ({ word: ["ko1", "ko2"] }) */
export function loadEngKo(): Promise<Record<string, string[]>> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = fetch(`${import.meta.env.BASE_URL}data/eng_ko.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string[]>>) : {}))
    .then((m) => {
      cache = m
      return m
    })
    .catch(() => {
      cache = {}
      return {}
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Korean glosses for an English word (lowercased lookup); null when missing */
export function lookupEngKo(map: Record<string, string[]>, word: string): string[] | null {
  const hit = map[word.toLowerCase()]
  if (!hit || hit.length === 0) return null
  const parts = hit.map((s) => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : null
}
