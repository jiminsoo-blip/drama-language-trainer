// Browser-side PDF text extraction with pdfjs-dist (Vite worker setup).
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Extract text lines from a text-based PDF. Lines are reconstructed using
 * pdfjs' hasEOL markers. Scanned/image PDFs yield no text (caller validates).
 */
export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data }).promise
  const lines: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    let line = ''
    for (const item of tc.items) {
      if (!('str' in item)) continue
      line += item.str
      if (item.hasEOL) {
        lines.push(line)
        line = ''
      }
    }
    if (line.trim()) lines.push(line)
  }
  void doc.cleanup()
  return lines.join('\n')
}
