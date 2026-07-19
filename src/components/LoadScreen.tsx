import { useCallback, useRef, useState } from 'react'
import { Clapperboard, History, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { detectScriptLang, parseSubtitleFile } from '@/lib/subtitles'
import { parseScriptText } from '@/lib/pdfScript'
import { deleteSession, listSessions, sessionIdFor } from '@/lib/recentSessions'
import {
  ensureReadPermission,
  hasFileSystemAccess,
  loadHandles,
  saveHandles,
  type StoredHandles,
} from '@/lib/fileHandles'
import { formatTime } from '@/lib/time'
import type { MediaBundle, RecentSession, SubtitleLine } from '@/types'

type SlotKey = 'video' | 'subs' | 'trans' | 'pdf'
type PickedFiles = Record<SlotKey, File | null>

interface SlotProps {
  icon: React.ReactNode
  title: string
  desc: string
  accept: string
  fileName: string | null
  required?: boolean
  disabled?: boolean
  onFile: (f: File, handle: FileSystemFileHandle | null) => void
}

function DropSlot({ icon, title, desc, accept, fileName, required, disabled, onFile }: SlotProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // Prefer the File System Access API so the handle can be persisted for
  // one-click session resume; fall back to a plain <input type=file>.
  const pick = async () => {
    if (disabled) return
    if (hasFileSystemAccess()) {
      try {
        const picker = (
          window as unknown as {
            showOpenFilePicker: (o: { multiple: boolean }) => Promise<FileSystemFileHandle[]>
          }
        ).showOpenFilePicker
        const [handle] = await picker({ multiple: false })
        const file = await handle.getFile()
        onFile(file, handle)
      } catch {
        // user cancelled the picker — nothing to do
      }
      return
    }
    inputRef.current?.click()
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => void pick()}
      onKeyDown={(e) => e.key === 'Enter' && void pick()}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (disabled) return
        const f = e.dataTransfer.files?.[0]
        if (!f) return
        // best effort: capture a FileSystemFileHandle from the drop item
        const item = e.dataTransfer.items?.[0] as
          | (DataTransferItem & {
              getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
            })
          | undefined
        if (item && typeof item.getAsFileSystemHandle === 'function') {
          item
            .getAsFileSystemHandle()
            .then((h) => onFile(f, h && h.kind === 'file' ? (h as FileSystemFileHandle) : null))
            .catch(() => onFile(f, null))
        } else {
          onFile(f, null)
        }
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-all',
        disabled && 'cursor-not-allowed opacity-40',
        dragOver
          ? 'border-amber-400 bg-amber-400/10'
          : fileName
            ? 'border-emerald-500/60 bg-emerald-500/5'
            : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-600 hover:bg-zinc-900',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f, null)
          e.target.value = ''
        }}
      />
      <div className={cn('transition-opacity', fileName ? 'opacity-100' : 'opacity-70')}>{icon}</div>
      <div className="text-sm font-medium text-zinc-200">
        {title}
        {required && <span className="ml-1 text-amber-400">*</span>}
      </div>
      {fileName ? (
        <div className="max-w-full truncate text-xs text-emerald-300">{fileName}</div>
      ) : (
        <div className="text-xs leading-relaxed text-zinc-500">{desc}</div>
      )}
    </div>
  )
}

const readText = (f: File) =>
  f.arrayBuffer().then((buf) => new TextDecoder('utf-8', { fatal: false }).decode(buf))

/**
 * Parse the picked files into a MediaBundle. Throws with a Korean message on
 * any parse failure (caller surfaces it as an error banner).
 *
 * The PDF branch is kept intact: PDF uploads are no longer offered on the
 * load screen, but sessions recorded with a PDF script can still be resumed
 * from "최근 학습" via their persisted file handles.
 */
