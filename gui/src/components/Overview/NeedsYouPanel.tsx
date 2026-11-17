import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { PROVIDER_LABELS } from '@shared/types'
import type { OverviewSession, WaitingReason } from '@shared/overview/types'
import { formatDuration, formatMinute, formatTimeOfDay, projectName } from './format'
import { useSnoozes } from './snooze'
import styles from './NeedsYouPanel.module.css'

/** The last wait that ended, from the events history. */
export interface LastWait {
  name: string
  waitedMs: number
  endedAt: number
}

interface NeedsYouPanelProps {
  /** Sessions with status `needs-you`, in any order. */
  sessions: OverviewSession[]
  now: number
  /** True when the snapshot has agents of more than one provider. */
  showProvider: boolean
  onJumpToAgent: (agentId: string) => void
  /** Opens the details drawer; the agent name becomes a button when given. */
  onOpenDetails?: (agentId: string, trigger: HTMLElement | null) => void
  /** Appended to the all-clear line when provided. */
  lastWait?: LastWait
}

export function reasonLabel(reason: WaitingReason | undefined): string {
  if (reason === 'permission') return 'Waiting for permission'
  if (reason === 'question') return 'Asked you a question'
  return 'Waiting for you'
}

export type WaitLevel = 'normal' | 'warn' | 'critical'
export const WAIT_WARN_MS = 2 * 60_000
export const WAIT_CRITICAL_MS = 10 * 60_000

/** Escalation level of a wait: neutral below 2 min, amber from 2 min, red from 10 min. */
export function waitLevel(ms: number): WaitLevel {
  if (ms >= WAIT_CRITICAL_MS) return 'critical'
  if (ms >= WAIT_WARN_MS) return 'warn'
  return 'normal'
}

export type ReasonTone = 'permission' | 'question' | 'other'

export function reasonTone(reason: WaitingReason | undefined): ReasonTone {
  return reason === 'permission' || reason === 'question' ? reason : 'other'
}

function Item({
  session,
  now,
  showProvider,
  large,
  selected,
  itemRef,
  onSelect,
  onJumpToAgent,
  onOpenDetails
}: {
  session: OverviewSession
  now: number
  showProvider: boolean
  large: boolean
  /** The roving-focus item: the only one in the tab order, and it shows its full waiting text. */
  selected: boolean
  itemRef: (el: HTMLLIElement | null) => void
  onSelect: () => void
  onJumpToAgent: (agentId: string) => void
  onOpenDetails?: (agentId: string, trigger: HTMLElement | null) => void
}) {
  const where = [
    session.worktreeBranch
      ? `${projectName(session.projectDir)} on ${session.worktreeBranch}`
      : projectName(session.projectDir),
    showProvider ? PROVIDER_LABELS[session.provider] : null
  ]
    .filter(Boolean)
    .join(' · ')

  const tone = reasonTone(session.waitingReason)
  const waitedMs = now - session.statusSince
  const level = waitLevel(waitedMs)

  return (
    <li
      ref={itemRef}
      className={`${styles.item} ${large ? styles.large : ''} ${selected ? styles.selected : ''} ${styles[`tone-${tone}`]} ${styles[`level-${level}`]}`}
      data-tone={tone}
      data-level={level}
      data-agent-item={session.agentId}
      data-selected={selected ? 'true' : undefined}
      tabIndex={selected ? 0 : -1}
      onFocus={onSelect}
    >
      <span className={styles.dot} aria-hidden="true" />
      <div className={styles.main}>
        <div className={styles.head}>
          {onOpenDetails ? (
            <button
              type="button"
              className={`${styles.name} ${styles.nameButton}`}
              title={session.name}
              data-session-trigger={session.agentId}
              onClick={(e) => onOpenDetails(session.agentId, e.currentTarget)}
              aria-label={`Details of ${session.name}`}
            >
              {session.name}
            </button>
          ) : (
            <span className={styles.name} title={session.name}>
              {session.name}
            </span>
          )}
          <span className={styles.reason} data-tone={tone}>{reasonLabel(session.waitingReason)}</span>
        </div>
        <div className={styles.where} title={session.projectDir}>
          {where}
        </div>
        {session.waitingText && (
          <div className={styles.text} title={session.waitingText}>
            {session.waitingText}
          </div>
        )}
      </div>
      <span className={styles.timer} aria-label="Waiting for">
        {formatDuration(waitedMs)}
      </span>
      <button
        type="button"
        className={styles.jump}
        onClick={() => onJumpToAgent(session.agentId)}
        aria-label={`Jump to ${session.name}`}
      >
        Jump
      </button>
    </li>
  )
}

