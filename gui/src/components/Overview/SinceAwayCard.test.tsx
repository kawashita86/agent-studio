// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryResponse, OverviewEvent } from '@shared/overview/types'
import { SinceAwayCard } from './SinceAwayCard'

const NOW = new Date(2026, 9, 22, 12, 0, 0).getTime()
const MIN = 60_000
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function ev(id: string, at: number, extra: Partial<OverviewEvent> = {}): OverviewEvent {
  return { id, at, kind: 'status', agentId: id, name: `agent-${id}`, projectDir: '/w/one', ...extra }
}

function historyOf(events: OverviewEvent[]): HistoryResponse {
  const agents: HistoryResponse['agents'] = {}
  for (const e of events) if (e.agentId) agents[e.agentId] = { name: e.name, projectDir: e.projectDir }
  return { since: NOW - 86_400_000, startedAt: NOW - 86_400_000, starts: [], points: [], events, agents }
}

const LAST_SEEN = NOW - 30 * MIN
const EVENTS = [
  ev('old', NOW - 40 * MIN, { to: 'finished' }),
  ev('f1', NOW - 20 * MIN, { to: 'finished' }),
  ev('f2', NOW - 15 * MIN, { to: 'finished', projectDir: '/w/two' }),
  ev('x', NOW - 12 * MIN, { to: 'failed' }),
  ev('w1', NOW - 10 * MIN, { from: 'needs-you', to: 'working', waitedMs: 4 * MIN }),
  ev('w2', NOW - 5 * MIN, { from: 'needs-you', to: 'working', waitedMs: 10 * MIN, projectDir: '/w/two' }),
  ev('n', NOW - 2 * MIN, { kind: 'appeared', to: 'working' })
]

function renderCard(props: Partial<Parameters<typeof SinceAwayCard>[0]> = {}) {
  return render(
    <SinceAwayCard
      history={historyOf(EVENTS)}
      filter=""
      now={NOW}
      lastSeen={LAST_SEEN}
      awayFrom={LAST_SEEN}
      onClearMarker={() => undefined}
      onOpenAgent={() => undefined}
      {...props}
    />
  )
}

describe('SinceAwayCard', () => {
  afterEach(cleanup)

  it('titles the window with the marker time and shows the figures', () => {
    renderCard()
    expect(screen.getByRole('region', { name: `Since you were away · since ${time(LAST_SEEN)}` })).toBeTruthy()
    const figures = screen.getByRole('list', { name: 'Summary' })
    expect(within(figures).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '2 finished',
      '1 failed',
      '2 waits answered (14m waited)',
      '1 started'
    ])
  })

  it('expands the agents behind a figure and opens them from the name', () => {
    const onOpenAgent = vi.fn()
    renderCard({ onOpenAgent })
    const finished = screen.getByRole('button', { name: /finished/ })
    expect(finished.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(finished)
    expect(finished.getAttribute('aria-expanded')).toBe('true')
    const list = screen.getByRole('list', { name: '2 finished' })
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['agent-f2', 'agent-f1'])
    expect(list.textContent).toContain(clock(NOW - 20 * MIN))
    fireEvent.click(within(list).getByRole('button', { name: 'agent-f1' }))
    expect(onOpenAgent).toHaveBeenCalledWith('f1', expect.any(HTMLElement))

    // Another figure replaces the list; the same one closes it.
    fireEvent.click(screen.getByRole('button', { name: /waits answered/ }))
    expect(screen.getByRole('list', { name: '2 waits answered' }).textContent).toContain('waited 4m 00s')
    fireEvent.click(screen.getByRole('button', { name: /waits answered/ }))
    expect(screen.queryByRole('list', { name: '2 waits answered' })).toBeNull()
  })

  it('honours the project filter', () => {
    renderCard({ filter: '/w/two' })
    const buttons = within(screen.getByRole('list', { name: 'Summary' })).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['1 finished', '1 wait answered (10m waited)'])
  })

  it('falls back to the last hour without a marker', () => {
    renderCard({ awayFrom: null })
    expect(screen.getByRole('region', { name: 'Last hour of events' })).toBeTruthy()
    // The 40 min old event is inside the last hour now.
    expect(screen.getByRole('button', { name: /finished/ }).textContent).toBe('3 finished')
  })

  it('does not count events older than the fallback hour', () => {
    renderCard({ awayFrom: null, history: historyOf([ev('ancient', NOW - 90 * MIN, { to: 'finished' })]) })
    expect(screen.getByText('Nothing happened in the last hour')).toBeTruthy()
  })

  it('says so when nothing happened', () => {
    renderCard({ awayFrom: NOW - MIN })
    expect(screen.getByText(`Nothing happened since ${time(NOW - MIN)}`)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Summary' })).toBeNull()
  })

  it('shows the whole log behind All events', () => {
    renderCard()
    const toggle = screen.getByRole('button', { name: /All events/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: 'Events log' })).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const log = screen.getByRole('region', { name: 'Events log' })
    // The log has every event, the digest only the new ones; the divider is at the marker.
    expect(within(log).getAllByRole('listitem').length).toBeGreaterThanOrEqual(EVENTS.length)
    expect(within(log).getByRole('separator').textContent).toBe(`New since ${clock(LAST_SEEN)}`)
    fireEvent.click(toggle)
    expect(screen.queryByRole('region', { name: 'Events log' })).toBeNull()
  })

  it('keeps its window when the log marker is cleared', () => {
    renderCard({ lastSeen: null })
    expect(screen.getByRole('region', { name: `Since you were away · since ${time(LAST_SEEN)}` })).toBeTruthy()
  })
})
