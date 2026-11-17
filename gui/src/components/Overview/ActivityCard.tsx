import { useCallback, useId, useRef, type KeyboardEvent } from 'react'
import type { AgentFilter } from '@shared/overview/buckets'
import type { HistoryAgent, HistoryPoint, WaitBar, WaitLedgerData, WaitingNow } from '@shared/overview/types'
import { usePersistedChoice } from '@/hooks/useUsage'
import { Card, EmptyState } from './Card'
import { LastHourChart } from './LastHourChart'
import { TimelineBody } from './TimelineBody'
import { WaitedOnYou } from './WaitedOnYou'
import { WaitsBody } from './WaitsBody'
import tabStyles from './Sessions.module.css'
import styles from './ActivityCard.module.css'

export const ACTIVITY_TAB_KEY = 'agentStudio.overview.activityTab'

const TABS = [
  { id: 'lastHour', label: 'Last hour' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'waits', label: 'Waits' }
] as const

export type ActivityTab = (typeof TABS)[number]['id']
const TAB_IDS = TABS.map((t) => t.id)

interface ActivityCardProps {
  /** `undefined` until the history arrived. */
  points: HistoryPoint[] | undefined
  starts: HistoryPoint['at'][] | undefined
  now: number
  agents: Record<string, HistoryAgent>
  agentFilter?: AgentFilter
  ledger: WaitLedgerData | null
  waitingNow: WaitingNow[]
  waitsFilter?: AgentFilter
  /** The last-hour wait bars; `null` while the ledger is unknown. */
  waited: { bars: WaitBar[]; from: number; unmeasuredMs: number } | null
}

/** Last hour, Timeline and Waits in one card; the chosen tab is remembered. */
export function ActivityCard({
  points,
  starts,
  now,
  agents,
  agentFilter,
  ledger,
  waitingNow,
  waitsFilter,
  waited
}: ActivityCardProps) {
  const [tab, setTab] = usePersistedChoice<ActivityTab>(ACTIVITY_TAB_KEY, 'lastHour', TAB_IDS)
  const baseId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const at = TAB_IDS.indexOf(tab)
      let next = -1
      if (e.key === 'ArrowRight') next = (at + 1) % TAB_IDS.length
      else if (e.key === 'ArrowLeft') next = (at - 1 + TAB_IDS.length) % TAB_IDS.length
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = TAB_IDS.length - 1
      if (next < 0) return
      e.preventDefault()
      setTab(TAB_IDS[next])
      listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
    },
    [tab, setTab]
  )

  const tabs = (
    <div
      ref={listRef}
      className={tabStyles.segmented}
      role="tablist"
      aria-label="Activity view"
      onKeyDown={onKeyDown}
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${baseId}-tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`${baseId}-panel`}
          tabIndex={tab === t.id ? 0 : -1}
          className={`${tabStyles.segment} ${tab === t.id ? tabStyles.segmentActive : ''}`}
          onClick={() => setTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  return (
    <Card title="Activity" area="activity" actions={tabs}>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${tab}`} className={styles.panel}>
        {tab === 'lastHour' &&
          (points && starts ? (
            <LastHourChart points={points} starts={starts} now={now} agentFilter={agentFilter} />
          ) : (
            <EmptyState>No history yet</EmptyState>
          ))}
        {tab === 'timeline' && (
          <TimelineBody points={points ?? []} starts={starts ?? []} now={now} agents={agents} agentFilter={agentFilter} />
        )}
        {tab === 'waits' && (
          <>
            <WaitsBody ledger={ledger} waitingNow={waitingNow} now={now} agentFilter={waitsFilter} />
            {waited && <WaitedOnYou bars={waited.bars} from={waited.from} unmeasuredMs={waited.unmeasuredMs} />}
          </>
        )}
      </div>
    </Card>
  )
}
