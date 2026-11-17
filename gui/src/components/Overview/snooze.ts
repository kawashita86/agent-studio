import { useCallback, useEffect, useState } from 'react'

export const SNOOZE_KEY = 'agentStudio.overview.snoozed'
export const SNOOZE_MS = 15 * 60_000

/** Snoozed waits: `<agentId>@<statusSince>` to the time the snooze ends. */
export type Snoozes = Record<string, number>

/** A new wait of the same agent has a new `statusSince`, so it never inherits a snooze. */
export function snoozeKey(agentId: string, statusSince: number): string {
  return `${agentId}@${statusSince}`
}

/** Only entries still running at `now`. */
export function activeSnoozes(all: Snoozes, now: number): Snoozes {
  const out: Snoozes = {}
  for (const [key, until] of Object.entries(all)) if (until > now) out[key] = until
  return out
}

export function readSnoozes(now: number): Snoozes {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const clean: Snoozes = {}
    for (const [key, until] of Object.entries(parsed)) if (typeof until === 'number') clean[key] = until
    return activeSnoozes(clean, now)
  } catch {
    return {}
  }
}

function writeSnoozes(snoozes: Snoozes): void {
  try {
    if (Object.keys(snoozes).length === 0) localStorage.removeItem(SNOOZE_KEY)
    else localStorage.setItem(SNOOZE_KEY, JSON.stringify(snoozes))
  } catch {
    /* storage unavailable: the snooze lasts until the view is closed */
  }
}

/** Front-end only snooze of waits, remembered in localStorage; expired entries are pruned as time passes. */
export function useSnoozes(now: number) {
  const [snoozes, setSnoozes] = useState<Snoozes>(() => readSnoozes(now))

  // Entries that expired while the view was closed are dropped from storage too.
  useEffect(() => writeSnoozes(snoozes), [])

  useEffect(() => {
    const active = activeSnoozes(snoozes, now)
    if (Object.keys(active).length !== Object.keys(snoozes).length) {
      setSnoozes(active)
      writeSnoozes(active)
    }
  }, [snoozes, now])

  const isSnoozed = useCallback(
    (agentId: string, statusSince: number) => (snoozes[snoozeKey(agentId, statusSince)] ?? 0) > now,
    [snoozes, now]
  )
  const snooze = useCallback(
    (agentId: string, statusSince: number) => {
      const next = { ...activeSnoozes(snoozes, now), [snoozeKey(agentId, statusSince)]: now + SNOOZE_MS }
      setSnoozes(next)
      writeSnoozes(next)
    },
    [snoozes, now]
  )
  const unsnooze = useCallback(
    (agentId: string, statusSince: number) => {
      const next = { ...snoozes }
      delete next[snoozeKey(agentId, statusSince)]
      setSnoozes(next)
      writeSnoozes(next)
    },
    [snoozes]
  )
  /** When the snooze of this wait ends, `undefined` when it is not snoozed. */
  const until = useCallback((agentId: string, statusSince: number) => snoozes[snoozeKey(agentId, statusSince)], [snoozes])
  return { isSnoozed, snooze, unsnooze, until }
}
