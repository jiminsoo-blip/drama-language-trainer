import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: 'Space', desc: '재생 / 일시정지' },
  { keys: '← / →', desc: '이전 / 다음 자막 문장으로 이동' },
  { keys: '↑ / ↓', desc: '재생 속도 올리기 / 내리기 (0.5x – 1.5x)' },
  { keys: '[ / ]', desc: 'A-B 구간의 시작(A) / 끝(B) 지정 — B를 찍으면 반복 시작' },
  { keys: '\\', desc: 'A-B 구간 반복 해제' },
  { keys: '?', desc: '단축키 도움말 열기 / 닫기' },
  { keys: 'Esc', desc: '팝업 · 창 닫기' },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ShortcutHelp({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">키보드 단축키</DialogTitle>
        </DialogHeader>
        <ul className="space-y-2.5">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-zinc-300">{s.desc}</span>
              <kbd className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-amber-300">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
