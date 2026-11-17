import type { UsageState } from '@shared/usage/types'
import { limitSeverity } from '@shared/usage/limits'
import { useCoarseNow, useUsageSummary, useUsageVisibility } from '@/hooks/useUsage'
import { formatCompactTokens, formatExactTokens, formatResets } from '../Usage/format'
import { buildLimitTiles, type LimitTile } from '../Usage/model'
import { projectName } from './format'
import styles from './LimitsBar.module.css'

const MAX_BARS = 4

interface LimitsBarProps {
  /** `null` until the first load: nothing is rendered so the top bar does not jump. */
  state: UsageState | null
  /** The Overview project filter: a project directory, or `''` for all projects. */
  projectDir: string
  /** Opens the detailed report (the Usage dashboard). */
  onOpenReport?: () => void
}

/** `Claude · session (5h)` -> `Claude 5h`, `Codex · weekly` -> `Codex week`. */
export function shortLimitLabel(label: string): string {
  const [source, ...rest] = label.split(' · ')
  const name = rest.join(' · ').replace('session (5h)', '5h').replace(/^weekly$/, 'week')
  return name ? `${source} ${name}` : source
}

function LimitBar({ tile, now }: { tile: LimitTile; now: number }) {
  const w = tile.timed!.window
  const used = Math.round(w.usedPercent)
  const resets = formatResets(w.resetsAt, now)
  return (
    <div
      className={styles.limit}
      data-severity={limitSeverity(w.usedPercent)}
      data-dimmed={tile.dimmed}
      title={[tile.label, `${used}% used`, resets].filter(Boolean).join(' · ')}
    >
      <span className={styles.limitLabel}>{shortLimitLabel(tile.label)}</span>
      <div className={styles.bar} role="progressbar" aria-label={tile.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}>
        <div className={styles.barFill} style={{ width: `${Math.min(100, used)}%` }} />
      </div>
      <span className={styles.percent}>{used}%</span>
    </div>
  )
}

/** One-line usage summary for the Overview top bar: plan limits, today's tokens, report link. */
export function LimitsBar({ state, projectDir, onOpenReport }: LimitsBarProps) {
  const now = useCoarseNow(30_000)
  // Only mounted while the Overview is shown, so this pings exactly while the bar is visible.
  useUsageVisibility(true)
  // An agent in a git worktree records the worktree path, so its tokens are not counted under the
  // project. Known limitation, same as the Usage dashboard.
  const projectKey = projectDir || undefined
  const { summary } = useUsageSummary('today', state !== null, state?.dataVersion, projectKey)

  if (!state) return null
  const tiles = buildLimitTiles(state)
    .filter((t) => t.timed !== null)
    .slice(0, MAX_BARS)
  const tokens = summary?.totalTokens ?? 0
  if (tiles.length === 0 && tokens <= 0) return null

  return (
    <div className={styles.root} role="group" aria-label="Usage and limits">
      {tiles.map((t) => (
        <LimitBar key={t.key} tile={t} now={now} />
      ))}
      {tokens > 0 && (
        <span className={styles.tokens} title={formatExactTokens(tokens)}>
          <strong>{formatCompactTokens(tokens)}</strong> tokens today{projectKey ? ` · ${projectName(projectKey)}` : ''}
        </span>
      )}
      {onOpenReport && (
        <button type="button" className={styles.link} onClick={onOpenReport}>
          Usage report
        </button>
      )}
    </div>
  )
}
