// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HistoryPoint, WaitLedgerData } from '@shared/overview/types'
import { ActivityCard, ACTIVITY_TAB_KEY } from './ActivityCard'

const NOW = new Date(2026, 9, 22, 12, 0, 0).getTime()

function point(at: number): HistoryPoint {
  return { at, needsYou: 0, working: 1, idle: 0, total: 1, statuses: { a: 'working' } } as unknown as HistoryPoint
}

// A point every 5 s so the stretch counts as measured.
const POINTS = Array.from({ length: 121 }, (_, i) => point(NOW - 600_000 + i * 5000))
const LEDGER: WaitLedgerData = {
  spans: [{ start: NOW - 86_400_000, end: NOW }],
  starts: [],
  transitions: [
    { agentId: 'a', name: 'agent-a', projectDir: '/w', at: NOW - 3_000_000, direction: 'in' },
    { agentId: 'a', name: 'agent-a', projectDir: '/w', at: NOW - 2_800_000, direction: 'out' }
  ]
}
const WAITED = { bars: [{ agentId: 'a', name: 'agent-a', ms: 200_000, open: false, count: 1 }], from: NOW - 3_600_000, unmeasuredMs: 0 }

function renderCard(extra: Partial<Parameters<typeof ActivityCard>[0]> = {}) {
  return render(
    <ActivityCard
      points={POINTS}
      starts={[]}
      now={NOW}
      agents={{ a: { name: 'agent-a', projectDir: '/w' } }}
      ledger={LEDGER}
      waitingNow={[]}
      waited={WAITED as never}
      {...extra}
    />
  )
}

describe('ActivityCard', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('has proper tab semantics and starts on Last hour', () => {
    renderCard()
    expect(screen.getByRole('tablist', { name: 'Activity view' })).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Last hour', 'Timeline', 'Waits'])
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1])
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id)
    expect(screen.getByRole('group', { name: /Last hour/ })).toBeTruthy()
  })

  it('switches tabs by click and shows the matching body', () => {
    renderCard()
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    expect(screen.getByRole('list', { name: 'Agents' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: /Last hour/ })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Waits' }))
    expect(screen.getByRole('group', { name: 'Longest waits period' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Waited on you' })).toBeTruthy()
  })

  it('moves between tabs with the arrow keys, Home and End', () => {
    renderCard()
    const list = screen.getByRole('tablist')
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Timeline' }))
    fireEvent.keyDown(list, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Waits' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Last hour' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Waits' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list, { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Last hour' }).getAttribute('aria-selected')).toBe('true')
  })

  it('remembers the tab', () => {
    const first = renderCard()
    fireEvent.click(screen.getByRole('tab', { name: 'Waits' }))
    expect(localStorage.getItem(ACTIVITY_TAB_KEY)).toBe('waits')
    first.unmount()
    renderCard()
    expect(screen.getByRole('tab', { name: 'Waits' }).getAttribute('aria-selected')).toBe('true')
  })

  it('ignores an unknown stored tab', () => {
    localStorage.setItem(ACTIVITY_TAB_KEY, 'bogus')
    renderCard()
    expect(screen.getByRole('tab', { name: 'Last hour' }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps each tab\'s empty state', () => {
    renderCard({ points: undefined, starts: undefined, ledger: null, waited: null })
    expect(screen.getByText('No history yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    expect(screen.getByText('No history yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Waits' }))
    expect(screen.getByText('No waits recorded yet')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Waited on you' })).toBeNull()
  })
})
