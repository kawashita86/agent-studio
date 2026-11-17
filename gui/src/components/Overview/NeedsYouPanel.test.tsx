// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OverviewSession } from '@shared/overview/types'
import { SNOOZE_KEY, SNOOZE_MS } from './snooze'
import { KeyboardHint, NeedsYouPanel, waitLevel, WAIT_CRITICAL_MS, WAIT_WARN_MS } from './NeedsYouPanel'

function waiting(id: string, statusSince: number, extra: Partial<OverviewSession> = {}): OverviewSession {
  return {
    agentId: id,
    name: `agent-${id}`,
    provider: 'claude',
    model: 'sonnet',
    projectDir: '/work/alpha',
    worktreeBranch: null,
    status: 'needs-you',
    statusSince,
    stale: false,
    pid: null,
    startedAt: 0,
    lastOutputAt: 0,
    ...extra
  } as OverviewSession
}

const NOW = 10_000_000

describe('NeedsYouPanel', () => {
  afterEach(cleanup)

  it('lists the longest wait first', () => {
    render(
      <NeedsYouPanel
        sessions={[waiting('new', NOW - 1000), waiting('old', NOW - 90_000), waiting('mid', NOW - 30_000)]}
        now={NOW}
        showProvider={false}
        onJumpToAgent={vi.fn()}
      />
    )
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => within(li).getByText(/^agent-/).textContent)).toEqual([
      'agent-old',
      'agent-mid',
      'agent-new'
    ])
  })

  it('labels the reason', () => {
    render(
      <NeedsYouPanel
        sessions={[
          waiting('a', 1, { waitingReason: 'permission' }),
          waiting('b', 2, { waitingReason: 'question' }),
          waiting('c', 3, { waitingReason: 'other' }),
          waiting('d', 4)
        ]}
        now={NOW}
        showProvider={false}
        onJumpToAgent={vi.fn()}
      />
    )
    expect(screen.getByText('Waiting for permission')).toBeTruthy()
    expect(screen.getByText('Asked you a question')).toBeTruthy()
    expect(screen.getAllByText('Waiting for you')).toHaveLength(2)
  })

  it('shows branch, and the provider only when asked to', () => {
    const sessions = [waiting('a', 1, { worktreeBranch: 'feat/x', provider: 'codex' })]
    const { rerender } = render(
      <NeedsYouPanel sessions={sessions} now={NOW} showProvider={false} onJumpToAgent={vi.fn()} />
    )
    expect(screen.getByText('alpha on feat/x').getAttribute('title')).toBe('/work/alpha')
    rerender(<NeedsYouPanel sessions={sessions} now={NOW} showProvider onJumpToAgent={vi.fn()} />)
    expect(screen.getByText('alpha on feat/x · Codex')).toBeTruthy()
  })

  it('renders the waiting text and the live timer', () => {
    const sessions = [waiting('a', NOW - 252_000, { waitingText: 'Run: npm test' })]
    const { rerender } = render(
      <NeedsYouPanel sessions={sessions} now={NOW} showProvider={false} onJumpToAgent={vi.fn()} />
    )
    expect(screen.getByText('Run: npm test').getAttribute('title')).toBe('Run: npm test')
    expect(screen.getByText('4m 12s')).toBeTruthy()
    rerender(<NeedsYouPanel sessions={sessions} now={NOW + 1000} showProvider={false} onJumpToAgent={vi.fn()} />)
    expect(screen.getByText('4m 13s')).toBeTruthy()
  })

  it('calls onJumpToAgent with the agent id', () => {
    const onJump = vi.fn()
    render(
      <NeedsYouPanel
        sessions={[waiting('a', 1), waiting('b', 2)]}
        now={NOW}
        showProvider={false}
        onJumpToAgent={onJump}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Jump to agent-b' }))
    expect(onJump).toHaveBeenCalledWith('b')
  })

  it('shows a one-line all-clear, with the last wait when provided', () => {
    const { rerender, container } = render(
      <NeedsYouPanel sessions={[]} now={NOW} showProvider={false} onJumpToAgent={vi.fn()} />
    )
    expect(screen.getByText('Nothing needs you')).toBeTruthy()
    expect(screen.queryByText(/last wait/)).toBeNull()
    rerender(
      <NeedsYouPanel
        sessions={[]}
        now={NOW}
        showProvider={false}
        onJumpToAgent={vi.fn()}
        lastWait={{ name: 'agent-z', waitedMs: 65_000, endedAt: NOW - 120_000 }}
      />
    )
    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(container.textContent).toMatch(/Nothing needs you\s*· last wait 1m 05s, agent-z, answered at /)
  })
})

