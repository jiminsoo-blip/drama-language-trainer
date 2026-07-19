export interface SubtitleLine {
  id: number
  start: number // seconds
  end: number // seconds
  text: string
}

export interface VocabEntry {
  id: string
  word: string
  pinyin: string
  definitions: string[]
  /** Korean translations of definitions (filled lazily); index-aligned */
  definitionsKo: string[] | null
  /** gloss pipeline version (2 = word-context machine translation) */
  koVersion?: number
  /** source drama/episode (file base name), e.g. "누나의 첫사랑E1" */
  source: string | null
  /** script language */
  lang: 'zh' | 'en'
  context: string
  translation: string | null
  timestamp: number | null // seconds into the video
  videoName: string | null
  savedAt: number
}

export interface AppSettings {
  speed: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  speed: 1,
}

/** selectable playback speeds (ascending); stored values migrate to the nearest option */
export const SPEED_OPTIONS: readonly number[] = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]

export interface PdfScript {
  fileName: string
  sentences: { id: number; chinese: string; korean: string }[]
  /** 'real' = paired with a timestamped translation subtitle; 'estimated' = char-count proportional */
  sync: 'estimated' | 'real'
  /** true when the translation line count differed from the PDF sentence count */
  countMismatch: boolean
  pdfCount: number
  transCount: number
}

export type ViewMode = 'study' | 'watch'

export interface ViewSettings {
  mode: ViewMode
  overlayPos: 'top' | 'bottom' // 위 / 아래 (above burned-in subs)
  overlaySize: 'sm' | 'md' | 'lg' // 작게 / 보통 / 크게
  panelOpen: boolean // subtitle/sentence panel in watch mode
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  mode: 'study',
  overlayPos: 'bottom',
  overlaySize: 'md',
  panelOpen: false,
}

export interface MediaBundle {
  videoUrl: string | null
  videoName: string | null
  subs: SubtitleLine[]
  subsName: string
  transSubs: SubtitleLine[]
  transName: string | null
  /** dual-language PDF script; when present it replaces both subtitle slots */
  pdf: PdfScript | null
  /** script language (PDF is always zh; subtitle files auto-detected) */
  lang: 'zh' | 'en'
  /** resume position in seconds (from a recent session), applied once on load */
  initialPosition: number | null
}

export interface RecentSession {
  /** video file name, or subtitle/PDF name when no video */
  id: string
  videoName: string | null
  subsName: string | null
  transName: string | null
  pdfName: string | null
  lang: 'zh' | 'en'
  position: number
  duration: number
  updatedAt: number
}
