import type { CountKey } from '@shared/overview/buckets'
import type { OverviewCounts, OverviewStatus } from '@shared/overview/types'
import { formatDuration } from './format'
import styles from './StatusStrip.module.css'
import dotStyles from './Sessions.module.css'

/** Statuses a chip can filter the Sessions card to. */
export type StatusFilter = Extract<OverviewStatus, 'working' | 'idle' | 'finished' | 'failed' | 'not-running'>

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  working: 'Working',
  idle: 'Idle',
  finished: 'Finished',
  failed: 'Failed',
  'not-running': 'Not running'
}

interface StatusStripProps {
  counts: OverviewCounts
  /** The status the Sessions card is filtered to. */
  filter: StatusFilter | null
  onToggleFilter: (status: StatusFilter) => void
  /** The Needs you chip: scroll to and focus the card. */
  onFocusNeeds: () => void
  /** Opens the history chart of a count (chips with history get a chart button). */
  onOpenChart?: (key: CountKey, trigger: HTMLElement) => void
  /** The count whose chart is open. */
  openChart?: CountKey | null
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  )
}

interface ChipProps {
  dot: string
  count: number
  label: string
  detail?: string
  pressed?: boolean
  attention?: boolean
  onClick: () => void
  chart?: { key: CountKey; open: boolean; onOpen: (key: CountKey, trigger: HTMLElement) => void }
}

function Chip({ dot, count, label, detail, pressed, attention, onClick, chart }: ChipProps) {
  return (
    <div className={styles.chip} data-attention={attention ? 'true' : undefined} data-pressed={pressed ? 'true' : undefined}>
      <button type="button" className={styles.main} aria-pressed={pressed} onClick={onClick}>
        <span className={`${dotStyles.dot} ${dotStyles[dot]}`} aria-hidden="true" />
        <strong className={styles.count}>{count}</strong>
        <span className={styles.label}>{label}</span>
        {detail && <span className={styles.detail}>· {detail}</span>}
      </button>
      {chart && (
        <button
          type="button"
          className={styles.chartBtn}
          aria-label={`${label} history`}
          aria-expanded={chart.open}
          title={`${label} history`}
          onClick={(e) => chart.onOpen(chart.key, e.currentTarget)}
        >
          <ChartIcon />
        </button>
      )}
    </div>
  )
}

/** Compact status chips: Needs you jumps to its card, the others filter the Sessions card. */
export function StatusStrip({ counts, filter, onToggleFilter, onFocusNeeds, onOpenChart, openChart }: StatusStripProps) {
  const chart = (key: CountKey) => (onOpenChart ? { key, open: openChart === key, onOpen: onOpenChart } : undefined)
  const toggle = (status: StatusFilter) => () => onToggleFilter(status)
  return (
    <div className={styles.strip} role="group" aria-label="Agent status">
      <Chip
        dot="dot_needs_you"
        count={counts.needsYou}
        label="Needs you"
        attention={counts.needsYou > 0}
        onClick={onFocusNeeds}
        chart={chart('needsYou')}
      />
      <Chip
        dot="dot_working"
        count={counts.working}
        label="Working"
        detail={
          counts.longestWorkingMs !== null ? `longest ${formatDuration(counts.longestWorkingMs, { compact: true })}` : undefined
        }
        pressed={filter === 'working'}
        onClick={toggle('working')}
        chart={chart('working')}
      />
      <Chip
        dot="dot_idle"
        count={counts.idle + counts.stale}
        label="Idle"
        detail={counts.stale > 0 ? `${counts.stale} stale` : undefined}
        pressed={filter === 'idle'}
        onClick={toggle('idle')}
        chart={chart('idle')}
      />
      <Chip dot="dot_finished" count={counts.finished} label="Finished" pressed={filter === 'finished'} onClick={toggle('finished')} />
      <Chip dot="dot_failed" count={counts.failed} label="Failed" pressed={filter === 'failed'} onClick={toggle('failed')} />
      {counts.notRunning > 0 && (
        <Chip
          dot="dot_not_running"
          count={counts.notRunning}
          label="Not running"
          pressed={filter === 'not-running'}
          onClick={toggle('not-running')}
        />
      )}
    </div>
  )
}
