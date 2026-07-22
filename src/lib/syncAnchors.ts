// Multi-anchor piecewise subtitle sync correction.
//
// Problem: some videos have ads inserted, so a subtitle file with real
// timestamps drifts out of sync — everything after the ad shifts by the ad's
// duration. A single global offset cannot fix both the before-ad and
// after-ad regions.
//
// Model: anchors are (videoTime, subtitleTime) control points with
// PIECEWISE-CONSTANT semantics — each anchor's offset applies from its own
// videoTime up to (but not including) the next anchor's videoTime. An ad
// insertion becomes two anchors bracketing the ad with a sharp offset jump
// between them, and adding a later anchor never disturbs regions the user
// already calibrated.
//
// Convention: offset(v) = v − s(v) > 0 means the VIDEO runs AHEAD of the
// subtitle file (e.g. an ad was inserted); the subtitle line with original
// time s is displayed at video time v = s + offset. Subtitle times in the
// parsed lines are never mutated — the warp is a view-layer transform.
//
// Persistence: anchors are stored per video-file identity — the same key
// used for recent sessions (sessionIdFor), so switching videos never leaks
// anchors across files.

export interface SyncAnchor {
  videoTime: number
  subtitleTime: number
}

const PREFIX = 'cdt:syncanchors:'

function sorted(anchors: SyncAnchor[]): SyncAnchor[] {
  return [...anchors].sort((a, b) => a.videoTime - b.videoTime)
}

const off = (a: SyncAnchor) => a.videoTime - a.subtitleTime

/**
 * Effective offset (video minus subtitle seconds) at a video time.
 * PIECEWISE-CONSTANT (step) semantics: the offset at v is the offset of the
 * LATEST anchor whose videoTime ≤ v; before the first anchor it is the first
 * anchor's offset. Ad insertions are step changes, and users think in steps:
 * adding anchor #2 changes NOTHING before its own position, so earlier
 * calibrated regions stay exactly as set.
 */
export function offsetAtVideo(anchors: SyncAnchor[], v: number): number {
  if (anchors.length === 0) return 0
  const a = sorted(anchors)
  if (v < a[0].videoTime) return off(a[0])
  let cur = off(a[0])
  for (const anchor of a) {
    if (anchor.videoTime <= v) cur = off(anchor)
    else break
  }
  return cur
}

/**
 * Map an original subtitle timestamp to its video position (inverse of the
 * step warp). Per segment i (video range [a_i.videoTime, a_{i+1}.videoTime),
 * constant offset off_i) the candidate is v = s + off_i, used when it lands
 * inside segment i. Segments are scanned latest-first so OVERLAPS (offset
 * increase — ad inserted: the same subtitle time could map twice) resolve to
 * the LATER segment, and GAPS (offset decrease — content cut: subtitle times
 * mapping nowhere) clamp to the segment boundary. The resulting map is
 * monotonic non-decreasing, as downstream binary search requires.
 */
export function subtitleToVideo(anchors: SyncAnchor[], s: number): number {
  if (anchors.length === 0) return s
  const a = sorted(anchors)
  for (let i = a.length - 1; i >= 0; i--) {
    const vLo = i === 0 ? -Infinity : a[i].videoTime
    const vHi = i + 1 < a.length ? a[i + 1].videoTime : Infinity
    const v = s + off(a[i])
    if (v >= vLo && v < vHi) return v
    // gap at the boundary between segment i-1 and segment i (offset drop):
    // subtitle times in (boundary − off_{i-1}, boundary − off_i) map nowhere
    if (i > 0) {
      const boundary = a[i].videoTime
      const gapLo = boundary - off(a[i - 1])
      const gapHi = boundary - off(a[i])
      if (gapLo < gapHi && s >= gapLo && s < gapHi) return boundary
    }
  }
  return s + off(a[0])
}

function isValidAnchor(a: unknown): a is SyncAnchor {
  if (!a || typeof a !== 'object') return false
  const o = a as Record<string, unknown>
  return (
    typeof o.videoTime === 'number' &&
    Number.isFinite(o.videoTime) &&
    typeof o.subtitleTime === 'number' &&
    Number.isFinite(o.subtitleTime)
  )
}

export function loadSyncAnchors(key: string | null): SyncAnchor[] {
  if (!key) return []
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidAnchor)
  } catch {
    return []
  }
}

export function saveSyncAnchors(key: string | null, anchors: SyncAnchor[]): void {
  if (!key) return
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(anchors))
  } catch {
    // ignore (storage full / private mode)
  }
}

/** insert or replace an anchor; anchors within `mergeWindow` seconds of
 * video time are replaced so re-calibrating the same spot updates in place */
export function upsertAnchor(
  anchors: SyncAnchor[],
  anchor: SyncAnchor,
  mergeWindow = 1,
): SyncAnchor[] {
  const kept = anchors.filter((a) => Math.abs(a.videoTime - anchor.videoTime) > mergeWindow)
  return sorted([...kept, anchor])
}

/** shift every anchor uniformly (quick nudge); with no anchors this creates
 * a single global anchor at t=0, which is exactly a global offset */
export function nudgeAnchors(anchors: SyncAnchor[], delta: number): SyncAnchor[] {
  if (anchors.length === 0) {
    // offset = videoTime - subtitleTime = 0 - (-delta) = delta everywhere
    return [{ videoTime: 0, subtitleTime: -delta }]
  }
  return sorted(anchors.map((a) => ({ ...a, subtitleTime: a.subtitleTime - delta })))
}