async function buildBundle(files: PickedFiles, initialPosition: number | null): Promise<MediaBundle> {
  const { video: videoFile, subs: subsFile, trans: transFile, pdf: pdfFile } = files
  let subs: SubtitleLine[] = []
  let transSubs: SubtitleLine[] = []
  let subsName = ''
  let transName: string | null = null
  let pdf: MediaBundle['pdf'] = null
  let lang: 'zh' | 'en' = 'zh'

  if (pdfFile) {
    const buf = await pdfFile.arrayBuffer()
    const { extractPdfText } = await import('@/lib/pdfExtract')
    const text = await extractPdfText(buf)
    const sentences = parseScriptText(text)
    if (sentences.length === 0) {
      throw new Error(
        'PDF에서 대본을 찾지 못했습니다. 텍스트 기반 PDF인지 확인해 주세요. (스캔/이미지 PDF는 지원하지 않습니다)',
      )
    }
    // optional: real-timestamped translation subtitle paired by line order
    let sync: 'estimated' | 'real' = 'estimated'
    let mismatch = false
    let transCount = 0
    if (transFile) {
      const t = await readText(transFile)
      const timed = parseSubtitleFile(transFile.name, t)
      if (timed.length === 0) {
        throw new Error(`번역 자막을 파싱할 수 없습니다: ${transFile.name}`)
      }
      sync = 'real'
      mismatch = timed.length !== sentences.length
      transCount = timed.length
      const n = Math.min(timed.length, sentences.length)
      // pair by index: real timestamps + PDF Chinese text / PDF Korean text
      transSubs = timed.slice(0, n).map((l, i) => ({ ...l, id: i }))
      subs = timed.slice(0, n).map((l, i) => ({ id: i, start: l.start, end: l.end, text: sentences[i].chinese }))
      transName = transFile.name
    } else {
      subs = sentences.map((s) => ({ id: s.id, start: 0, end: 0, text: s.chinese }))
      transSubs = sentences.map((s) => ({ id: s.id, start: 0, end: 0, text: s.korean }))
    }
    pdf = {
      fileName: pdfFile.name,
      sentences,
      sync,
      countMismatch: mismatch,
      pdfCount: sentences.length,
      transCount,
    }
    subsName = pdfFile.name
    if (!transName) transName = pdfFile.name
    lang = 'zh' // PDF scripts are Chinese+Korean by design
  } else if (subsFile) {
    const subsText = await readText(subsFile)
    subs = parseSubtitleFile(subsFile.name, subsText)
    if (subs.length === 0) {
      throw new Error(
        `자막을 파싱할 수 없습니다: ${subsFile.name} — SRT / VTT / ASS 형식인지 확인해 주세요.`,
      )
    }
    subsName = subsFile.name
    lang = detectScriptLang(subs)
    if (transFile) {
      const t = await readText(transFile)
      transSubs = parseSubtitleFile(transFile.name, t)
      if (transSubs.length === 0) {
        throw new Error(`번역 자막을 파싱할 수 없습니다: ${transFile.name}`)
      }
      transName = transFile.name
    }
  } else {
    throw new Error('원어자막 파일이 필요합니다.')
  }

  return {
    videoUrl: videoFile ? URL.createObjectURL(videoFile) : null,
    videoName: videoFile?.name ?? null,
    subs,
    subsName,
    transSubs,
    transName,
    pdf,
    lang,
    initialPosition,
  }
}

interface Props {
  onReady: (bundle: MediaBundle) => void
}

