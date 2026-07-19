import type { AppSettings, ViewSettings, VocabEntry } from '@/types'
import { DEFAULT_SETTINGS, DEFAULT_VIEW_SETTINGS, SPEED_OPTIONS } from '@/types'

const VOCAB_KEY = 'cdt:vocab'
const SETTINGS_KEY = 'cdt:settings'
const VIEW_KEY = 'cdt:view'

export function loadVocab(): VocabEntry[] {
  try {
    const raw = localStorage.getItem(VOCAB_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // backfill fields added later (source / lang) for entries saved by older versions
    return (parsed as VocabEntry[]).map((v) => ({
      ...v,
      source: v.source ?? null,
      lang: v.lang ?? 'zh',
    }))
  } catch {
    return []
  }
}

export function saveVocab(entries: VocabEntry[]): void {
  try {
    localStorage.setItem(VOCAB_KEY, JSON.stringify(entries))
  } catch {
    // storage full / unavailable — ignore
  }
}

/** snap a (possibly stale) persisted speed to the nearest selectable option */
function nearestSpeed(v: number): number {
  let best: number = SPEED_OPTIONS[0]
  for (const s of SPEED_OPTIONS) {
    if (Math.abs(s - v) < Math.abs(best - v)) best = s
  }
  return best
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    // pick only known keys so stale keys from removed features are dropped;
    // migrate old speed values (0.5x/1.25x/1.5x era) to the nearest option
    return {
      ...DEFAULT_SETTINGS,
      speed: typeof parsed.speed === 'number' ? nearestSpeed(parsed.speed) : DEFAULT_SETTINGS.speed,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // ignore
  }
}

export function loadViewSettings(): ViewSettings {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    if (!raw) return DEFAULT_VIEW_SETTINGS
    return { ...DEFAULT_VIEW_SETTINGS, ...(JSON.parse(raw) as Partial<ViewSettings>) }
  } catch {
    return DEFAULT_VIEW_SETTINGS
  }
}

export function saveViewSettings(settings: ViewSettings): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(settings))
  } catch {
    // ignore
  }
}

const DISPLAY_KEY = 'cdt:display'

export interface DisplaySettings {
  fontSize: 'md' | 'lg' | 'xl' // 보통 / 크게 / 아주 크게
  pinyinOn: boolean
}

export const DEFAULT_DISPLAY: DisplaySettings = { fontSize: 'lg', pinyinOn: true }

export function loadDisplaySettings(): DisplaySettings {
  try {
    const raw = localStorage.getItem(DISPLAY_KEY)
    if (!raw) return DEFAULT_DISPLAY
    return { ...DEFAULT_DISPLAY, ...(JSON.parse(raw) as Partial<DisplaySettings>) }
  } catch {
    return DEFAULT_DISPLAY
  }
}

export function saveDisplaySettings(settings: DisplaySettings): void {
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(settings))
  } catch {
    // ignore
  }
}
