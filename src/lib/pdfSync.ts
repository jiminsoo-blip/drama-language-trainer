import type { ScriptSentence } from '@/lib/pdfScript'

const OFFSET_PREFIX = 'cdt:pdfOffset:'

export function loadPdfOffset(fileName: string | undefined): number {
  if (!fileName) return 0
  try {
    const v = parseFloat(localStorage.getItem(OFFSET_PREFIX + fileName) ?? '0')
    return isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

export function savePdfOffset(fileName: string | undefined, offset: number): void {
  if (!fileName) return
  try {
    localStorage.setItem(OFFSET_PREFIX + fileName, String(offset))
  } catch {
    // ignore
  }
}

export type { ScriptSentence }
