import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookMarked, ChevronLeft, ChevronRight, Download, Play, RotateCw, Shuffle, Trash2, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { speak } from '@/lib/tts'
import { formatTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { VocabEntry } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  vocab: VocabEntry[]
  videoLoaded: boolean
  onSeek: (timestamp: number) => void
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: Partial<VocabEntry>) => void
}

function exportCsv(vocab: VocabEntry[]) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
  const rows = [
    ['word', 'pinyin', 'korean', 'english', 'context'].join(','),
    ...vocab.map((v) =>
      [
        esc(v.word),
        esc(v.pinyin),
        esc((v.definitionsKo ?? []).filter(Boolean).join('; ')),
        esc(v.definitions.join('; ')),
        esc(v.context),
      ].join(','),
    ),
  ]
  const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'drama-vocab.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function primaryDefs(v: VocabEntry): string[] {
  const ko = (v.definitionsKo ?? []).filter(Boolean)
  return ko.length > 0 ? ko : v.definitions
}

function Flashcards({
  vocab,
  onClose,
  onSpeak,
  ttsMsg,
}: {
  vocab: VocabEntry[]
  onClose: () => void
  onSpeak: (entry: VocabEntry) => void
  ttsMsg: string | null
}) {
  const [order, setOrder] = useState<number[]>(() => vocab.map((_, i) => i))
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const card = vocab[order[idx]]

  const go = (delta: number) => {
    setFlipped(false)
    setIdx((i) => (i + delta + order.length) % order.length)
  }
  const shuffle = () => {
    const arr = [...order]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    setOrder(arr)
    setIdx(0)
    setFlipped(false)
  }

  if (!card) return null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between text-zinc-100">
            <span>플래시카드 복습</span>
            <span className="text-sm font-normal text-zinc-500">
              {idx + 1} / {order.length}
            </span>
          </DialogTitle>
        </DialogHeader>
        <FlashcardBody entry={card} flipped={flipped} onFlip={() => setFlipped((f) => !f)} onSpeak={() => onSpeak(card)} />
        {ttsMsg && <p className="text-center text-xs text-zinc-500">{ttsMsg}</p>}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => go(-1)} className="border-zinc-700">
            <ChevronLeft className="mr-1 h-4 w-4" /> 이전
          </Button>
          <Button variant="outline" size="sm" onClick={shuffle} className="border-zinc-700">
            <Shuffle className="mr-1 h-4 w-4" /> 섞기
          </Button>
          <Button variant="outline" size="sm" onClick={() => go(1)} className="border-zinc-700">
            다음 <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FlashcardBody({
  entry,
  flipped,
  onFlip,
  onSpeak,
}: {
  entry: VocabEntry
  flipped: boolean
  onFlip: () => void
  onSpeak: () => void
}) {
  const defs = primaryDefs(entry)
  const showEnglish = (entry.definitionsKo ?? []).filter(Boolean).length > 0
  const isZh = entry.lang === 'zh'
  return (
    <div className="relative">
      <button
        onClick={onFlip}
        className="flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center transition-colors hover:border-amber-500/50"
      >
        {!flipped ? (
          <>
            <div
              className={cn('text-5xl font-bold text-amber-300', isZh && 'zh')}
              lang={isZh ? 'zh-CN' : 'en'}
            >
              {entry.word}
            </div>
            <div className="text-xs text-zinc-600">클릭하면 뜻이 보입니다</div>
          </>
        ) : (
          <>
            {entry.pinyin && <div className="text-xl text-zinc-300">{entry.pinyin}</div>}
            <ul className="space-y-1 text-base text-zinc-100">
              {defs.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
            {showEnglish && (
              <ul className="space-y-0.5 text-xs text-zinc-500">
                {entry.definitions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
            {entry.context && (
              <div
                className={cn('mt-2 border-t border-zinc-800 pt-2 text-sm text-zinc-500', isZh && 'zh')}
                lang={isZh ? 'zh-CN' : 'en'}
              >
                {entry.context}
              </div>
            )}
          </>
        )}
      </button>
      {/* TTS — sits outside the flip button so both card faces can speak */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onSpeak()
        }}
        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-amber-300"
        aria-label="발음 듣기"
        title="발음 듣기"
      >
        <Volume2 className="h-4 w-4" />
      </button>
    </div>
  )
}

function VocabRow({
  v,
  multiLang,
  videoLoaded,
  onSeek,
  onDelete,
  onClose,
  onSpeak,
}: {
  v: VocabEntry
  multiLang: boolean
  videoLoaded: boolean
  onSeek: (t: number) => void
  onDelete: (id: string) => void
  onClose: () => void
  onSpeak: (entry: VocabEntry) => void
}) {
  const ko = (v.definitionsKo ?? []).filter(Boolean)
  const isZh = v.lang === 'zh'
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span
            className={cn('text-lg font-semibold text-amber-300', isZh && 'zh')}
            lang={isZh ? 'zh-CN' : 'en'}
          >
            {v.word}
          </span>
          {v.pinyin && <span className="ml-2 text-sm text-zinc-400">{v.pinyin}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {multiLang && (
              <span className="rounded bg-zinc-800 px-1.5 py-px text-[10px] font-medium text-zinc-400">
                {isZh ? '中' : 'EN'}
              </span>
            )}
            {v.source && (
              <span
                className="max-w-44 truncate rounded bg-sky-500/10 px-1.5 py-px text-[10px] text-sky-300"
                title={v.source}
              >
                {v.source}
              </span>
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => onSpeak(v)}
            className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-amber-300"
            aria-label="발음 듣기"
            title="발음 듣기"
          >
            <Volume2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(v.id)}
            className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
            aria-label="삭제"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-1 text-sm text-zinc-100">{primaryDefs(v).join('; ')}</div>
      {ko.length > 0 && <div className="mt-0.5 text-xs text-zinc-500">{v.definitions.join('; ')}</div>}
      {v.context && (
        <div
          className={cn('mt-1.5 border-t border-zinc-800/70 pt-1.5 text-sm text-zinc-500', isZh && 'zh')}
          lang={isZh ? 'zh-CN' : 'en'}
        >
          {v.context}
        </div>
      )}
      {v.timestamp !== null && (
        <button
          disabled={!videoLoaded}
          onClick={() => {
            onSeek(v.timestamp as number)
            onClose()
          }}
          className="mt-1.5 inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 disabled:cursor-not-allowed disabled:text-zinc-600"
          title={videoLoaded ? '해당 장면으로 이동' : '영상을 불러오면 이동할 수 있습니다'}
        >
          <Play className="h-3 w-3" />
          {formatTime(v.timestamp)}
          {v.videoName ? ` · ${v.videoName}` : ''}
        </button>
      )}
    </div>
  )
}

export default function VocabNotebook({ open, onOpenChange, vocab, videoLoaded, onSeek, onDelete }: Props) {
  const [flash, setFlash] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)
  const sorted = useMemo(() => [...vocab].sort((a, b) => b.savedAt - a.savedAt), [vocab])

  /** distinct drama/episode sources with counts (uncategorized = '기타') */
  const sources = useMemo(() => {
    const counts = new Map<string, number>()
    for (const v of vocab) {
      const key = v.source ?? '기타'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [vocab])

  const multiLang = useMemo(() => new Set(vocab.map((v) => v.lang)).size > 1, [vocab])

  const filtered = useMemo(
    () => (sourceFilter ? sorted.filter((v) => (v.source ?? '기타') === sourceFilter) : sorted),
    [sorted, sourceFilter],
  )

  // TTS: speak an entry's word with a voice matching its language
  const [ttsMsg, setTtsMsg] = useState<string | null>(null)
  const ttsTimer = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (ttsTimer.current) window.clearTimeout(ttsTimer.current)
    }
  }, [])
  const speakEntry = useCallback((entry: VocabEntry) => {
    void speak(entry.word, entry.lang).then((ok) => {
      if (ok) return
      setTtsMsg('이 언어의 시스템 음성을 찾지 못했습니다.')
      if (ttsTimer.current) window.clearTimeout(ttsTimer.current)
      ttsTimer.current = window.setTimeout(() => setTtsMsg(null), 2500)
    })
  }, [])

  const chipCls = (active: boolean) =>
    cn(
      'max-w-40 truncate rounded-full border px-2.5 py-0.5 text-xs transition-colors',
      active
        ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
        : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300',
    )

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col border-zinc-800 bg-zinc-950 sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-zinc-100">
              <BookMarked className="h-5 w-5 text-amber-400" />
              단어장
              <span className="text-sm font-normal text-zinc-500">
                {sourceFilter ? `${filtered.length}/${vocab.length}개` : `${vocab.length}개`}
              </span>
            </SheetTitle>
          </SheetHeader>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              disabled={filtered.length === 0}
              onClick={() => setFlash(true)}
              className="flex-1 bg-amber-500 text-zinc-950 hover:bg-amber-400"
            >
              <RotateCw className="mr-1.5 h-4 w-4" /> 플래시카드 복습
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={filtered.length === 0}
              onClick={() => exportCsv(filtered)}
              className="flex-1 border-zinc-700"
              title={sourceFilter ? `'${sourceFilter}' 필터가 적용된 ${filtered.length}개 단어를 내보냅니다` : undefined}
            >
              <Download className="mr-1.5 h-4 w-4" /> CSV 내보내기 (Anki)
            </Button>
          </div>
          {ttsMsg && <p className="mt-2 text-xs text-zinc-500">{ttsMsg}</p>}
          {sources.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button onClick={() => setSourceFilter(null)} className={chipCls(sourceFilter === null)}>
                전체
              </button>
              {sources.map(([name, count]) => (
                <button
                  key={name}
                  onClick={() => setSourceFilter(name === sourceFilter ? null : name)}
                  className={chipCls(sourceFilter === name)}
                  title={name}
                >
                  {name} <span className="opacity-60">{count}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {sorted.length === 0 && (
              <p className="pt-8 text-center text-sm text-zinc-600">
                자막의 글자를 클릭해 단어를 저장해 보세요.
              </p>
            )}
            {sorted.length > 0 && filtered.length === 0 && (
              <p className="pt-8 text-center text-sm text-zinc-600">
                이 소스에 저장된 단어가 없습니다.
              </p>
            )}
            {filtered.map((v) => (
              <VocabRow
                key={v.id}
                v={v}
                multiLang={multiLang}
                videoLoaded={videoLoaded}
                onSeek={onSeek}
                onDelete={onDelete}
                onClose={() => onOpenChange(false)}
                onSpeak={speakEntry}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
      {flash && (
        <div className="relative z-[60]">
          <Flashcards vocab={filtered} onClose={() => setFlash(false)} onSpeak={speakEntry} ttsMsg={ttsMsg} />
        </div>
      )}
    </>
  )
}
