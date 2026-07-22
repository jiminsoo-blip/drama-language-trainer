import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ALargeSmall,
  ArrowDownToLine,
  ArrowUpToLine,
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Crosshair,
  FilePlus2,
  GraduationCap,
  Keyboard,
  PanelRight,
  Pause,
  Play,
  SlidersHorizontal,
  StepBack,
  StepForward,
  Tv,
  Volume2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import ChineseSentence from '@/components/ChineseSentence'
import EnglishSentence from '@/components/EnglishSentence'
import SeekBar from '@/components/SeekBar'
import ShortcutHelp from '@/components/ShortcutHelp'
import SubtitleList from '@/components/SubtitleList'
import VocabNotebook from '@/components/VocabNotebook'
import WordPopup, { type PopupState } from '@/components/WordPopup'
import { activeLineIndex, translationAt } from '@/lib/subtitles'
import { buildEstimatedLines, cumulativeFractions } from '@/lib/pdfScript'
import { loadDictionary, longestMatch } from '@/lib/dictionary'
import { loadPdfOffset, savePdfOffset } from '@/lib/pdfSync'
import {
  loadSyncAnchors,
  nudgeAnchors,
  offsetAtVideo,
  saveSyncAnchors,
  subtitleToVideo,
  upsertAnchor,
  type SyncAnchor,
} from '@/lib/syncAnchors'
import {
  loadDisplaySettings,
  loadViewSettings,
  saveDisplaySettings,
  saveViewSettings,
} from '@/lib/storage'
import { baseName, saveSession, sessionIdFor } from '@/lib/recentSessions'
import { toPinyin } from '@/lib/chinese'
import { speak } from '@/lib/tts'
import { formatTime, clamp } from '@/lib/time'
import { cn } from '@/lib/utils'
import { SPEED_OPTIONS } from '@/types'
import type { AppSettings, MediaBundle, SubtitleLine, ViewSettings, VocabEntry } from '@/types'

const SPEEDS = SPEED_OPTIONS
const OVERLAY_FONT: Record<ViewSettings['overlaySize'], string> = {
  sm: '0.95rem',
  md: '1.35rem',
  lg: '1.8rem',
}
const OVERLAY_LABEL: Record<ViewSettings['overlaySize'], string> = {
  sm: '작게',
  md: '보통',
  lg: '크게',
}

interface Props {
  media: MediaBundle
  settings: AppSettings
  onSettingsChange: (s: AppSettings) => void
  vocab: VocabEntry[]
  onAddVocab: (e: VocabEntry) => void
  onDeleteVocab: (id: string) => void
  onUpdateVocab: (id: string, patch: Partial<VocabEntry>) => void
  onReset: () => void
}

