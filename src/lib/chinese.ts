import { pinyin } from 'pinyin-pro'

// ---------------------------------------------------------------------------
// segmentation + pinyin for hanzi text (pinyin-pro)
// ---------------------------------------------------------------------------

export interface WordToken {
  text: string
  isWord: boolean // clickable hanzi token
  pinyin: string // tone marks, empty for non-hanzi
}

const HANZI_RE = /[㐀-鿿豈-﫿]/

let segmenter: Intl.Segmenter | null = null
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter) return segmenter
  try {
    segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
  } catch {
    segmenter = null
  }
  return segmenter
}

export function isHanzi(text: string): boolean {
  return HANZI_RE.test(text)
}

export function toPinyin(text: string): string {
  try {
    return pinyin(text, { toneType: 'symbol' })
  } catch {
    return ''
  }
}

export function segmentSentence(text: string): WordToken[] {
  const seg = getSegmenter()
  if (!seg) {
    // fallback: split into individual hanzi / non-hanzi runs
    const tokens: WordToken[] = []
    let buf = ''
    let bufHan = false
    for (const ch of text) {
      const han = isHanzi(ch)
      if (buf && han !== bufHan) {
        tokens.push({ text: buf, isWord: bufHan, pinyin: bufHan ? toPinyin(buf) : '' })
        buf = ''
      }
      buf += ch
      bufHan = han
    }
    if (buf) tokens.push({ text: buf, isWord: bufHan, pinyin: bufHan ? toPinyin(buf) : '' })
    return tokens
  }
  const out: WordToken[] = []
  for (const s of seg.segment(text)) {
    const han = s.isWordLike === true && isHanzi(s.segment)
    out.push({
      text: s.segment,
      isWord: han,
      pinyin: han ? toPinyin(s.segment) : '',
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// numbered pinyin ("ni3 hao3") -> tone marks ("nǐ hǎo")
// pinyin-pro does not convert numbered input, so we do it here.
// ---------------------------------------------------------------------------

const TONE_MARKS: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  v: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
}

function markSyllable(syl: string): string {
  const m = syl.match(/^([a-zA-ZüÜ:vV]+)([1-5])?$/)
  if (!m) return syl
  const body = m[1].toLowerCase().replace(/u:/g, 'v').replace(/ü/g, 'v')
  const tone = m[2] ? parseInt(m[2], 10) : 0
  if (tone < 1 || tone > 4) return body.replace(/v/g, 'ü') // neutral tone
  let idx = -1
  const aPos = body.indexOf('a')
  const ePos = body.indexOf('e')
  const ouPos = body.indexOf('ou')
  if (aPos !== -1) idx = aPos
  else if (ePos !== -1) idx = ePos
  else if (ouPos !== -1) idx = ouPos
  else {
    for (let i = body.length - 1; i >= 0; i--) {
      if (TONE_MARKS[body[i]]) {
        idx = i
        break
      }
    }
  }
  if (idx === -1) return body.replace(/v/g, 'ü')
  const marked = TONE_MARKS[body[idx]][tone - 1]
  return (body.slice(0, idx) + marked + body.slice(idx + 1)).replace(/v/g, 'ü')
}

export function numberedToToneMarks(numbered: string): string {
  return numbered
    .split(/\s+/)
    .filter(Boolean)
    .map(markSyllable)
    .join(' ')
}
