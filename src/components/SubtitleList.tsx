import { useEffect, useMemo, useRef } from 'react'
import type { SubtitleLine } from '@/types'
import { isHanzi } from '@/lib/chinese'
import { cleanEnglishWord } from '@/components/EnglishSentence'
import { formatTime } from '@/lib/time'
import { cn } from '@/lib/utils'

interface Props {
  lines: SubtitleLine[]
  activeIndex: number
  labelMode?: 'time' | 'index'
  lang?: 'zh' | 'en'
  /** e.g. "싱크 +32.5초" — shown as a chip while a sync warp is active */
  syncLabel?: string | null
  /** calibration selection (sync panel open); -1 = none */
  selectedIndex?: number
  onLineClick: (index: number) => void
  /** zh: click a hanzi character (char index in line text) */
  onCharClick: (line: SubtitleLine, charIndex: number, rect: DOMRect) => void
  /** en: click a word (cleaned lowercase lookup word) */
  onWordClick?: (line: SubtitleLine, word: string, rect: DOMRect) => void
}

/** line text rendered as per-character spans; hanzi chars are clickable */
function ClickableText({
  line,
  onCharClick,
}: {
  line: SubtitleLine
  onCharClick: Props['onCharClick']
}) {
  const chars = useMemo(() => Array.from(line.text), [line.text])
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
    <>
      {chars.map((ch, i) =>
        isHanzi(ch) ? (
          <span
            key={i}
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              onCharClick(line, origIndex[i], (e.currentTarget as HTMLElement).getBoundingClientRect())
            }}
            className="cursor-pointer rounded-sm px-px hover:bg-amber-400/20 hover:text-amber-200"
          >
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  )
}

/** English line: whitespace-delimited clickable words */
function ClickableEnglishText({
  line,
  onWordClick,
}: {
  line: SubtitleLine
  onWordClick: (word: string, rect: DOMRect) => void
}) {
  const tokens = useMemo(() => line.text.split(/(\s+)/), [line.text])
  return (
    <>
      {tokens.map((tok, i) => {
        const clean = cleanEnglishWord(tok)
        if (!clean) return <span key={i}>{tok}</span>
        return (
          <span
            key={i}
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              onWordClick(clean, (e.currentTarget as HTMLElement).getBoundingClientRect())
            }}
            className="cursor-pointer rounded-sm px-px hover:bg-amber-400/20 hover:text-amber-200"
          >
            {tok}
          </span>
        )
      })}
    </>
  )
}

export default function SubtitleList({
  lines,
  activeIndex,
  labelMode = 'time',
  lang = 'zh',
  syncLabel = null,
  selectedIndex = -1,
  onLineClick,
  onCharClick,
  onWordClick,
}: Props) {
  const activeRef = useRef<HTMLDivElement>(null)
  const lastScrolled = useRef(-1)

  useEffect(() => {
    if (activeIndex >= 0 && activeIndex !== lastScrolled.current) {
      lastScrolled.current = activeIndex
      activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [activeIndex])

  const lookupHint = lang === 'en' ? '단어 클릭 = 번역 보기' : '글자 클릭 = 사전 검색'

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2 text-xs font-medium tracking-wide text-zinc-500">
        <span>
          {labelMode === 'index'
            ? `대본 문장 ${lines.length.toLocaleString()}개 · 문장 클릭 = 선택 · ${lookupHint}`
            : `자막 ${lines.length.toLocaleString()}줄 · 문장 클릭 = 해당 장면으로 · ${lookupHint}`}
        </span>
        {syncLabel && (
          <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 font-mono text-[11px] text-sky-300">
            {syncLabel}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.map((l, i) => {
          const active = i === activeIndex
          const selected = i === selectedIndex
          return (
            <div
              key={l.id}
              ref={active ? activeRef : undefined}
              role="button"
              tabIndex={0}
              onClick={() => onLineClick(i)}
              onKeyDown={(e) => e.key === 'Enter' && onLineClick(i)}
              className={cn(
                'flex w-full cursor-pointer items-start gap-3 border-l-2 px-4 py-2 text-left transition-colors',
                active
                  ? 'border-amber-400 bg-amber-400/10'
                  : 'border-transparent hover:bg-zinc-900',
                selected && 'border-sky-400 bg-sky-400/10 ring-1 ring-inset ring-sky-400/60',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 shrink-0 font-mono text-xs tabular-nums',
                  active ? 'text-amber-300' : 'text-zinc-600',
                )}
              >
                {labelMode === 'index' ? `#${i + 1}` : formatTime(l.start)}
              </span>
              <span
                className={cn(
                  'text-[15px] leading-relaxed',
                  lang === 'zh' && 'zh',
                  active ? 'text-zinc-50' : 'text-zinc-400',
                )}
                lang={lang === 'en' ? 'en' : undefined}
              >
                {lang === 'en' ? (
                  <ClickableEnglishText
                    line={l}
                    onWordClick={(word, rect) => onWordClick?.(l, word, rect)}
                  />
                ) : (
                  <ClickableText line={l} onCharClick={onCharClick} />
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