export default function StudyView({
  media,
  settings,
  onSettingsChange,
  vocab,
  onAddVocab,
  onDeleteVocab,
  onUpdateVocab,
  onReset,
}: Props) {
  const hasVideo = media.videoUrl !== null
  const lang = media.lang
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [videoIdx, setVideoIdx] = useState(-1)
  const [manualIdx, setManualIdx] = useState(0)
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [vocabOpen, setVocabOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // viewing mode + overlay prefs (persisted)
  const [view, setView] = useState<ViewSettings>(() => loadViewSettings())
  useEffect(() => saveViewSettings(view), [view])
  const watch = view.mode === 'watch' && hasVideo

  // sentence panel display prefs (persisted)
  const [display, setDisplay] = useState(() => loadDisplaySettings())
  useEffect(() => saveDisplaySettings(display), [display])

  // A-B range repeat (session state)
  const [abA, setAbA] = useState<number | null>(null)
  const [abB, setAbB] = useState<number | null>(null)
  const abActive = abA !== null && abB !== null && abB > abA

  /** suppress duplicate loop seeks while a programmatic seek is still landing */
  const loopCooldown = useRef(0)

  const { transSubs } = media
  const pdf = media.pdf
  const isPdf = pdf !== null
  const estimatedSync = isPdf && pdf.sync === 'estimated'

  // -- multi-anchor subtitle sync (ad-insertion correction) -------------------
  // Keyed by the same video-file identity used for recent sessions, so
  // anchors never leak across files. Applies to SRT subtitle mode only;
  // PDF modes keep their own (estimated/real) sync handling.
  const syncKey = sessionIdFor({
    videoName: media.videoName,
    subsName: media.subsName || null,
    pdfName: media.pdf?.fileName ?? null,
  })
  const syncEligible = hasVideo && !isPdf
  const [anchors, setAnchorsState] = useState<SyncAnchor[]>(() =>
    syncEligible ? loadSyncAnchors(syncKey) : [],
  )
  const [syncOpen, setSyncOpen] = useState(false)
  // line picked in the subtitle list for calibration (panel-open only)
  const [selectedSyncIdx, setSelectedSyncIdx] = useState(-1)

  // selection is meaningful only while calibrating; drop it when the panel
  // closes or another video is loaded
  useEffect(() => {
    if (!syncOpen) setSelectedSyncIdx(-1)
  }, [syncOpen])
  useEffect(() => setSelectedSyncIdx(-1), [syncKey])

  // reload anchors when a different video is loaded into the same view
  const syncKeyRef = useRef(syncKey)
  useEffect(() => {
    if (syncKeyRef.current === syncKey) return
    syncKeyRef.current = syncKey
    setAnchorsState(syncEligible ? loadSyncAnchors(syncKey) : [])
  }, [syncKey, syncEligible])

  const setAnchors = useCallback(
    (next: SyncAnchor[]) => {
      setAnchorsState(next)
      saveSyncAnchors(syncKey, next)
    },
    [syncKey],
  )

  const syncActive = syncEligible && anchors.length > 0

  // PDF estimated-sync offset (persisted per PDF file name)
  const [pdfOffset, setPdfOffsetState] = useState(() => loadPdfOffset(pdf?.fileName))
  const setPdfOffset = useCallback(
    (v: number) => {
      setPdfOffsetState(v)
      savePdfOffset(pdf?.fileName, v)
    },
    [pdf?.fileName],
  )

  // Lines used for timing. PDF without real timestamps: distribute sentence
  // starts proportionally to Chinese char counts + global offset.
  // SRT with sync anchors: warp original subtitle times into video time
  // (piecewise-linear through the anchors) — everything downstream
  // (active-line detection, seek, A-B, overlay) then works in video time.
  const lines = useMemo<SubtitleLine[]>(() => {
    if (estimatedSync && hasVideo && duration > 0 && pdf) {
      return buildEstimatedLines(pdf.sentences, duration, pdfOffset)
    }
    if (syncActive) {
      return media.subs.map((l) => {
        const start = subtitleToVideo(anchors, l.start)
        const end = subtitleToVideo(anchors, l.end)
        return { ...l, start, end: Math.max(end, start + 0.05) }
      })
    }
    return media.subs
  }, [estimatedSync, hasVideo, duration, pdf, pdfOffset, syncActive, anchors, media.subs])

  const baseFractions = useMemo(
    () => (pdf ? cumulativeFractions(pdf.sentences) : []),
    [pdf],
  )

  const activeIdx = hasVideo ? videoIdx : manualIdx
  const activeLine: SubtitleLine | null = activeIdx >= 0 ? lines[activeIdx] : null

  /** translation for a line index (PDF: aligned sentence; SRT: time match) */
  const translationForIdx = useCallback(
    (idx: number): string | null => {
      if (pdf) return pdf.sentences[idx]?.korean ?? null
      // look up in ORIGINAL subtitle time — the translation track shares the
      // unwarped timeline, so the sync warp must not leak into this lookup
      const orig = media.subs[idx]
      return orig ? translationAt(transSubs, orig.start + 0.01) : null
    },
    [pdf, media.subs, transSubs],
  )

  const set = useCallback(
    (patch: Partial<AppSettings>) => onSettingsChange({ ...settings, ...patch }),
    [settings, onSettingsChange],
  )

  // -- resume position --------------------------------------------------------

  const restoredRef = useRef(false)

  // no-video restore: jump the manual selection to the saved position's line
  useEffect(() => {
    if (hasVideo || restoredRef.current) return
    restoredRef.current = true
    if (media.initialPosition && media.initialPosition > 0 && !isPdf && lines.length > 0) {
      const idx = activeLineIndex(lines, media.initialPosition)
      if (idx >= 0) setManualIdx(idx)
    }
  }, [hasVideo, isPdf, lines, media.initialPosition])

  // -- session persistence ("이어서 학습하기") --------------------------------

  const persistSession = useCallback(
    (t: number, d: number) => {
      if (!hasVideo || !Number.isFinite(d) || d <= 0) return
      saveSession({
        id: sessionIdFor({
          videoName: media.videoName,
          subsName: media.subsName || null,
          pdfName: media.pdf?.fileName ?? null,
        }),
        videoName: media.videoName,
        subsName: media.subsName || null,
        transName: media.transName,
        pdfName: media.pdf?.fileName ?? null,
        lang: media.lang,
        position: t,
        duration: d,
        updatedAt: Date.now(),
      })
    },
    [hasVideo, media],
  )

  // save every >=5s of playback progress (driven by the timeupdate subscription)
  const lastSavedPos = useRef(-1)
  useEffect(() => {
    if (!hasVideo || duration <= 0) return
    if (lastSavedPos.current >= 0 && Math.abs(currentTime - lastSavedPos.current) < 5) return
    lastSavedPos.current = currentTime
    persistSession(currentTime, duration)
  }, [currentTime, duration, hasVideo, persistSession])

  // -- playback rate ---------------------------------------------------------
  // Browsers may reset playbackRate to defaultPlaybackRate when the media
  // (re)loads, so apply the rate on speed change, after metadata load, and on
  // every play event; also set defaultPlaybackRate so resets keep our speed.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.defaultPlaybackRate = settings.speed
    if (v.playbackRate !== settings.speed) v.playbackRate = settings.speed
  }, [settings.speed, media.videoUrl])

  // -- playback --------------------------------------------------------------

  const seekToLine = useCallback(
    (idx: number) => {
      const i = clamp(idx, 0, lines.length - 1)
      if (hasVideo && videoRef.current) {
        videoRef.current.currentTime = lines[i].start + 0.001
      } else {
        setManualIdx(i)
      }
    },
    [lines, hasVideo],
  )

  const goPrev = useCallback(() => {
    if (hasVideo && activeLine && currentTime - activeLine.start > 2) {
      seekToLine(activeIdx)
    } else {
      seekToLine(activeIdx - 1)
    }
  }, [hasVideo, activeLine, currentTime, activeIdx, seekToLine])

  const goNext = useCallback(() => seekToLine(activeIdx + 1), [activeIdx, seekToLine])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }, [])

  const seekTo = useCallback(
    (t: number) => {
      if (hasVideo && videoRef.current) {
        videoRef.current.currentTime = t
        void videoRef.current.play()
      }
    },
    [hasVideo],
  )

  const adjustSpeed = useCallback(
    (delta: number) => {
      const cur = SPEEDS.reduce(
        (best, s) => (Math.abs(s - settings.speed) < Math.abs(best - settings.speed) ? s : best),
        SPEEDS[0],
      )
      const i = clamp(SPEEDS.indexOf(cur) + delta, 0, SPEEDS.length - 1)
      set({ speed: SPEEDS[i] })
    },
    [settings.speed, set],
  )

  // -- A-B range repeat --------------------------------------------------------

  const setAHere = useCallback(() => {
    const t = currentTime
    setAbA(t)
    if (abB !== null && abB <= t + 0.2) setAbB(null)
  }, [currentTime, abB])

  const setBHere = useCallback(() => {
    const a = abA ?? 0
    if (abA === null) setAbA(0)
    setAbB(clamp(currentTime, a + 0.2, Math.max(duration, a + 0.2)))
  }, [abA, currentTime, duration])

  const clearAb = useCallback(() => {
    setAbA(null)
    setAbB(null)
  }, [])

  // -- timeupdate: UI state only (4 Hz is fine for display) -------------------

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const t = v.currentTime
    setCurrentTime(t)
    setVideoIdx(activeLineIndex(lines, t))
  }, [lines])

  // -- boundary-precise A-B loop on animation frames (60 Hz) ------------------
  // timeupdate fires only ~4 Hz, which lands past the end of short subtitle
  // lines. Checking on animation frames catches every B-point crossing; the
  // same tick also keeps the active-line highlight frame-accurate.
  useEffect(() => {
    if (!hasVideo) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const v = videoRef.current
      if (!v || v.paused || v.seeking) return
      const t = v.currentTime
      const now = performance.now()
      const idx = activeLineIndex(lines, t)
      setVideoIdx(idx) // React bails out when unchanged

      // A-B range loop (seeking far past B escapes the loop)
      if (abActive && abA !== null && abB !== null) {
        if (t >= abB - 0.02 && t <= abB + 1 && now - loopCooldown.current > 250) {
          loopCooldown.current = now
          v.currentTime = abA + 0.001
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [hasVideo, lines, abActive, abA, abB])

  // -- text-to-speech (sentence panel) ----------------------------------------

  const [ttsMsg, setTtsMsg] = useState<string | null>(null)
  const ttsTimer = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (ttsTimer.current) window.clearTimeout(ttsTimer.current)
    }
  }, [])

  const speakSentence = useCallback(async () => {
    if (!activeLine) return
    const ok = await speak(activeLine.text, lang)
    if (!ok) {
      setTtsMsg('이 언어의 시스템 음성을 찾지 못했습니다.')
      if (ttsTimer.current) window.clearTimeout(ttsTimer.current)
      ttsTimer.current = window.setTimeout(() => setTtsMsg(null), 2500)
    }
  }, [activeLine, lang])

  // -- word popup / vocab ---------------------------------------------------

  /**
   * Open the dictionary popup for a clicked character. Auto-selects the
   * longest dictionary match starting at that character (up to 6 chars).
   */
  const openPopupAt = useCallback(
    (sentence: string, charIndex: number, rect: DOMRect, line: SubtitleLine | null) => {
      const base: PopupState = {
        sentence,
        charIndex,
        length: 1,
        translation: line ? translationForIdx(line.id) : null,
        timestamp: hasVideo ? (line ? line.start : currentTime) : null,
        x: rect.left + rect.width / 2,
        y: rect.top,
        lang: 'zh',
      }
      setPopup(base)
      loadDictionary()
        .then((payload) => {
          const len = longestMatch(payload, sentence, charIndex, 6)
          setPopup((prev) =>
            prev && prev.sentence === sentence && prev.charIndex === charIndex
              ? { ...prev, length: len }
              : prev,
          )
        })
        .catch(() => {
          // dictionary unavailable — popup shows its own error state
        })
    },
    [currentTime, translationForIdx, hasVideo],
  )

  /** English mode: popup for a clicked word (no dictionary, en→ko translate) */
  const openEnPopup = useCallback(
    (word: string, rect: DOMRect, line: SubtitleLine | null) => {
      setPopup({
        sentence: line?.text ?? word,
        charIndex: 0,
        length: word.length,
        translation: line ? translationForIdx(line.id) : null,
        timestamp: hasVideo ? (line ? line.start : currentTime) : null,
        x: rect.left + rect.width / 2,
        y: rect.top,
        lang: 'en',
        enWord: word,
      })
    },
    [currentTime, translationForIdx, hasVideo],
  )

  const resizePopup = useCallback((delta: number) => {
    setPopup((prev) => {
      if (!prev) return prev
      const maxLen = Math.min(6, prev.sentence.length - prev.charIndex)
      const length = clamp(prev.length + delta, 1, maxLen)
      return { ...prev, length }
    })
  }, [])

  const popupWord = popup
    ? popup.lang === 'en' && popup.enWord
      ? popup.enWord
      : popup.sentence.slice(popup.charIndex, popup.charIndex + popup.length)
    : null

  const saveWord = useCallback(
    (defs: string[], dictPinyin: string | null, defsKo: string[] | null) => {
      if (!popup || !popupWord) return
      const isEn = popup.lang === 'en'
      onAddVocab({
        id: `${Date.now()}-${popupWord}`,
        word: popupWord,
        pinyin: isEn ? '' : (dictPinyin ?? toPinyin(popupWord)),
        definitions: defs,
        definitionsKo: defsKo,
        koVersion: 2,
        source: baseName(media.videoName ?? media.subsName ?? null) || null,
        lang: popup.lang,
        context: popup.sentence,
        translation: popup.translation,
        timestamp: popup.timestamp,
        videoName: media.videoName,
        savedAt: Date.now(),
      })
    },
    [popup, popupWord, onAddVocab, media.videoName, media.subsName],
  )

  const popupSaved = useMemo(
    () => (popupWord ? vocab.some((v) => v.word === popupWord) : false),
    [popupWord, vocab],
  )

  // -- keyboard shortcuts ---------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (popup) return // let popup handle its own keys
      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          goPrev()
          break
        case 'ArrowRight':
          e.preventDefault()
          goNext()
          break
        case 'ArrowUp':
          e.preventDefault()
          adjustSpeed(1)
          break
        case 'ArrowDown':
          e.preventDefault()
          adjustSpeed(-1)
          break
        case '[':
          if (hasVideo) setAHere()
          break
        case ']':
          if (hasVideo) setBHere()
          break
        case '\\':
          clearAb()
          break
        case '?':
          setHelpOpen((o) => !o)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    popup,
    hasVideo,
    togglePlay,
    goPrev,
    goNext,
    adjustSpeed,
    setAHere,
    setBHere,
    clearAb,
  ])

  // -- derived --------------------------------------------------------------

  const activeTranslation = useMemo(() => {
    if (activeIdx < 0) return null
    return translationForIdx(activeIdx)
  }, [activeIdx, translationForIdx])

  /** calibrate: make the active sentence start at the current video position */
  const calibrateHere = useCallback(() => {
    if (activeIdx < 0 || duration <= 0 || baseFractions.length === 0) return
    const baseStart = baseFractions[activeIdx] * duration
    setPdfOffset(clamp(currentTime - baseStart, -120, 120))
  }, [activeIdx, duration, baseFractions, currentTime, setPdfOffset])

  // -- sync anchor actions ----------------------------------------------------

  /** effective offset at the playhead right now (for the panel + chip) */
  const currentSyncOffset = syncActive ? offsetAtVideo(anchors, currentTime) : 0

  /** primary calibration gesture: pin the SELECTED line (fallback: the
   * time-based active line) to the playhead, then reveal the correction */
  const calibrateSyncHere = useCallback(() => {
    if (!syncEligible) return
    const calibIdx = selectedSyncIdx >= 0 ? selectedSyncIdx : activeIdx
    if (calibIdx < 0) return
    const orig = media.subs[calibIdx]
    if (!orig) return
    const anchor: SyncAnchor = { videoTime: currentTime, subtitleTime: orig.start }
    setAnchors(upsertAnchor(anchors, anchor))
    setSelectedSyncIdx(-1)
    // land on the anchor so the corrected active line immediately matches
    // what is on screen (no-op seek when already paused there)
    if (videoRef.current) videoRef.current.currentTime = anchor.videoTime
  }, [syncEligible, selectedSyncIdx, activeIdx, media.subs, anchors, currentTime, setAnchors])

  const nudgeSync = useCallback(
    (delta: number) => setAnchors(nudgeAnchors(anchors, delta)),
    [anchors, setAnchors],
  )

  const clearSync = useCallback(() => setAnchors([]), [setAnchors])

  const jumpToAnchor = useCallback((a: SyncAnchor) => {
    if (videoRef.current) videoRef.current.currentTime = a.videoTime
  }, [])

  const showPanel = !watch || view.panelOpen

  // -- render ---------------------------------------------------------------

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* header */}
      <header className="h-13 shrink-0 border-b border-zinc-800 px-4 py-2.5">
        <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Clapperboard className="h-5 w-5 shrink-0 text-amber-400" />
            <h1 className="hidden truncate text-base font-semibold tracking-tight sm:block">
              드라마로 배우는 외국어
            </h1>
            {lang === 'en' && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                영어 모드
              </span>
            )}
            {!hasVideo && (
              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">
                {isPdf ? '대본 읽기 모드' : '자막 학습 모드'}
              </span>
            )}
            {isPdf && hasVideo && pdf && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs',
                  pdf.sync === 'real'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-sky-500/15 text-sky-300',
                )}
              >
                {pdf.sync === 'real' ? '실제 싱크 적용됨' : 'PDF 대본 · 추정 싱크'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* view mode toggle */}
            {hasVideo && (
              <div className="flex rounded-lg border border-zinc-800 p-0.5">
                <button
                  onClick={() => setView((v) => ({ ...v, mode: 'study' }))}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                    !watch ? 'bg-amber-500 font-medium text-zinc-950' : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  <GraduationCap className="h-3.5 w-3.5" />
                  학습 모드
                </button>
                <button
                  onClick={() => setView((v) => ({ ...v, mode: 'watch' }))}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                    watch ? 'bg-amber-500 font-medium text-zinc-950' : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  <Tv className="h-3.5 w-3.5" />
                  시청 모드
                </button>
              </div>
            )}
            {watch && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView((v) => ({ ...v, panelOpen: !v.panelOpen }))}
                className={cn('text-zinc-300', view.panelOpen && 'text-amber-300')}
                aria-label="자막 패널"
              >
                <PanelRight className="mr-1 h-4 w-4" />
                자막 패널
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVocabOpen(true)}
              className="text-zinc-300 hover:text-amber-300"
            >
              <BookMarked className="mr-1.5 h-4 w-4" />
              단어장
              {vocab.length > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 text-xs text-amber-300">
                  {vocab.length}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHelpOpen(true)}
              className="text-zinc-300"
              aria-label="단축키 도움말"
            >
              <Keyboard className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="text-zinc-300"
              aria-label="새 파일 불러오기"
            >
              <FilePlus2 className="mr-1.5 h-4 w-4" /> 새 파일
            </Button>
          </div>
        </div>
      </header>

      {/* main */}
      <div
        className={cn(
          'mx-auto grid min-h-0 w-full max-w-[1600px] flex-1 grid-cols-1',
          showPanel ? 'lg:grid-cols-[minmax(0,1fr)_430px]' : 'lg:grid-cols-1',
        )}
      >
        {/* left column */}
        <div className="flex min-h-0 flex-col overflow-y-auto">
          {hasVideo ? (
            <div className="relative bg-black">
              <video
                ref={videoRef}
                src={media.videoUrl ?? undefined}
                className={cn(
                  'mx-auto w-full object-contain',
                  watch ? 'aspect-video max-h-[74vh]' : 'aspect-video max-h-[62vh]',
                )}
                onTimeUpdate={handleTimeUpdate}
                onPlay={(e) => {
                  setPlaying(true)
                  // re-apply rate on every play (some browsers reset on load)
                  if (e.currentTarget.playbackRate !== settings.speed) {
                    e.currentTarget.playbackRate = settings.speed
                  }
                }}
                onPause={() => {
                  setPlaying(false)
                  const v = videoRef.current
                  if (v) persistSession(v.currentTime, v.duration || duration)
                }}
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration)
                  e.currentTarget.defaultPlaybackRate = settings.speed
                  e.currentTarget.playbackRate = settings.speed
                  // one-time resume of the saved position
                  if (!restoredRef.current && media.initialPosition && media.initialPosition > 0.5) {
                    restoredRef.current = true
                    const d = e.currentTarget.duration
                    const target = Number.isFinite(d)
                      ? clamp(media.initialPosition, 0, Math.max(0, d - 0.5))
                      : media.initialPosition
                    e.currentTarget.currentTime = target
                    setCurrentTime(target)
                  }
                }}
                onClick={togglePlay}
              />
              {/* Korean subtitle overlay (watch mode) */}
              {watch && activeTranslation && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 px-8 text-center"
                  style={{ top: view.overlayPos === 'top' ? '14%' : '66%' }}
                >
                  <span
                    className="inline-block rounded-md bg-black/40 px-3 py-1.5 font-medium leading-snug text-white"
                    style={{
                      fontSize: OVERLAY_FONT[view.overlaySize],
                      textShadow:
                        '0 0 3px #000, 0 0 6px #000, 0 2px 3px #000, -1px 0 2px #000, 1px 0 2px #000',
                    }}
                  >
                    {activeTranslation}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center border-b border-zinc-800 bg-zinc-900/50 px-4 py-6 text-sm text-zinc-500">
              {isPdf
                ? '영상 없이 대본으로 학습 중입니다. 문장을 클릭해 선택하고, 단어를 눌러 사전을 확인하세요.'
                : '영상 없이 자막으로 학습 중입니다. 문장을 클릭해 선택하고, 단어를 눌러 사전을 확인하세요.'}
            </div>
          )}

          {/* playback controls */}
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
            {hasVideo ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={goPrev} aria-label="이전 문장 (←)">
                      <StepBack className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>이전 문장 (←)</TooltipContent>
                </Tooltip>
                <Button
                  size="icon"
                  onClick={togglePlay}
                  className="h-10 w-10 rounded-full bg-amber-500 text-zinc-950 hover:bg-amber-400"
                  aria-label="재생/일시정지 (Space)"
                >
                  {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={goNext} aria-label="다음 문장 (→)">
                      <StepForward className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>다음 문장 (→)</TooltipContent>
                </Tooltip>

                <Select
                  value={String(settings.speed)}
                  onValueChange={(v) => set({ speed: parseFloat(v) })}
                >
                  <SelectTrigger className="h-8 w-24 border-zinc-700 bg-zinc-900 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-700 bg-zinc-900">
                    {SPEEDS.map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s}x 속도
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="mx-1 h-5 w-px bg-zinc-800" />

                {/* A-B range repeat */}
                <div className="flex items-center gap-1 rounded-lg border border-zinc-800 p-0.5">
                  <span className="pl-1.5 text-xs text-zinc-500">구간</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={setAHere}
                        className={cn(
                          'rounded-md px-2 py-1 text-xs font-bold transition-colors',
                          abA !== null
                            ? 'bg-sky-500 text-zinc-950'
                            : 'text-sky-300 hover:bg-sky-950',
                        )}
                        aria-label="여기서 A ([)"
                      >
                        A
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>현재 위치를 A 지점으로 ([)</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={setBHere}
                        className={cn(
                          'rounded-md px-2 py-1 text-xs font-bold transition-colors',
                          abActive
                            ? 'bg-sky-500 text-zinc-950'
                            : 'text-sky-300 hover:bg-sky-950',
                        )}
                        aria-label="여기서 B (])"
                      >
                        B
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>현재 위치를 B 지점으로 — A→B 반복 시작 (])</TooltipContent>
                  </Tooltip>
                  {abA !== null && (
                    <button
                      onClick={clearAb}
                      className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                      aria-label="구간 해제 (\)"
                      title="구간 해제 (\)"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {abActive && abA !== null && abB !== null && (
                  <span className="font-mono text-[11px] text-sky-300 tabular-nums">
                    {formatTime(abA)}–{formatTime(abB)} 반복 중
                  </span>
                )}

                {/* subtitle sync (multi-anchor, ad-insertion correction) */}
                {syncEligible && (
                  <>
                    <div className="mx-1 h-5 w-px bg-zinc-800" />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSyncOpen((o) => !o)}
                          className={cn(
                            'text-zinc-300',
                            (syncOpen || syncActive) && 'text-sky-300',
                          )}
                          aria-label="자막 싱크 보정"
                        >
                          <SlidersHorizontal className="mr-1 h-4 w-4" />
                          싱크
                          {syncActive && (
                            <span className="ml-1 rounded-full bg-sky-500/20 px-1.5 text-[11px]">
                              {anchors.length}
                            </span>
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        자막 싱크 보정 — 광고 삽입 등으로 밀린 자막을 구간별로 맞춥니다
                      </TooltipContent>
                    </Tooltip>
                  </>
                )}

                {/* overlay options (watch mode) */}
                {watch && (
                  <>
                    <div className="mx-1 h-5 w-px bg-zinc-800" />
                    <span className="text-xs text-zinc-500">자막</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            setView((v) => ({
                              ...v,
                              overlayPos: v.overlayPos === 'top' ? 'bottom' : 'top',
                            }))
                          }
                          aria-label="자막 위치 전환"
                        >
                          {view.overlayPos === 'top' ? (
                            <ArrowUpToLine className="h-4 w-4" />
                          ) : (
                            <ArrowDownToLine className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>자막 위치 (위/아래)</TooltipContent>
                    </Tooltip>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setView((v) => ({
                          ...v,
                          overlaySize: v.overlaySize === 'sm' ? 'md' : v.overlaySize === 'md' ? 'lg' : 'sm',
                        }))
                      }
                      aria-label="자막 크기"
                    >
                      <ALargeSmall className="mr-1 h-4 w-4" />
                      {OVERLAY_LABEL[view.overlaySize]}
                    </Button>
                  </>
                )}

                <div className="ml-auto flex min-w-40 flex-1 items-center gap-2 pl-2">
                  <span className="font-mono text-xs text-zinc-500">{formatTime(currentTime)}</span>
                  <SeekBar
                    current={currentTime}
                    duration={duration}
                    a={abA}
                    b={abB}
                    onSeek={(t) => {
                      if (videoRef.current) videoRef.current.currentTime = t
                    }}
                    onChangeA={setAbA}
                    onChangeB={setAbB}
                  />
                  <span className="font-mono text-xs text-zinc-500">{formatTime(duration)}</span>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={goPrev}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> 이전 문장
                </Button>
                <Button size="sm" variant="ghost" onClick={goNext}>
                  다음 문장 <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
                <span className="ml-2 text-xs text-zinc-600">
                  {activeIdx + 1} / {lines.length}
                </span>
              </div>
            )}
          </div>

          {/* subtitle sync panel (multi-anchor; SRT subtitle mode only) */}
          {syncEligible && syncOpen && (
            <div className="flex flex-col gap-2 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-sky-300">자막 싱크</span>
                <span className="font-mono text-xs text-zinc-400 tabular-nums">
                  현재 오프셋 {currentSyncOffset >= 0 ? '+' : ''}
                  {currentSyncOffset.toFixed(1)}초
                </span>
                <div className="flex items-center gap-1 rounded-lg border border-zinc-800 p-0.5">
                  {[-1, -0.5, 0.5, 1].map((d) => (
                    <button
                      key={d}
                      onClick={() => nudgeSync(d)}
                      className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800"
                      title={`전체 싱크 ${d > 0 ? '+' : ''}${d}초`}
                    >
                      {d > 0 ? '+' : ''}
                      {d}s
                    </button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={calibrateSyncHere}
                  disabled={selectedSyncIdx < 0 && activeIdx < 0}
                  className="h-7 border-sky-800 text-xs text-sky-300 hover:bg-sky-950"
                  title="지금 화면의 대사가 현재 재생 위치에서 나오도록 앵커를 만듭니다"
                >
                  <Crosshair className="mr-1 h-3.5 w-3.5" />
                  {selectedSyncIdx >= 0
                    ? '선택한 대사를 지금 위치에 맞추기'
                    : '이 대사를 지금 위치에 맞추기'}
                </Button>
                {anchors.length > 0 && (
                  <button
                    onClick={clearSync}
                    className="text-[11px] text-zinc-500 underline decoration-zinc-700 transition-colors hover:text-zinc-300"
                  >
                    전체 초기화
                  </button>
                )}
              </div>
              {selectedSyncIdx >= 0 && media.subs[selectedSyncIdx] && (
                <div className="rounded-lg border border-sky-900/60 bg-sky-950/30 px-3 py-2">
                  <div className="mb-1 truncate text-xs text-sky-200">
                    선택한 문장: “{media.subs[selectedSyncIdx].text}”
                  </div>
                  <ol className="list-inside list-decimal space-y-0.5 text-[11px] leading-relaxed text-zinc-400">
                    <li>목록에서 화면에 보이는 문장을 클릭해 선택 ✓</li>
                    <li>영상을 그 문장이 실제로 나오는 순간에 일시정지</li>
                    <li>'선택한 대사를 지금 위치에 맞추기' 클릭</li>
                  </ol>
                </div>
              )}
              {selectedSyncIdx < 0 && (
                <p className="text-[11px] leading-relaxed text-zinc-600">
                  이 패널이 열린 동안 자막 목록 클릭은 이동 대신 선택이 됩니다. 화면에 보이는
                  문장을 목록에서 선택한 뒤, 그 문장이 실제로 나오는 순간에 일시정지하고
                  '지금 위치에 맞추기'를 누르세요. 각 앵커의 오프셋은 그 앵커 위치부터 다음
                  앵커 전까지 그대로 적용되므로, 새 앵커를 추가해도 앞서 맞춘 구간은 바뀌지
                  않습니다. 설정은 이 영상 파일에만 저장됩니다.
                </p>
              )}
              {anchors.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-zinc-600">앵커 {anchors.length}개:</span>
                  {[...anchors]
                    .sort((a, b) => a.videoTime - b.videoTime)
                    .map((a, i) => {
                      const o = a.videoTime - a.subtitleTime
                      return (
                        <span
                          key={`${a.videoTime}-${i}`}
                          className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950/60 py-0.5 pl-2 pr-1 font-mono text-[11px] text-zinc-400"
                        >
                          <button
                            onClick={() => jumpToAnchor(a)}
                            className="transition-colors hover:text-sky-300"
                            title="이 앵커 위치로 이동"
                          >
                            {formatTime(a.videoTime)} · {o >= 0 ? '+' : ''}
                            {o.toFixed(1)}s
                          </button>
                          <button
                            onClick={() =>
                              setAnchors(anchors.filter((x) => x !== a))
                            }
                            className="rounded-full p-0.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                            aria-label="앵커 삭제"
                            title="앵커 삭제"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      )
                    })}
                </div>
              )}
            </div>
          )}

          {/* PDF pairing mismatch notice */}
          {pdf && pdf.countMismatch && (
            <div className="border-b border-amber-900/50 bg-amber-950/30 px-4 py-1.5 text-xs text-amber-300">
              문장 수 불일치 — PDF {pdf.pdfCount}개 / 자막 {pdf.transCount}줄. 짧은 쪽{' '}
              {Math.min(pdf.pdfCount, pdf.transCount)}개까지 매칭했습니다.
            </div>
          )}

          {/* PDF sync adjustment (estimated timestamps only) */}
          {estimatedSync && hasVideo && showPanel && (
            <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2">
              <span className="text-xs font-medium text-sky-300">PDF 싱크 (추정)</span>
              <span className="font-mono text-xs text-zinc-400 tabular-nums">
                오프셋 {pdfOffset >= 0 ? '+' : ''}
                {pdfOffset.toFixed(1)}s
              </span>
              <Slider
                value={[pdfOffset]}
                min={-120}
                max={120}
                step={0.5}
                onValueChange={([v]) => setPdfOffset(v)}
                className="w-44"
                aria-label="싱크 오프셋"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={calibrateHere}
                disabled={activeIdx < 0}
                className="h-7 border-sky-800 text-xs text-sky-300 hover:bg-sky-950"
                title="현재 재생 위치가 이 문장의 시작이 되도록 오프셋을 맞춥니다"
              >
                <Crosshair className="mr-1 h-3.5 w-3.5" />
                현재 재생 위치를 이 문장의 시작으로
              </Button>
              <span className="text-[11px] text-zinc-600">
                문장 길이 비례 추정 싱크 · 오프셋은 파일별로 저장됩니다
              </span>
            </div>
          )}

          {/* current sentence */}
          {showPanel && (
            <div className="px-4 py-5">
              {/* display controls */}
              <div className="mb-3 flex items-center gap-2">
                {lang === 'zh' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDisplay((d) => ({ ...d, pinyinOn: !d.pinyinOn }))}
                    className={cn(
                      'h-7 px-2 text-xs',
                      display.pinyinOn ? 'text-amber-300' : 'text-zinc-500',
                    )}
                    aria-label="병음 표시 전환"
                  >
                    병음 {display.pinyinOn ? 'ON' : 'OFF'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDisplay((d) => ({
                      ...d,
                      fontSize: d.fontSize === 'md' ? 'lg' : d.fontSize === 'lg' ? 'xl' : 'md',
                    }))
                  }
                  className="h-7 px-2 text-xs text-zinc-400"
                  aria-label="글자 크기"
                >
                  <ALargeSmall className="mr-1 h-3.5 w-3.5" />
                  {display.fontSize === 'md' ? '보통' : display.fontSize === 'lg' ? '크게' : '아주 크게'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void speakSentence()}
                  disabled={!activeLine}
                  className="h-7 px-2 text-xs text-zinc-400 hover:text-amber-300"
                  aria-label="현재 문장 발음 듣기"
                  title="현재 문장 발음 듣기"
                >
                  <Volume2 className="mr-1 h-3.5 w-3.5" />
                  발음
                </Button>
                {ttsMsg && <span className="text-xs text-zinc-500">{ttsMsg}</span>}
              </div>
              {activeLine ? (
                lang === 'en' ? (
                  <EnglishSentence
                    text={activeLine.text}
                    translation={activeTranslation}
                    fontSize={display.fontSize}
                    onWordClick={(word, rect) => openEnPopup(word, rect, activeLine)}
                  />
                ) : (
                  <ChineseSentence
                    text={activeLine.text}
                    translation={activeTranslation}
                    fontSize={display.fontSize}
                    pinyinOn={display.pinyinOn}
                    onCharClick={(charIndex, rect) => openPopupAt(activeLine.text, charIndex, rect, activeLine)}
                  />
                )
              ) : (
                <p className="text-sm text-zinc-600">
                  {hasVideo ? '영상을 재생하면 현재 문장이 표시됩니다.' : '자막 목록에서 문장을 선택하세요.'}
                </p>
              )}
            </div>
          )}
        </div>

        {/* right column: subtitle list */}
        {showPanel && (
          <div className="min-h-0 border-t border-zinc-800 lg:border-l lg:border-t-0">
            <SubtitleList
              lines={lines}
              activeIndex={activeIdx}
              labelMode={estimatedSync && (!hasVideo || duration <= 0) ? 'index' : 'time'}
              lang={lang}
              syncLabel={
                syncActive && Math.abs(currentSyncOffset) >= 0.05
                  ? `싱크 ${currentSyncOffset >= 0 ? '+' : ''}${currentSyncOffset.toFixed(1)}초`
                  : null
              }
              selectedIndex={syncEligible && syncOpen ? selectedSyncIdx : -1}
              onLineClick={(i) => {
                // while the sync panel is open, list clicks SELECT a line
                // for calibration instead of seeking
                if (syncEligible && syncOpen) {
                  setSelectedSyncIdx((prev) => (prev === i ? -1 : i))
                } else {
                  seekToLine(i)
                }
              }}
              onCharClick={(line, charIndex, rect) => openPopupAt(line.text, charIndex, rect, line)}
              onWordClick={(line, word, rect) => openEnPopup(word, rect, line)}
            />
          </div>
        )}
      </div>

      {/* overlays */}
      {popup && (
        <WordPopup
          popup={popup}
          saved={popupSaved}
          onResize={resizePopup}
          onSave={saveWord}
          onClose={() => setPopup(null)}
        />
      )}
      <VocabNotebook
        open={vocabOpen}
        onOpenChange={setVocabOpen}
        vocab={vocab}
        videoLoaded={hasVideo}
        onSeek={seekTo}
        onDelete={onDeleteVocab}
        onUpdate={onUpdateVocab}
      />
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
