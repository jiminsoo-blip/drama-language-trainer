import { useRef } from 'react'
import { clamp } from '@/lib/time'

interface Props {
  current: number
  duration: number
  a: number | null
  b: number | null
  onSeek: (t: number) => void
  onChangeA: (t: number) => void
  onChangeB: (t: number) => void
}

/**
 * Custom seek bar with an A–B repeat range band and draggable A/B handles.
 * Click/drag on the track scrubs; dragging the A/B markers adjusts the loop.
 */
export default function SeekBar({ current, duration, a, b, onSeek, onChangeA, onChangeB }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const dragKind = useRef<'seek' | 'a' | 'b' | null>(null)
  const d = Math.max(duration, 0.001)
  const pct = (t: number) => clamp((t / d) * 100, 0, 100)

  const timeFromX = (clientX: number): number => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return clamp(((clientX - rect.left) / rect.width) * d, 0, d)
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const kind = (e.target as HTMLElement).dataset.handle as 'a' | 'b' | undefined
    dragKind.current = kind ?? 'seek'
    e.currentTarget.setPointerCapture(e.pointerId)
    if (!kind) onSeek(timeFromX(e.clientX))
  }
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragKind.current) return
    const t = timeFromX(e.clientX)
    if (dragKind.current === 'seek') onSeek(t)
    else if (dragKind.current === 'a') onChangeA(clamp(t, 0, (b ?? d) - 0.2))
    else onChangeB(clamp(t, (a ?? 0) + 0.2, d))
  }
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragKind.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <div
      ref={ref}
      className="relative h-5 flex-1 cursor-pointer touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="slider"
      aria-label="재생 위치"
      aria-valuemin={0}
      aria-valuemax={d}
      aria-valuenow={current}
    >
      {/* track */}
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-zinc-700" />
      {/* A-B band */}
      {a !== null && b !== null && b > a && (
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-sky-500/60"
          style={{ left: `${pct(a)}%`, width: `${pct(b - a)}%` }}
        />
      )}
      {/* progress */}
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-amber-500"
        style={{ width: `${pct(current)}%` }}
      />
      {/* playhead */}
      <div
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300 shadow"
        style={{ left: `${pct(current)}%` }}
      />
      {/* A / B handles */}
      {a !== null && (
        <div
          data-handle="a"
          className="absolute top-1/2 z-10 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border-2 border-sky-300 bg-sky-600 text-[8px] font-bold text-white shadow"
          style={{ left: `${pct(a)}%` }}
          title="A 지점 (드래그로 이동)"
        >
          A
        </div>
      )}
      {b !== null && (
        <div
          data-handle="b"
          className="absolute top-1/2 z-10 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border-2 border-sky-300 bg-sky-600 text-[8px] font-bold text-white shadow"
          style={{ left: `${pct(b)}%` }}
          title="B 지점 (드래그로 이동)"
        >
          B
        </div>
      )}
    </div>
  )
}
