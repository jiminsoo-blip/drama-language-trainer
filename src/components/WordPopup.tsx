import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BookMarked, Check, Loader2, Minus, Plus, Volume2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { loadDictionary, loadKoreanMap, lookupWord, type DictEntry } from '@/lib/dictionary'
import { loadEngKo, lookupEngKo } from '@/lib/engDict'
import { toPinyin } from '@/lib/chinese'
import { speak } from '@/lib/tts'
import { clamp } from '@/lib/time'
import { cn } from '@/lib/utils'

export interface PopupState {
  sentence: string // full line text the selection lives in
  charIndex: number // selection start (string index)
  length: number // selection length in chars (1–6)
  translation: string | null
  timestamp: number | null
  x: number // client coords of the clicked character
  y: number
  /** script language of the clicked text */
  lang: 'zh' | 'en'
  /** en mode: the clicked word itself (bypasses sentence slicing + dictionary) */
  enWord?: string
}

export const MAX_SELECT_LEN = 6

interface Props {
  popup: PopupState
  saved: boolean
  onResize: (delta: number) => void
  onSave: (defs: string[], dictPinyin: string | null, defsKo: string[] | null) => void
  onClose: () => void
}

const W = 340

export default function WordPopup({ popup, saved, onResize, onSave, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: popup.x, top: popup.y })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [main, setMain] = useState<DictEntry | null>(null)
  const [chars, setChars] = useState<DictEntry[]>([])
  const [enKo, setEnKo] = useState<string[] | null>(null)
  const [ttsMsg, setTtsMsg] = useState<string | null>(null)
  const ttsTimer = useRef<number | null>(null)

  const isEn = popup.lang === 'en'
  const word =
    isEn && popup.enWord
      ? popup.enWord
      : popup.sentence.slice(popup.charIndex, popup.charIndex + popup.length)
  const canDec = popup.length > 1
  const canInc =
    popup.length < MAX_SELECT_LEN && popup.charIndex + popup.length < popup.sentence.length

  // dictionary lookup (Chinese mode only) — bundled cedict + bundled Korean
  useEffect(() => {
    if (isEn) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([loadDictionary(), loadKoreanMap()])
      .then(([payload, koMap]) => {
        if (cancelled) return
        const { main, chars } = lookupWord(payload, word, koMap)
        setMain(main)
        setChars(chars)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '사전을 불러오지 못했습니다.')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isEn, word])

  // English mode: bundled eng_ko dictionary (offline)
  useEffect(() => {
    if (!isEn) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setEnKo(null)
    void loadEngKo().then((map) => {
      if (cancelled) return
      setEnKo(lookupEngKo(map, word))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [isEn, word])

  const dictPinyin = main?.pinyin ?? null
  const defs = useMemo(
    () => main?.definitions ?? chars.flatMap((c) => c.definitions).slice(0, 3),
    [main, chars],
  )
  /** bundled Korean, index-aligned with defs (word-level entries only) */
  const defsKoFinal = useMemo(() => main?.definitionsKo ?? null, [main])

  useLayoutEffect(() => {
    const el = ref.current
    const h = el?.offsetHeight ?? 260
    const left = clamp(popup.x - W / 2, 8, window.innerWidth - W - 8)
    let top = popup.y + 14
    if (top + h > window.innerHeight - 8) top = popup.y - h - 14
    setPos({ left, top: Math.max(8, top) })
  }, [popup])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // auto-hide the TTS notice; clear the timer on unmount
  useEffect(() => {
    return () => {
      if (ttsTimer.current) window.clearTimeout(ttsTimer.current)
    }
  }, [])

  const flashTtsMsg = (msg: string) => {
    setTtsMsg(msg)
    if (ttsTimer.current) window.clearTimeout(ttsTimer.current)
    ttsTimer.current = window.setTimeout(() => setTtsMsg(null), 2500)
  }

  // speak the current selection (respects the −/+ resized word)
  const handleSpeak = () => {
    void speak(word, popup.lang).then((ok) => {
      if (!ok) flashTtsMsg('이 언어의 시스템 음성을 찾지 못했습니다.')
    })
  }

  const handleSave = () => {
    if (isEn) onSave([word], null, enKo)
    else onSave(defs, dictPinyin, defsKoFinal)
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top, width: W }}
        className="fixed z-50 rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl shadow-black/60"
      >
        {/* header: selection + resize (resize buttons are zh-only) + TTS */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {!isEn && (
                <button
                  onClick={() => onResize(-1)}
                  disabled={!canDec}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                  aria-label="선택 줄이기"
                  title="한 글자 줄이기"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              )}
              <span
                className={cn('truncate text-2xl font-semibold text-amber-300', !isEn && 'zh')}
                lang={isEn ? 'en' : 'zh-CN'}
              >
                {word}
              </span>
              {!isEn && (
                <button
                  onClick={() => onResize(1)}
                  disabled={!canInc}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                  aria-label="선택 늘리기"
                  title="한 글자 늘리기"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={handleSpeak}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-amber-300"
                aria-label="발음 듣기"
                title="발음 듣기"
              >
                <Volume2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {!isEn && (
              <div className="mt-0.5 text-sm text-zinc-400">
                {dictPinyin ?? toPinyin(word)}
                <span className="ml-2 text-xs text-zinc-600">{popup.length}글자 선택</span>
              </div>
            )}
            {ttsMsg && <div className="mt-1 text-xs text-zinc-500">{ttsMsg}</div>}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* meanings */}
        <div className="mt-3 max-h-56 space-y-2 overflow-y-auto text-sm">
          {isEn ? (
            <>
              {loading && (
                <div className="flex items-center gap-2 text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> 사전 불러오는 중…
                </div>
              )}
              {!loading && (
                <>
                  {enKo ? (
                    <ul className="space-y-1">
                      {enKo.map((k, i) => (
                        <li key={i} className="text-base text-zinc-100">
                          {k}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-zinc-500">
                      사전에서 찾을 수 없습니다. 단어는 그래도 저장할 수 있습니다.
                    </div>
                  )}
                  <div className="text-xs text-zinc-500">{word}</div>
                </>
              )}
            </>
          ) : (
            <>
              {loading && (
                <div className="flex items-center gap-2 text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> 사전 불러오는 중…
                </div>
              )}
              {error && <div className="text-red-400">{error}</div>}
              {!loading && !error && (
                <>
                  {main || defs.length > 0 ? (
                    <ul className="space-y-1.5">
                      {defs.map((d, i) => (
                        <li key={i}>
                          {defsKoFinal?.[i] ? (
                            <>
                              <div className="text-zinc-100">{defsKoFinal[i]}</div>
                              <div className="text-xs text-zinc-500">{d}</div>
                            </>
                          ) : (
                            <div className="text-zinc-200">{d}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-zinc-500">사전에서 찾을 수 없습니다.</div>
                  )}
                  {chars.length > 0 && (
                    <div className="border-t border-zinc-800 pt-2">
                      {chars.map((c) => (
                        <div key={c.word} className="text-xs text-zinc-400">
                          <span className="zh text-sm text-zinc-300" lang="zh-CN">
                            {c.word}
                          </span>{' '}
                          <span>{c.pinyin}</span> —{' '}
                          {c.definitionsKo?.[0] ? (
                            <span className="text-zinc-300">{c.definitionsKo[0]}</span>
                          ) : (
                            c.definitions[0]
                          )}
                          {c.definitionsKo?.[0] && (
                            <span className="text-zinc-600"> ({c.definitions[0]})</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <Button
          size="sm"
          disabled={saved || loading}
          onClick={handleSave}
          className={
            saved
              ? 'mt-3 w-full bg-emerald-700 text-white hover:bg-emerald-700'
              : 'mt-3 w-full bg-amber-500 text-zinc-950 hover:bg-amber-400'
          }
        >
          {saved ? (
            <>
              <Check className="mr-1.5 h-4 w-4" /> 저장됨
            </>
          ) : (
            <>
              <BookMarked className="mr-1.5 h-4 w-4" /> 단어장 저장
            </>
          )}
        </Button>
      </div>
    </>
  )
}
