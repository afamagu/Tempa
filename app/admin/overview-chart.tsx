import { sectionLabelClass, helperTextClass } from '@/app/profile/ui'
import { formatDateShort } from '@/lib/format-date'

/**
 * A restrained, single-color daily bar chart — no legend, no gridlines,
 * no axis labels beyond the first/last day. Deliberately plain SVG
 * (no charting library): four of these on one screen is already a lot
 * of visual weight for a "calm, not a rainbow SaaS dashboard" console,
 * so each one stays as quiet as possible. `viewBox` + `preserveAspectRatio="none"`
 * makes the whole chart scale to its container's width, so it stays
 * legible at any mobile width without horizontal scroll.
 */
export default function OverviewChart({
  title,
  total,
  points,
}: {
  title: string
  /** Shown next to the title as a quick-glance sum for the visible window. */
  total: number
  points: { day: string; value: number }[]
}) {
  const max = Math.max(1, ...points.map((p) => p.value))
  const barGap = points.length > 20 ? 0.4 : 1
  const barWidth = points.length > 0 ? (100 - barGap * (points.length - 1)) / points.length : 0
  const chartHeight = 32

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <p className={sectionLabelClass}>{title}</p>
        <p className="text-[13px] font-medium text-foreground">{total.toLocaleString()}</p>
      </div>

      {points.length === 0 ? (
        <p className={helperTextClass}>No data yet.</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 100 ${chartHeight}`}
            preserveAspectRatio="none"
            className="h-10 w-full"
            role="img"
            aria-label={`${title}: ${points.map((p) => `${p.day} ${p.value}`).join(', ')}`}
          >
            {points.map((p, i) => {
              const barHeight = max > 0 ? (p.value / max) * (chartHeight - 2) : 0
              const x = i * (barWidth + barGap)
              const y = chartHeight - barHeight
              return (
                <rect
                  key={p.day}
                  x={x}
                  y={y}
                  width={Math.max(barWidth, 0.2)}
                  height={Math.max(barHeight, 0.4)}
                  className="fill-accent"
                />
              )
            })}
          </svg>
          <div className="flex justify-between text-[13px] text-muted">
            <span>{formatDateShort(points[0].day)}</span>
            <span>{formatDateShort(points[points.length - 1].day)}</span>
          </div>
        </>
      )}
    </div>
  )
}
