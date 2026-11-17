import type { HistoryResponse, OverviewEvent } from '@shared/overview/types'

/** Without a last-seen marker the digest covers this much. */
export const FALLBACK_WINDOW_MS = 60 * 60 * 1000

/** Events of one project (`''` for all). Gaps (`resumed`) have no agent and always stay. */
export function eventsForProject(history: HistoryResponse | null, filter: string): OverviewEvent[] {
  if (!history) return []
  return history.events.filter((e) => {
    if (filter === '' || e.kind === 'resumed') return true
    return (history.agents[e.agentId]?.projectDir ?? e.projectDir) === filter
  })
}

export interface AwayWindow {
  from: number
  /** True when `from` is the user's last-seen time, false for the last-hour fallback. */
  sinceMarker: boolean
}

/** The window the digest covers: since the marker, or the last 60 minutes without one. */
export function awayWindow(lastSeen: number | null, now: number): AwayWindow {
  return lastSeen === null ? { from: now - FALLBACK_WINDOW_MS, sinceMarker: false } : { from: lastSeen, sinceMarker: true }
}

export interface AwayEntry {
  id: string
  agentId: string
  name: string
  at: number
  /** Set on answered waits. */
  waitedMs?: number
}

export type AwayKey = 'finished' | 'failed' | 'answered' | 'started'

export interface AwaySummary {
  finished: AwayEntry[]
  failed: AwayEntry[]
  /** Waits that ended (an event leaving needs-you with `waitedMs`). */
  answered: AwayEntry[]
  /** Agents that appeared. */
  started: AwayEntry[]
  /** Sum of `waitedMs` over `answered`. */
  waitedMs: number
  /** Events in the window, gaps excluded. */
  total: number
}

/** Figures for the events newer than `from` (newest first inside each list). */
export function summarizeAway(events: OverviewEvent[], from: number): AwaySummary {
  const summary: AwaySummary = { finished: [], failed: [], answered: [], started: [], waitedMs: 0, total: 0 }
  const entry = (e: OverviewEvent): AwayEntry => ({ id: e.id, agentId: e.agentId, name: e.name, at: e.at, waitedMs: e.waitedMs })
  for (const e of [...events].sort((a, b) => b.at - a.at)) {
    if (e.at <= from || e.kind === 'resumed') continue
    summary.total++
    if (e.kind === 'appeared') summary.started.push(entry(e))
    if (e.kind === 'status' && e.to === 'finished') summary.finished.push(entry(e))
    if (e.kind === 'status' && e.to === 'failed') summary.failed.push(entry(e))
    if (e.from === 'needs-you' && e.waitedMs !== undefined) {
      summary.answered.push(entry(e))
      summary.waitedMs += e.waitedMs
    }
  }
  return summary
}
