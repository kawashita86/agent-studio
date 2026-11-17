import { describe, expect, it } from 'vitest'
import type { HistoryResponse, OverviewEvent } from '@shared/overview/types'
import { awayWindow, eventsForProject, FALLBACK_WINDOW_MS, summarizeAway } from './sinceAway'

const NOW = 1_000_000_000

function ev(id: string, at: number, extra: Partial<OverviewEvent> = {}): OverviewEvent {
  return { id, at, kind: 'status', agentId: id, name: `agent-${id}`, projectDir: '/w/one', ...extra }
}

describe('awayWindow', () => {
  it('starts at the marker', () => {
    expect(awayWindow(NOW - 5000, NOW)).toEqual({ from: NOW - 5000, sinceMarker: true })
  })
  it('falls back to the last hour without a marker', () => {
    expect(awayWindow(null, NOW)).toEqual({ from: NOW - FALLBACK_WINDOW_MS, sinceMarker: false })
  })
})

describe('summarizeAway', () => {
  const events = [
    ev('old', NOW - 50_000, { to: 'finished' }),
    ev('f1', NOW - 40_000, { to: 'finished' }),
    ev('f2', NOW - 30_000, { to: 'finished' }),
    ev('x', NOW - 25_000, { to: 'failed' }),
    ev('w1', NOW - 20_000, { from: 'needs-you', to: 'working', waitedMs: 60_000 }),
    ev('w2', NOW - 10_000, { from: 'needs-you', to: 'finished', waitedMs: 30_000 }),
    ev('s', NOW - 5000, { kind: 'appeared', to: 'working' }),
    { ...ev('r', NOW - 4000, { kind: 'resumed' }), agentId: '' }
  ]

  it('counts events newer than the window start', () => {
    const s = summarizeAway(events, NOW - 45_000)
    expect(s.finished.map((e) => e.id)).toEqual(['w2', 'f2', 'f1'])
    expect(s.failed).toHaveLength(1)
    expect(s.answered.map((e) => e.id)).toEqual(['w2', 'w1'])
    expect(s.waitedMs).toBe(90_000)
    expect(s.started).toHaveLength(1)
    expect(s.total).toBe(6)
  })

  it('excludes events at or before the start and gaps', () => {
    const s = summarizeAway(events, NOW - 40_000)
    expect(s.finished.map((e) => e.id)).toEqual(['w2', 'f2'])
    expect(summarizeAway(events, NOW).total).toBe(0)
  })
})

describe('eventsForProject', () => {
  const history = {
    events: [
      ev('a', 1, { agentId: 'a' }),
      ev('b', 2, { agentId: 'b', projectDir: '/w/two' }),
      { ...ev('r', 3, { kind: 'resumed' }), agentId: '' }
    ],
    agents: { a: { name: 'a', projectDir: '/w/one' }, b: { name: 'b', projectDir: '/w/two' } }
  } as unknown as HistoryResponse

  it('keeps everything for all projects and resumed rows for one', () => {
    expect(eventsForProject(history, '')).toHaveLength(3)
    expect(eventsForProject(history, '/w/two').map((e) => e.id)).toEqual(['b', 'r'])
    expect(eventsForProject(null, '')).toEqual([])
  })
})
