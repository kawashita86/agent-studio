// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OverviewCounts } from '@shared/overview/types'
import { StatusStrip } from './StatusStrip'

const counts: OverviewCounts = {
  working: 3,
  idle: 2,
  stale: 1,
  needsYou: 0,
  open: 6,
  finished: 2,
  failed: 1,
  notRunning: 0,
  total: 9,
  longestWorkingMs: 18 * 60_000,
  longestIdleMs: null
}

function renderStrip(over: Partial<OverviewCounts> = {}, props: Partial<Parameters<typeof StatusStrip>[0]> = {}) {
  const handlers = { onToggleFilter: vi.fn(), onFocusNeeds: vi.fn(), onOpenChart: vi.fn() }
  render(<StatusStrip counts={{ ...counts, ...over }} filter={null} {...handlers} {...props} />)
  return handlers
}

describe('StatusStrip', () => {
  afterEach(cleanup)

  it('shows counts, labels and details', () => {
    renderStrip()
    const chip = (name: RegExp) => screen.getByRole('button', { name }).textContent
    expect(chip(/^\d+\s*Working/)).toBe('3Working· longest 18m')
    expect(chip(/^\d+\s*Idle/)).toBe('3Idle· 1 stale')
    expect(chip(/^\d+\s*Finished/)).toBe('2Finished')
    expect(chip(/^\d+\s*Failed/)).toBe('1Failed')
    expect(chip(/^\d+\s*Needs you/)).toBe('0Needs you')
  })

  it('omits the stale detail and Not running when zero, shows Not running above zero', () => {
    const { onToggleFilter } = renderStrip({ stale: 0, notRunning: 0 })
    expect(screen.queryByText(/stale/)).toBeNull()
    expect(screen.queryByText('Not running')).toBeNull()
    cleanup()
    const h = renderStrip({ notRunning: 4 })
    fireEvent.click(screen.getByRole('button', { name: /^\d+\s*Not running/ }))
    expect(h.onToggleFilter).toHaveBeenCalledWith('not-running')
    expect(onToggleFilter).not.toHaveBeenCalled()
  })

  it('highlights Needs you only when above zero, and clicking it focuses the card', () => {
    const { onFocusNeeds } = renderStrip({ needsYou: 2 })
    const button = screen.getByRole('button', { name: /^\d+\s*Needs you/ })
    expect(button.closest('[data-attention]')?.getAttribute('data-attention')).toBe('true')
    expect(button.getAttribute('aria-pressed')).toBeNull()
    fireEvent.click(button)
    expect(onFocusNeeds).toHaveBeenCalledTimes(1)
  })

  it('marks the filtered chip as pressed and toggles on click', () => {
    const { onToggleFilter } = renderStrip({}, { filter: 'working' })
    expect(screen.getByRole('button', { name: /^\d+\s*Working/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^\d+\s*Failed/ }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /^\d+\s*Failed/ }))
    expect(onToggleFilter).toHaveBeenCalledWith('failed')
  })

  it('gives only chips with history a chart button', () => {
    const { onOpenChart } = renderStrip({}, { openChart: 'idle' })
    expect(screen.getAllByRole('button', { name: /history$/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Needs you history',
      'Working history',
      'Idle history'
    ])
    expect(screen.getByRole('button', { name: 'Idle history' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Working history' }).getAttribute('title')).toBe('Working history')
    fireEvent.click(screen.getByRole('button', { name: 'Working history' }))
    expect(onOpenChart).toHaveBeenCalledWith('working', expect.any(HTMLElement))
  })
})