describe('waitLevel', () => {
  it('escalates at 2 and 10 minutes', () => {
    expect(waitLevel(0)).toBe('normal')
    expect(waitLevel(WAIT_WARN_MS - 1)).toBe('normal')
    expect(waitLevel(WAIT_WARN_MS)).toBe('warn')
    expect(waitLevel(WAIT_CRITICAL_MS - 1)).toBe('warn')
    expect(waitLevel(WAIT_CRITICAL_MS)).toBe('critical')
  })
})

describe('reason chip', () => {
  afterEach(cleanup)

  it('tags the chip and row with the reason tone and wait level', () => {
    render(
      <NeedsYouPanel
        sessions={[
          waiting('p', NOW - 11 * 60_000, { waitingReason: 'permission' }),
          waiting('q', NOW - 3 * 60_000, { waitingReason: 'question' }),
          waiting('o', NOW - 1000)
        ]}
        now={NOW}
        showProvider={false}
        onJumpToAgent={vi.fn()}
      />
    )
    const items = screen.getAllByRole('listitem')
    expect(items.map((i) => i.getAttribute('data-tone'))).toEqual(['permission', 'question', 'other'])
    expect(items.map((i) => i.getAttribute('data-level'))).toEqual(['critical', 'warn', 'normal'])
    expect(screen.getByText('Waiting for permission').getAttribute('data-tone')).toBe('permission')
  })
})

