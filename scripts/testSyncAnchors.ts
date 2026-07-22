// Unit tests for the multi-anchor sync warp (piecewise-CONSTANT semantics).
// Run: node --experimental-strip-types scripts/testSyncAnchors.ts
import {
  offsetAtVideo,
  subtitleToVideo,
  upsertAnchor,
  nudgeAnchors,
  type SyncAnchor,
} from '../src/lib/syncAnchors.ts'

let failures = 0
function eq(actual: unknown, expected: unknown, label: string) {
  const ok = Math.abs((actual as number) - (expected as number)) < 1e-9
  if (!ok) {
    failures++
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`)
  } else {
    console.log(`ok   ${label}`)
  }
}
function truthy(v: boolean, label: string) {
  if (!v) {
    failures++
    console.error(`FAIL ${label}`)
  } else {
    console.log(`ok   ${label}`)
  }
}

// --- anchors: ad inserted at video 600..632.5 (offset steps 0 -> +32.5) ----
const AD: SyncAnchor[] = [
  { videoTime: 600, subtitleTime: 600 }, // off 0
  { videoTime: 632.5, subtitleTime: 600 }, // off +32.5
]

// (a) before FIRST anchor = first anchor's offset
eq(offsetAtVideo(AD, 300), 0, 'a) t=300 before first anchor → 0')
// (b) between anchor1 and anchor2 = anchor1's offset CONSTANT (no smear)
eq(offsetAtVideo(AD, 620), 0, 'b) t=620 between anchors → 0 constant')
eq(offsetAtVideo(AD, 632.499), 0, 'b) t=632.499 just before anchor2 → still 0')
// (c) at/after anchor2 = anchor2's offset
eq(offsetAtVideo(AD, 632.5), 32.5, 'c) t=632.5 at anchor2 → +32.5')
eq(offsetAtVideo(AD, 700), 32.5, 'c/d) t=700 after anchor2 → +32.5')

// (d) the full ad scenario from the spec
eq(offsetAtVideo(AD, 300), 0, 'd) t=300 → 0')
eq(offsetAtVideo(AD, 620), 0, 'd) t=620 → 0')
eq(offsetAtVideo(AD, 700), 32.5, 'd) t=700 → +32.5')

// adding anchor #2 changes NOTHING before its own position
const ONE = [AD[0]]
eq(offsetAtVideo(ONE, 500), offsetAtVideo(AD, 500), 'new anchor leaves t=500 untouched')
eq(offsetAtVideo(ONE, 631), offsetAtVideo(AD, 631), 'new anchor leaves t=631 untouched')

// (e) subtitleToVideo round-trips line times within segments
eq(subtitleToVideo(AD, 500), 500, 'e) line 500 → video 500 (segment 1)')
eq(subtitleToVideo(AD, 700), 732.5, 'e) line 700 → video 732.5 (segment 2)')
eq(offsetAtVideo(AD, subtitleToVideo(AD, 700)), 32.5, 'e) round-trip offset at mapped point')
eq(subtitleToVideo(AD, 500) + 0, 500, 'e) round-trip pre-ad')
// overlap resolution: line 610 could map to 610 (seg1) or 642.5 (seg2) → later segment wins
eq(subtitleToVideo(AD, 610), 642.5, 'e) overlap resolves to later segment')

// (f) monotonic non-decreasing warp across boundaries
{
  let prev = -Infinity
  let mono = true
  for (let s = 550; s <= 720; s += 0.5) {
    const v = subtitleToVideo(AD, s)
    if (v < prev - 1e-9) mono = false
    prev = v
  }
  truthy(mono, 'f) warp monotonic non-decreasing across the step')
}

// gap scenario (offset DECREASES — content cut from the video):
// off steps +20 -> 0 at video 500; subtitle times 480..500 map nowhere → clamp
const CUT: SyncAnchor[] = [
  { videoTime: 300, subtitleTime: 280 }, // off +20
  { videoTime: 500, subtitleTime: 500 }, // off 0
]
eq(subtitleToVideo(CUT, 470), 490, 'gap) before boundary maps in segment 1')
eq(subtitleToVideo(CUT, 490), 500, 'gap) cut content clamps to boundary')
eq(subtitleToVideo(CUT, 600), 600, 'gap) after boundary maps in segment 2')
{
  let prev = -Infinity
  let mono = true
  for (let s = 260; s <= 620; s += 0.5) {
    const v = subtitleToVideo(CUT, s)
    if (v < prev - 1e-9) mono = false
    prev = v
  }
  truthy(mono, 'gap) monotonic across the cut')
}

// global-offset single anchor + nudge semantics (unchanged behavior)
const G = nudgeAnchors([], 5)
eq(offsetAtVideo(G, 1234), 5, 'single anchor = global offset')
eq(subtitleToVideo(G, 100), 105, 'global offset inverse')
const N = nudgeAnchors(AD, 1)
eq(offsetAtVideo(N, 300), 1, 'nudge shifts all anchors uniformly (early)')
eq(offsetAtVideo(N, 700), 33.5, 'nudge shifts all anchors uniformly (late)')

// upsert merge window
const U = upsertAnchor([{ videoTime: 100, subtitleTime: 90 }], { videoTime: 100.5, subtitleTime: 88 })
truthy(U.length === 1 && U[0].subtitleTime === 88, 'upsert replaces within merge window')

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`)
if (failures > 0) process.exit(1)