function AllClear({ lastWait, now }: { lastWait?: LastWait; now: number }) {
  return (
    <p className={styles.clear}>
      <span className={styles.clearIcon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M7.5 12.5l3 3 6-6.5" />
        </svg>
      </span>
      <strong className={styles.clearTitle}>Nothing needs you</strong>
      {lastWait && (
        <span className={styles.lastWait}>
          · last wait {formatDuration(lastWait.waitedMs)}, {lastWait.name}, answered at {formatMinute(lastWait.endedAt, now)}
        </span>
      )}
    </p>
  )
}

/** The keys the list answers to while focus is inside it. */
export function KeyboardHint() {
  return (
    <span className={styles.hint} aria-hidden="true">
      <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>↵</kbd> jump · <kbd>D</kbd> details · <kbd>S</kbd> snooze
    </span>
  )
}

function SnoozedItem({
  session,
  until,
  now,
  onUnsnooze,
  onOpenDetails
}: {
  session: OverviewSession
  until: number | undefined
  now: number
  onUnsnooze: () => void
  onOpenDetails?: (agentId: string, trigger: HTMLElement | null) => void
}) {
  return (
    <li className={styles.snoozedItem} data-agent-snoozed={session.agentId}>
      {onOpenDetails ? (
        <button
          type="button"
          className={`${styles.name} ${styles.nameButton}`}
          onClick={(e) => onOpenDetails(session.agentId, e.currentTarget)}
          aria-label={`Details of ${session.name}`}
        >
          {session.name}
        </button>
      ) : (
        <span className={styles.name}>{session.name}</span>
      )}
      <span className={styles.reason} data-tone={reasonTone(session.waitingReason)}>
        {reasonLabel(session.waitingReason)}
      </span>
      <span className={styles.snoozedUntil}>
        waiting {formatDuration(now - session.statusSince)}
        {until !== undefined && `, back at ${formatTimeOfDay(until)}`}
      </span>
      <button type="button" className={styles.unsnooze} onClick={onUnsnooze} aria-label={`Unsnooze ${session.name}`}>
        Unsnooze
      </button>
    </li>
  )
}

/**
 * Waiting agents, longest first. Focus inside the list roves with J/K (or the arrow keys); Enter jumps,
 * D opens the details, S snoozes for 15 minutes. The keys are handled on the list itself, so the terminal is unaffected.
 *
 * A snoozed wait only leaves this list: the Needs you count in the status strip and the tab badge are
 * computed from the snapshot and still include it, so a snooze never hides that something is waiting.
 */
export function NeedsYouPanel({ sessions, now, showProvider, onJumpToAgent, onOpenDetails, lastWait }: NeedsYouPanelProps) {
  const { isSnoozed, snooze, unsnooze, until } = useSnoozes(now)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showSnoozed, setShowSnoozed] = useState(false)
  const items = useRef(new Map<string, HTMLLIElement>())
  const pendingFocus = useRef<string | null>(null)
  const snoozedToggle = useRef<HTMLButtonElement>(null)

  const sorted = useMemo(() => [...sessions].sort((a, b) => a.statusSince - b.statusSince), [sessions])
  const active = useMemo(() => sorted.filter((s) => !isSnoozed(s.agentId, s.statusSince)), [sorted, isSnoozed])
  const snoozed = useMemo(() => sorted.filter((s) => isSnoozed(s.agentId, s.statusSince)), [sorted, isSnoozed])
  const selected = active.find((s) => s.agentId === selectedId) ?? active[0]

  // After a snooze the focused item is gone: move focus to its neighbour once it has rendered.
  useEffect(() => {
    const id = pendingFocus.current
    if (id === null) return
    pendingFocus.current = null
    if (id === '') snoozedToggle.current?.focus()
    else items.current.get(id)?.focus()
  })

  const move = useCallback(
    (from: number, delta: number) => {
      const next = active[Math.min(active.length - 1, Math.max(0, from + delta))]
      if (!next) return
      setSelectedId(next.agentId)
      items.current.get(next.agentId)?.focus()
    },
    [active]
  )

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-agent-item]')
    const index = li ? active.findIndex((s) => s.agentId === li.dataset.agentItem) : -1
    if (!li || index < 0) return
    const session = active[index]
    switch (e.key) {
      case 'j':
      case 'J':
      case 'ArrowDown':
        move(index, 1)
        break
      case 'k':
      case 'K':
      case 'ArrowUp':
        move(index, -1)
        break
      case 'Enter':
        // A focused button inside the item keeps its own Enter.
        if (e.target !== li) return
        onJumpToAgent(session.agentId)
        break
      case 'd':
      case 'D':
        onOpenDetails?.(session.agentId, li)
        break
      case 's':
      case 'S': {
        const neighbour = active[index + 1] ?? active[index - 1]
        pendingFocus.current = neighbour?.agentId ?? ''
        if (neighbour) setSelectedId(neighbour.agentId)
        snooze(session.agentId, session.statusSince)
        break
      }
      default:
        return
    }
    e.preventDefault()
  }

  const snoozedBar = snoozed.length > 0 && (
    <div className={styles.snoozed}>
      <button
        ref={snoozedToggle}
        type="button"
        className={styles.snoozedToggle}
        aria-expanded={showSnoozed}
        onClick={() => setShowSnoozed((v) => !v)}
      >
        {snoozed.length} snoozed · {showSnoozed ? 'Hide' : 'Show'}
      </button>
      {showSnoozed && (
        <ul className={styles.snoozedList} aria-label="Snoozed waits">
          {snoozed.map((s) => (
            <SnoozedItem
              key={s.agentId}
              session={s}
              until={until(s.agentId, s.statusSince)}
              now={now}
              onUnsnooze={() => unsnooze(s.agentId, s.statusSince)}
              onOpenDetails={onOpenDetails}
            />
          ))}
        </ul>
      )}
    </div>
  )

  if (active.length === 0)
    return (
      <>
        <AllClear lastWait={lastWait} now={now} />
        {snoozedBar}
      </>
    )

  return (
    <>
      {/* The keys act on the list through bubbling; the items are the focus targets. */}
      <ul className={styles.list} aria-label="Waiting agents" onKeyDown={onKeyDown}>
        {active.map((s, index) => (
          <Item
            key={s.agentId}
            session={s}
            now={now}
            showProvider={showProvider}
            large={index === 0}
            selected={s.agentId === selected?.agentId}
            itemRef={(el) => {
              if (el) items.current.set(s.agentId, el)
              else items.current.delete(s.agentId)
            }}
            onSelect={() => setSelectedId(s.agentId)}
            onJumpToAgent={onJumpToAgent}
            onOpenDetails={onOpenDetails}
          />
        ))}
      </ul>
      {snoozedBar}
    </>
  )
}
