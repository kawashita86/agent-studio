import { useId, useMemo, useState } from 'react'
import type { HistoryResponse } from '@shared/overview/types'
import { Card, EmptyState } from './Card'
import { EventsLog } from './EventsLog'
import { formatDuration, formatMinute, formatTimeOfDay } from './format'
import { awayWindow, eventsForProject, summarizeAway, type AwayEntry, type AwayKey } from './sinceAway'
import styles from './SinceAwayCard.module.css'

interface SinceAwayCardProps {
  history: HistoryResponse | null
  /** Project directory to show, `''` for all. */
  filter: string
  now: number
  /** The log's "New since" marker (see `useLastSeen`), `null` on a first visit or once cleared. */
  lastSeen: number | null
  /** Start of the digest window: when the user last saw the Overview, fixed for this visit. */
  awayFrom: number | null
  onClearMarker: () => void
  onOpenAgent: (agentId: string, trigger: HTMLElement) => void
}

interface Figure {
  key: AwayKey
  label: string
  count: number
  /** Appended to the label, for example the total wait. */
  detail?: string
  entries: AwayEntry[]
}

/**
 * What happened since the user last looked: finished, failed, answered waits and new agents,
 * each opening the agents behind it. "All events" shows the full log in the same card.
 */
export function SinceAwayCard({ history, filter, now, lastSeen, awayFrom, onClearMarker, onOpenAgent }: SinceAwayCardProps) {
  const [open, setOpen] = useState<AwayKey | null>(null)
  const [showAll, setShowAll] = useState(false)
  const listId = useId()
  const logId = useId()

  const { from, sinceMarker } = awayWindow(awayFrom, now)
  // The fallback start follows the clock; rounding to the minute keeps the sums from being redone every second.
  const windowStart = sinceMarker ? from : Math.floor(from / 60_000) * 60_000
  const events = useMemo(() => eventsForProject(history, filter), [history, filter])
  const summary = useMemo(() => summarizeAway(events, windowStart), [events, windowStart])

  const since = formatMinute(windowStart, now)
  const title = sinceMarker ? `Since you were away · since ${since}` : 'Last hour of events'

  const figures: Figure[] = [
    { key: 'finished', label: 'finished', count: summary.finished.length, entries: summary.finished },
    { key: 'failed', label: 'failed', count: summary.failed.length, entries: summary.failed },
    {
      key: 'answered',
      label: summary.answered.length === 1 ? 'wait answered' : 'waits answered',
      count: summary.answered.length,
      detail: `${formatDuration(summary.waitedMs, { compact: true })} waited`,
      entries: summary.answered
    },
    { key: 'started', label: 'started', count: summary.started.length, entries: summary.started }
  ]
  const shown = figures.filter((f) => f.count > 0)
  const expanded = shown.find((f) => f.key === open)

  const toggleAll = (
    <button
      type="button"
      className={styles.allToggle}
      aria-expanded={showAll}
      aria-controls={logId}
      onClick={() => setShowAll((v) => !v)}
    >
      All events
      <span className={styles.chevron} aria-hidden="true">
        {showAll ? '▴' : '▾'}
      </span>
    </button>
  )

  let body
  if (!history) body = <EmptyState>No events yet</EmptyState>
  else if (summary.total === 0)
    body = (
      <p className={styles.quiet}>{sinceMarker ? `Nothing happened since ${since}` : 'Nothing happened in the last hour'}</p>
    )
  else if (shown.length === 0)
    body = (
      <p className={styles.quiet}>
        {sinceMarker ? `Nothing finished, failed or waited since ${since}` : 'Nothing finished, failed or waited in the last hour'}
      </p>
    )
  else
    body = (
      <>
        <ul className={styles.figures} aria-label="Summary">
          {shown.map((f) => (
            <li key={f.key}>
              <button
                type="button"
                className={`${styles.figure} ${styles[`figure_${f.key}`]}`}
                aria-expanded={open === f.key}
                aria-controls={listId}
                onClick={() => setOpen((cur) => (cur === f.key ? null : f.key))}
              >
                <strong className={styles.count}>{f.count}</strong> {f.label}
                {f.detail && <span className={styles.detail}> ({f.detail})</span>}
              </button>
            </li>
          ))}
        </ul>
        {expanded && (
          <ul id={listId} className={styles.agents} aria-label={`${expanded.count} ${expanded.label}`}>
            {expanded.entries.map((e) => (
              <li key={e.id} className={styles.agent}>
                <button type="button" className={styles.agentName} onClick={(ev) => onOpenAgent(e.agentId, ev.currentTarget)}>
                  {e.name}
                </button>
                {e.waitedMs !== undefined && expanded.key === 'answered' && (
                  <span className={styles.agentDetail}>waited {formatDuration(e.waitedMs)}</span>
                )}
                <time className={styles.agentTime} dateTime={new Date(e.at).toISOString()}>
                  {formatTimeOfDay(e.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </>
    )

  return (
    <Card title={title} area="away" actions={toggleAll}>
      {body}
      {showAll && (
        <div id={logId} className={styles.log}>
          <EventsLog
            history={history}
            filter={filter}
            now={now}
            lastSeen={lastSeen}
            onClearMarker={onClearMarker}
            onOpenAgent={onOpenAgent}
          />
        </div>
      )}
    </Card>
  )
}
