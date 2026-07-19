import { useCallback, useEffect, useState } from 'react'
import LoadScreen from '@/components/LoadScreen'
import StudyView from '@/components/StudyView'
import { loadSettings, loadVocab, saveSettings, saveVocab } from '@/lib/storage'
import type { AppSettings, MediaBundle, VocabEntry } from '@/types'

export default function Home() {
  const [media, setMedia] = useState<MediaBundle | null>(null)
  const [vocab, setVocab] = useState<VocabEntry[]>(() => loadVocab())
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())

  useEffect(() => saveVocab(vocab), [vocab])
  useEffect(() => saveSettings(settings), [settings])

  const addVocab = useCallback((entry: VocabEntry) => {
    setVocab((prev) =>
      prev.some((v) => v.word === entry.word)
        ? prev.map((v) => (v.word === entry.word ? { ...entry, id: v.id } : v))
        : [...prev, entry],
    )
  }, [])

  const deleteVocab = useCallback((id: string) => {
    setVocab((prev) => prev.filter((v) => v.id !== id))
  }, [])

  const updateVocab = useCallback((id: string, patch: Partial<VocabEntry>) => {
    setVocab((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)))
  }, [])

  const reset = useCallback(() => {
    if (media?.videoUrl) URL.revokeObjectURL(media.videoUrl)
    setMedia(null)
  }, [media])

  if (!media) return <LoadScreen onReady={setMedia} />
  return (
    <StudyView
      media={media}
      settings={settings}
      onSettingsChange={setSettings}
      vocab={vocab}
      onAddVocab={addVocab}
      onDeleteVocab={deleteVocab}
      onUpdateVocab={updateVocab}
      onReset={reset}
    />
  )
}
