// Text-to-speech via the Web Speech API (speechSynthesis).
// Picks a system voice matching the script language; resolves false when no
// suitable voice exists so callers can show a small notice.

type SpeakLang = 'zh' | 'en'

function normLang(l: string): string {
  return l.toLowerCase().replace('_', '-')
}

/** getVoices() is often empty on the first call — wait for voiceschanged once */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([])
  const now = speechSynthesis.getVoices()
  if (now.length > 0) return Promise.resolve(now)
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(speechSynthesis.getVoices()), 600)
    speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        window.clearTimeout(timer)
        resolve(speechSynthesis.getVoices())
      },
      { once: true },
    )
  })
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: SpeakLang): SpeechSynthesisVoice | null {
  if (lang === 'zh') {
    return (
      voices.find((v) => {
        const l = normLang(v.lang)
        return l.startsWith('zh-cn') || l.startsWith('zh-hans')
      }) ?? voices.find((v) => normLang(v.lang).startsWith('zh')) ?? null
    )
  }
  return (
    voices.find((v) => normLang(v.lang).startsWith('en-us')) ??
    voices.find((v) => normLang(v.lang).startsWith('en-gb')) ??
    voices.find((v) => normLang(v.lang).startsWith('en')) ??
    null
  )
}

/**
 * Speak `text` with a system voice for `lang` (rate 0.85 for clarity).
 * Cancels any ongoing utterance first. Returns false when speech synthesis
 * is unavailable or no matching voice exists (graceful no-op).
 */
export async function speak(text: string, lang: SpeakLang, rate = 0.85): Promise<boolean> {
  const t = text.trim()
  if (!t) return false
  // Electron (offline): the preload bridge routes to the macOS `say` command.
  const bridge = (
    window as unknown as { nativeSpeak?: (text: string, lang: SpeakLang) => Promise<boolean> }
  ).nativeSpeak
  if (bridge) {
    try {
      return await bridge(t, lang)
    } catch {
      return false
    }
  }
  if (typeof speechSynthesis === 'undefined') return false
  const voices = await loadVoices()
  const voice = pickVoice(voices, lang)
  if (!voice) return false
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(t)
  u.voice = voice
  u.lang = voice.lang
  u.rate = rate
  speechSynthesis.speak(u)
  return true
}