export default function LoadScreen({ onReady }: Props) {
  const [files, setFiles] = useState<PickedFiles>({ video: null, subs: null, trans: null, pdf: null })
  const handlesRef = useRef<StoredHandles>({})
  const [sessions, setSessions] = useState<RecentSession[]>(() => listSessions())
  const [pendingRestore, setPendingRestore] = useState<RecentSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { video: videoFile, subs: subsFile } = files

  const setSlot = (key: SlotKey) => (f: File, handle: FileSystemFileHandle | null) => {
    setFiles((prev) => ({ ...prev, [key]: f }))
    if (handle) handlesRef.current[key] = handle
    else delete handlesRef.current[key]
    setError(null)
  }

  const start = useCallback(async () => {
    if (!subsFile) {
      setError('원어자막 파일이 필요합니다.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const bundle = await buildBundle(files, pendingRestore?.position ?? null)
      // persist file handles so the next visit can resume with one click
      const id = sessionIdFor({
        videoName: bundle.videoName,
        subsName: bundle.subsName,
        pdfName: bundle.pdf?.fileName ?? null,
      })
      void saveHandles(id, handlesRef.current)
      onReady(bundle)
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 읽는 중 오류가 발생했습니다.')
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, subsFile, pendingRestore, onReady])

  /** one-click resume: reopen files from persisted handles + jump to position */
  const restoreSession = useCallback(
    async (s: RecentSession) => {
      if (busy) return
      setBusy(true)
      setError(null)
      try {
        const handles = await loadHandles(s.id)
        const got: PickedFiles = { video: null, subs: null, trans: null, pdf: null }
        let any = false
        if (handles) {
          for (const key of ['video', 'subs', 'trans', 'pdf'] as const) {
            const h = handles[key]
            if (!h) continue
            if (!(await ensureReadPermission(h))) continue
            try {
              got[key] = await h.getFile()
              any = true
            } catch {
              // file moved or deleted — treat as missing
            }
          }
        }
        // require the script source this session was built from
        const hasScript = s.pdfName ? got.pdf !== null : got.subs !== null
        if (!any || !hasScript) {
          // fall back to manual re-pick; the position is kept in pendingRestore
          setPendingRestore(s)
          setBusy(false)
          return
        }
        const bundle = await buildBundle(got, s.position)
        onReady(bundle)
      } catch (e) {
        setError(e instanceof Error ? e.message : '이전 세션을 여는 중 오류가 발생했습니다.')
        setBusy(false)
      }
    },
    [busy, onReady],
  )

  const removeSession = (id: string) => {
    deleteSession(id)
    setSessions(listSessions())
  }

  const canStart = !!subsFile && !busy

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,#1c1917_0%,#09090b_60%)] p-4 py-10">
      <div className="w-full max-w-3xl">
        {/* hero */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-b from-amber-400/20 to-amber-400/5 ring-1 ring-amber-400/30">
            <Clapperboard className="h-8 w-8 text-amber-400" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-50">
            드라마로 배우는 외국어
          </h1>
          <p className="mt-2.5 text-[15px] text-zinc-400">
            좋아하는 드라마로 어떤 언어든 생생하게.
          </p>
          <p className="mt-1.5 text-xs text-zinc-600">
            자막을 따라 읽고 · 단어를 저장하고 · 플래시카드로 복습하세요 — 모든 파일은 브라우저
            안에서만 처리됩니다.
          </p>
        </div>

        <Card className="border-zinc-800 bg-zinc-950/80 shadow-2xl">
          <CardContent className="flex flex-col gap-5 pt-6">
            {sessions.length > 0 && (
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3.5">
                <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-medium text-zinc-400">
                  <History className="h-3.5 w-3.5 text-amber-400/80" />
                  최근 학습 — 클릭하면 이어서 학습합니다
                </div>
                <div className="max-h-44 space-y-0.5 overflow-y-auto">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-1 rounded-xl transition-colors hover:bg-zinc-800/60"
                    >
                      <button
                        onClick={() => void restoreSession(s)}
                        disabled={busy}
                        className="min-w-0 flex-1 px-2.5 py-2 text-left disabled:opacity-50"
                      >
                        <div className="truncate text-sm text-zinc-200">{s.id}</div>
                        <div className="text-[11px] text-zinc-500">
                          {s.lang === 'en' ? '영어' : '중국어'} · {formatTime(s.position)}
                          {s.duration > 0 ? ` / ${formatTime(s.duration)}` : ''} ·{' '}
                          {new Date(s.updatedAt).toLocaleDateString('ko-KR', {
                            month: 'numeric',
                            day: 'numeric',
                          })}
                        </div>
                      </button>
                      <button
                        onClick={() => removeSession(s.id)}
                        className="mr-1.5 rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
                        aria-label="기록 삭제"
                        title="기록 삭제"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="flex flex-col gap-4">
              <div className="px-1 text-xs font-medium tracking-wide text-zinc-500">
                파일 불러오기
              </div>
              <DropSlot
                icon={<span className="text-3xl">🎬</span>}
                title="영상 파일"
                desc="mp4 · webm · mkv (브라우저 코덱 지원 필요) — 없어도 자막 학습 가능"
                accept="video/mp4,video/webm,video/x-matroska,.mkv,.mp4,.webm,.mov"
                fileName={videoFile?.name ?? null}
                onFile={setSlot('video')}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DropSlot
                  icon={<span className="text-3xl">💬</span>}
                  title="원어자막"
                  desc=".srt · .vtt · .ass · .ssa — 언어는 자동 감지"
                  accept=".srt,.vtt,.ass,.ssa"
                  fileName={files.subs?.name ?? null}
                  required
                  onFile={setSlot('subs')}
                />
                <DropSlot
                  icon={<span className="text-3xl">🌍</span>}
                  title="번역자막 (선택)"
                  desc="한국어 등 어떤 언어든 가능"
                  accept=".srt,.vtt,.ass,.ssa"
                  fileName={files.trans?.name ?? null}
                  onFile={setSlot('trans')}
                />
              </div>
            </section>

            {pendingRestore && (
              <div className="flex items-start justify-between gap-2 rounded-xl border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
                <span>
                  '{pendingRestore.id}'의 저장된 파일 핸들이 없거나 파일을 찾을 수 없어 자동으로
                  열지 못했습니다. 같은 파일을 다시 선택한 뒤 학습을 시작하면{' '}
                  <span className="font-mono">{formatTime(pendingRestore.position)}</span>부터
                  이어서 재생합니다.
                </span>
                <button
                  onClick={() => setPendingRestore(null)}
                  className="shrink-0 rounded p-0.5 text-amber-500 hover:bg-amber-900/40"
                  aria-label="이어하기 취소"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {error && (
              <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <Button
              size="lg"
              disabled={!canStart}
              onClick={start}
              className="w-full bg-amber-500 text-base font-semibold text-zinc-950 hover:bg-amber-400"
            >
              <Upload className="mr-2 h-4 w-4" />
              {busy ? '자막 분석 중…' : videoFile ? '학습 시작' : '자막만으로 학습 시작'}
            </Button>
            <details className="group rounded-xl border border-zinc-800 bg-zinc-900/40 px-3.5 py-2.5 text-xs text-zinc-500">
              <summary className="cursor-pointer list-none text-center text-zinc-500 transition-colors hover:text-zinc-300">
                정보 · 출처 · 개인정보
              </summary>
              <div className="mt-2.5 space-y-2 leading-relaxed">
                <p>
                  드라마 영상과 자막은 사용자가 직접 준비하며, 어떤 파일도 서버에 업로드되지
                  않고 브라우저 안에서만 처리됩니다. 학습 기록·단어장은 이 브라우저의 로컬
                  저장소에만 저장됩니다.
                </p>
                <p>이 앱은 아래 오픈 데이터를 내장하여 완전히 오프라인으로 동작합니다.</p>
                <ul className="list-inside list-disc space-y-1 text-zinc-400">
                  <li>
                    CC-CEDICT — 중·영 사전 (© MDBG,{' '}
                    <a
                      href="https://creativecommons.org/licenses/by-sa/4.0/"
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-zinc-600 hover:text-amber-300"
                    >
                      CC BY-SA 4.0
                    </a>
                    )
                  </li>
                  <li>
                    한국어 위키낱말사전 한자어 데이터 (kaikki.org 가공본,{' '}
                    <a
                      href="https://creativecommons.org/licenses/by-sa/3.0/"
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-zinc-600 hover:text-amber-300"
                    >
                      CC BY-SA 3.0
                    </a>
                    )
                  </li>
                  <li>
                    kengdic — 영·한 사전 (© kengdic 프로젝트, MPL 2.0 / LGPL 2.0+)
                  </li>
                  <li>Argos Translate — 오프라인 기계번역 (en→ko 모델)</li>
                </ul>
              </div>
            </details>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