describe('keyboard triage', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  const sessions = () => [
    waiting('a', NOW - 90_000, { waitingText: 'Run: cargo test\nin /work' }),
    waiting('b', NOW - 60_000, { waitingText: 'Second question' }),
    waiting('c', NOW - 30_000)
  ]
  const item = (id: string) => document.querySelector<HTMLLIElement>(`li[data-agent-item="${id}"]`) as HTMLLIElement
  const setup = (extra: Partial<Parameters<typeof NeedsYouPanel>[0]> = {}, list = sessions()) => {
    const onJump = vi.fn()
    const onDetails = vi.fn()
    const utils = render(
      <NeedsYouPanel
        sessions={list}
        now={NOW}
        showProvider={false}
        onJumpToAgent={onJump}
        onOpenDetails={onDetails}
        {...extra}
      />
    )
    return { onJump, onDetails, ...utils }
  }

  it('makes only the selected item a tab stop', () => {
    setup()
    expect(['a', 'b', 'c'].map((id) => item(id).tabIndex)).toEqual([0, -1, -1])
  })

  it('moves with J/K and the arrow keys, clamped at the ends', () => {
    setup()
    item('a').focus()
    fireEvent.keyDown(item('a'), { key: 'j' })
    expect(document.activeElement).toBe(item('b'))
    expect(['a', 'b', 'c'].map((id) => item(id).tabIndex)).toEqual([-1, 0, -1])
    fireEvent.keyDown(item('b'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(item('c'))
    fireEvent.keyDown(item('c'), { key: 'J' })
    expect(document.activeElement).toBe(item('c'))
    fireEvent.keyDown(item('c'), { key: 'k' })
    expect(document.activeElement).toBe(item('b'))
    fireEvent.keyDown(item('b'), { key: 'ArrowUp' })
    fireEvent.keyDown(item('a'), { key: 'K' })
    expect(document.activeElement).toBe(item('a'))
  })

  it('jumps with Enter and opens the details with D, using the item as trigger', () => {
    const { onJump, onDetails } = setup()
    item('b').focus()
    fireEvent.keyDown(item('b'), { key: 'Enter' })
    expect(onJump).toHaveBeenCalledWith('b')
    fireEvent.keyDown(item('b'), { key: 'd' })
    expect(onDetails).toHaveBeenCalledWith('b', item('b'))
  })

  it('leaves Enter to a focused button and ignores modified keys', () => {
    const { onJump, onDetails } = setup()
    const jump = screen.getByRole('button', { name: 'Jump to agent-b' })
    fireEvent.keyDown(jump, { key: 'Enter' })
    expect(onJump).not.toHaveBeenCalled()
    fireEvent.keyDown(item('a'), { key: 'd', ctrlKey: true })
    fireEvent.keyDown(item('a'), { key: 's', metaKey: true })
    fireEvent.keyDown(item('a'), { key: 'j', altKey: true })
    expect(onDetails).not.toHaveBeenCalled()
    expect(screen.queryByText(/snoozed/)).toBeNull()
  })

  it('does not react to keys pressed outside the list', () => {
    const { onJump } = setup()
    fireEvent.keyDown(document.body, { key: 'Enter' })
    fireEvent.keyDown(document.body, { key: 's' })
    expect(onJump).not.toHaveBeenCalled()
    expect(screen.queryByText(/snoozed/)).toBeNull()
  })

  it('shows the full waiting text only on the selected item', () => {
    setup()
    expect(item('a').getAttribute('data-selected')).toBe('true')
    expect(item('a').className).toMatch(/selected/)
    expect(item('b').className).not.toMatch(/selected/)
    fireEvent.focus(item('b'))
    expect(item('b').className).toMatch(/selected/)
    expect(item('a').className).not.toMatch(/selected/)
  })

  it('snoozes with S, moves focus on, and lists the item as snoozed', () => {
    setup()
    item('a').focus()
    fireEvent.keyDown(item('a'), { key: 's' })
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('data-agent-item'))).toEqual(['b', 'c'])
    expect(document.activeElement).toBe(item('b'))
    expect(item('b').tabIndex).toBe(0)
    expect(JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}')).toEqual({ [`a@${NOW - 90_000}`]: NOW + SNOOZE_MS })

    const toggle = screen.getByRole('button', { name: '1 snoozed · Show' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Unsnooze agent-a' })).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.textContent).toBe('1 snoozed · Hide')
    fireEvent.click(screen.getByRole('button', { name: 'Unsnooze agent-a' }))
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('data-agent-item'))).toEqual(['a', 'b', 'c'])
    expect(screen.queryByText(/snoozed/)).toBeNull()
    expect(localStorage.getItem(SNOOZE_KEY)).toBeNull()
  })

  it('shows the all-clear plus the snoozed line when everything is snoozed', () => {
    setup({}, [waiting('a', NOW - 1000)])
    item('a').focus()
    fireEvent.keyDown(item('a'), { key: 's' })
    expect(screen.getByText('Nothing needs you')).toBeTruthy()
    expect(screen.getByRole('button', { name: '1 snoozed · Show' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '1 snoozed · Show' }))
  })

  it('does not hide a new wait of the same agent, and prunes expired snoozes', () => {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ [`a@${NOW - 1000}`]: NOW + 5000, [`gone@1`]: NOW - 1 }))
    const { rerender } = setup({}, [waiting('a', NOW - 1000)])
    expect(screen.queryByRole('listitem')).toBeNull()
    expect(screen.getByRole('button', { name: '1 snoozed · Show' })).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}')).toEqual({ [`a@${NOW - 1000}`]: NOW + 5000 })

    // A new wait of agent a starts later: a different statusSince.
    rerender(
      <NeedsYouPanel sessions={[waiting('a', NOW - 10)]} now={NOW} showProvider={false} onJumpToAgent={vi.fn()} />
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText(/snoozed/)).toBeNull()

    // The old snooze runs out.
    rerender(
      <NeedsYouPanel sessions={[waiting('a', NOW - 1000)]} now={NOW + 6000} showProvider={false} onJumpToAgent={vi.fn()} />
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(localStorage.getItem(SNOOZE_KEY)).toBeNull()
  })

  it('renders the key hint', () => {
    render(<KeyboardHint />)
    expect(document.body.textContent).toContain('move')
    expect(document.querySelectorAll('kbd')).toHaveLength(5)
  })
})
