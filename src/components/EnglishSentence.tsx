import { useMemo } from 'react'
import { SENTENCE_FONT_PX } from '@/components/ChineseSentence'
import type { DisplaySettings } from '@/lib/storage'

interface Props {
  text: string
  translation: string | null
  fontSize: DisplaySettings['fontSize']
  /** click an English word: cleaned lookup word (lowercase, punctuation stripped) + rect */
  onWordClick: (word: string, rect: DOMRect) => void
}

/** strip leading/trailing punctuation, lowercase for dictionary/translate lookup */
export function cleanEnglishWord(token: string): string {
  return token.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '').toLowerCase()
}

/**
 * English sentence in the same large joined style (normal word spacing).
 * Each word is individually clickable for translate-based lookup.
 */
export default function EnglishSentence({ text, translation, fontSize, onWordClick }: Props) {
  const px = SENTENCE_FONT_PX[fontSize]
  const tokens = useMemo(() => text.split(/(\s+)/), [text])

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-y-3 leading-snug" style={{ fontSize: px }} lang="en">
        {tokens.map((tok, i) => {
          const clean = cleanEnglishWord(tok)
          if (!clean) return <span key={i} className="text-zinc-300">{tok}</span>
          return (
            <button
              key={i}
              onClick={(e) =>
                onWordClick(clean, (e.currentTarget as HTMLElement).getBoundingClientRect())
              }
              className="rounded-sm px-0.5 text-zinc-50 transition-colors hover:bg-amber-400/15 hover:text-amber-200"
              lang="en"
            >
              {tok}
            </button>
          )
        })}
      </div>
      {translation && (
        <p className="mt-4 leading-relaxed text-zinc-300" style={{ fontSize: px }}>
          {translation}
        </p>
      )}
    </div>
  )
}
