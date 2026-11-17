import type { AgentChanges, OverviewSession, PrSummary } from '@shared/overview/types'
import { isEnded } from '@shared/overview/status'
import { formatAgo, formatClock, formatDuration } from './format'
import {
  agentLabel,
  aheadTitle,
  branchOf,
  diffText,
  dotKey,
  folderOf,
  isWebUrl,
  prLabel,
  quietText,
  statusLabel
} from './sessionFacts'
import styles from './Sessions.module.css'

export interface SessionItemProps {
  session: OverviewSession
  now: number
  /** True when the snapshot has agents of more than one provider. */
  showProvider: boolean
  /** Opens the details drawer; `trigger` gets the focus back when it closes. */
  onOpenDetails: (agentId: string, trigger: HTMLElement | null) => void
  onJumpToAgent: (agentId: string) => void
  /** True when this item is the one shown in the drawer. */
  selected?: boolean
}

/** Folder (unless it only repeats the repository name) and branch, or the short commit when detached. */
export function Where({ session, hideFolder }: { session: OverviewSession; hideFolder?: boolean }) {
  const branch = branchOf(session)
  const folder = hideFolder ? null : folderOf(session)
  return (
    <span className={styles.where} title={session.projectDir}>
      {folder && <span className={styles.folder}>{folder}</span>}
      {branch ? (
        <span className={styles.branch}>{branch}</span>
      ) : session.commit ? (
        <span className={`${styles.branch} ${styles.mono}`} title="Detached HEAD">
          {session.commit}
        </span>
      ) : null}
    </span>
  )
}

/** `+142 −37 · 6 files` and `↑2` when commits are not pushed; nothing when nothing changed. */
export function DiffStat({ changes }: { changes: AgentChanges | undefined }) {
  const files = diffText(changes)
  const ahead = aheadTitle(changes)
  if (!changes || (!files && !ahead)) return null
  return (
    <span className={styles.changes} data-testid="changes">
      {files && (
        <>
          <span className={styles.added}>+{changes.added}</span>
          <span className={styles.removed}>
            {'\u2212'}
            {changes.removed}
          </span>
          <span className={styles.changesFiles}>
            {'\u00b7'} {files}
          </span>
        </>
      )}
      {ahead && (
        <span className={styles.ahead} title={ahead}>
          {'\u2191'}
          {changes.ahead}
        </span>
      )}
    </span>
  )
}

/** The pull request of the agent's branch; opens its page in the browser. */
export function PrPill({ pr }: { pr: PrSummary | undefined }) {
  if (!pr) return null
  const open = () => {
    if (isWebUrl(pr.url)) window.hydra.openExternal(pr.url).catch(() => {})
  }
  return (
    <button
      type="button"
      className={`${styles.prPill} ${styles[`pr_${pr.state}`]}`}
      onClick={open}
      title={`Open ${pr.url}`}
      aria-label={`Open ${prLabel(pr)} in the browser`}
    >
      {prLabel(pr)}
    </button>
  )
}

export function StatusFact({ session, now }: { session: OverviewSession; now: number }) {
  const quiet = quietText(session, now)
  const ended = isEnded(session.status)
  const endedAt = session.endedAt ?? session.statusSince
  return (
    <span className={styles.statusCell}>
      <span className={styles.statusLine}>
        <span className={`${styles.dot} ${styles[dotKey(session)]}`} aria-hidden="true" />
        <span className={styles.statusText}>{statusLabel(session)}</span>
        {session.status === 'failed' && session.exitCode !== undefined && (
          <span className={styles.duration}>exit {session.exitCode}</span>
        )}
        {ended ? (
          <span className={`${styles.duration} ${styles.endedAgo}`} title={formatClock(endedAt, now)}>
            {session.status === 'not-running' ? 'last active' : 'ended'} {formatAgo(endedAt, now)}
          </span>
        ) : (
          <span className={styles.duration}>{formatDuration(now - session.statusSince, { compact: true })}</span>
        )}
      </span>
      <DiffStat changes={session.changes} />
      {quiet && (
        <span
          className={styles.quiet}
          title={session.lastOutputAt > 0 ? `Last output at ${formatClock(session.lastOutputAt, now)}` : undefined}
        >
          {quiet}
        </span>
      )}
    </span>
  )
}

export function SessionRow({
  session,
  now,
  showProvider,
  onOpenDetails,
  onJumpToAgent,
  selected,
  hideFolder
}: SessionItemProps & { hideFolder?: boolean }) {
  return (
    <li className={`${styles.row} ${selected ? styles.selected : ''}`}>
      <button
        type="button"
        className={styles.rowMain}
        data-session-trigger={session.agentId}
        onClick={(e) => onOpenDetails(session.agentId, e.currentTarget)}
        aria-label={`Details of ${session.name}`}
      >
        <span className={`${styles.cell} ${styles.colName}`} title={session.name}>
          {session.name}
        </span>
        <span className={`${styles.cell} ${styles.colAgent}`}>{agentLabel(session, showProvider)}</span>
        <span className={`${styles.cell} ${styles.colWhere}`}>
          <Where session={session} hideFolder={hideFolder} />
        </span>
        <span className={`${styles.cell} ${styles.colStatus}`}>
          <StatusFact session={session} now={now} />
        </span>
      </button>
      {/* Always present, so the columns of rows with and without a pull request line up. */}
      <span className={styles.prSlot}>
        <PrPill pr={session.changes?.pr} />
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
