import { useMemo } from 'react'
import { pinyin } from 'pinyin-pro'
import { isHanzi } from '@/lib/chinese'
import type { DisplaySettings } from '@/lib/storage'

export const SENTENCE_FONT_PX: Record<DisplaySettings['fontSize'], number> = {
  md: 30,
  lg: 36,
  xl: 44,
}

interface Props {
  text: string
  translation: string | null
  fontSize: DisplaySettings['fontSize']
  pinyinOn: boolean
  /** click a hanzi character: char index in `text` + bounding rect */
  onCharClick: (charIndex: number, rect: DOMRect) => void
}

/**
 * Current sentence rendered as large continuous Chinese text (no word gaps),
 * with tiny per-character pinyin above each hanzi. Every hanzi character is
 * individually clickable for dictionary lookup.
 */
export default function ChineseSentence({ text, translation, fontSize, pinyinOn, onCharClick }: Props) {
  const px = SENTENCE_FONT_PX[fontSize]

  // per-character pinyin for the whole sentence (context-aware readings)
  const chars = useMemo(() => Array.from(text), [text])
  const pinyins = useMemo(() => {
    try {
      return pinyin(text, { toneType: 'symbol', type: 'array' })
    } catch {
      return chars.map(() => '')
    }
  }, [text, chars])

  // map Array.from index -> original string index (surrogate-pair safe)
  const origIndex = useMemo(() => {
    const map: number[] = []
    let o = 0
    for (const ch of chars) {
      map.push(o)
      o += ch.length
    }
    return map
  }, [chars])

  return (
    <div>
      <div
        className="zh flex flex-wrap items-end gap-y-3 leading-snug"
        style={{ fontSize: px }}
        lang="zh-CN"
      >
        {chars.map((ch, i) =>
          isHanzi(ch) ? (
            <button
              key={i}
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                onCharClick(origIndex[i], rect)
              }}
              className="group flex flex-col items-center rounded-sm px-px transition-colors hover:bg-amber-400/15"
              title={pinyins[i]}
            >
              {pinyinOn ? (
                <span
                  className="font-semibold leading-tight text-zinc-300 group-hover:text-amber-200"
                  style={{ fontSize: Math.max(13, px * 0.48) }}
                >
                  {pinyins[i]}
                </span>
              ) : null}
              <span className="text-zinc-50 group-hover:text-amber-200">{ch}</span>
            </button>
          ) : (
            <span key={i} className="flex flex-col items-center px-px">
              {pinyinOn ? (
                <span style={{ fontSize: Math.max(13, px * 0.48) }} className="leading-tight">
                  &nbsp;
                </span>
              ) : null}
              <span className="text-zinc-300">{ch}</span>
            </span>
          ),
        )}
      </div>
      {translation && (
        <p className="mt-4 leading-relaxed text-zinc-300" style={{ fontSize: px }}>
          {translation}
        </p>
      )}
    </div>
  )
}
