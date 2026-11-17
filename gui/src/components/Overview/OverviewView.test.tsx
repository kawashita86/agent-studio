// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OverviewSession, OverviewSnapshot } from '@shared/overview/types'
import { computeCounts } from '@shared/overview/status'
import { OverviewView } from './OverviewView'

function session(id: string, projectDir: string, status: OverviewSession['status'] = 'working'): OverviewSession {
  return {
    agentId: id,
    name: `agent-${id}`,
    provider: 'claude',
    model: 'sonnet',
    projectDir,
    worktreeBranch: null,
    status,
    statusSince: 0,
    stale: false,
    pid: null,
    startedAt: 0,
    lastOutputAt: 0
  } as OverviewSession
}

function snapshotOf(sessions: OverviewSession[]): OverviewSnapshot {
  return { at: Date.now(), sessions, counts: computeCounts(sessions, Date.now()) }
}

const mockSnapshot = (sessions: OverviewSession[]) => {
  window.hydra = {
    ...window.hydra,
    getOverview: vi.fn().mockResolvedValue(snapshotOf(sessions)),
    onOverviewSnapshot: vi.fn().mockReturnValue(() => undefined)
  }
}

function chipCount(label: string): string | null | undefined {
  const strip = screen.getByRole('group', { name: 'Agent status' })
  return within(strip).getByText(label, { selector: 'span' }).previousElementSibling?.textContent
}

describe('OverviewView', () => {
  afterEach(cleanup)

  beforeEach(() => {
    window.localStorage.clear()
  })

  it('filters sessions by project and remembers the choice', async () => {
    mockSnapshot([
      session('1', '/work/alpha'),
      session('2', '/work/beta'),
      session('3', '/work/beta', 'needs-you')
    ])
    render(<OverviewView />)

    const select = (await screen.findByLabelText('Project filter')) as HTMLSelectElement
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All projects',
      'alpha',
      'beta'
    ])
    expect(chipCount('Working')).toBe('2')

    fireEvent.change(select, { target: { value: '/work/beta' } })

    expect(screen.queryByText('agent-1')).toBeNull()
    expect(screen.getAllByText('agent-2').length).toBeGreaterThan(0)
    expect(chipCount('Working')).toBe('1')
    expect(window.localStorage.getItem('agentStudio.overview.projectFilter')).toBe('/work/beta')
  })

  it('puts Needs you and Sessions first, full width, before the other cards', async () => {
    mockSnapshot([session('1', '/work/alpha'), session('2', '/work/alpha', 'needs-you')])
    render(<OverviewView />)
    await screen.findByLabelText('Project filter')
    const order = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
    expect(order.indexOf('Needs you')).toBeLessThan(order.indexOf('Sessions'))
    expect(order.indexOf('Sessions')).toBeLessThan(order.indexOf('Last hour'))
    expect(screen.queryByText(/need you · /)).toBeNull()
  })

  it('filters the Sessions card from a status chip and clears it again', async () => {
    mockSnapshot([session('1', '/work/alpha'), session('2', '/work/alpha', 'finished')])
    render(<OverviewView />)
    const finished = await screen.findByRole('button', { name: /^\d+\s*Finished/, pressed: false })
    expect(screen.getByText('agent-1')).toBeTruthy()
    fireEvent.click(finished)
    expect(finished.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText('agent-1')).toBeNull()
    expect(screen.getByText('agent-2')).toBeTruthy()
    expect(screen.getByText(/Filtered: Finished/)).toBeTruthy()
    fireEvent.click(finished)
    expect(screen.getByText('agent-1')).toBeTruthy()
    fireEvent.click(finished)
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter: Finished' }))
    expect(screen.getByText('agent-1')).toBeTruthy()
  })

  it('opens and closes the history chart from the chart button', async () => {
    mockSnapshot([session('1', '/work/alpha')])
    render(<OverviewView />)
    const trigger = await screen.findByRole('button', { name: 'Working history' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: 'Working history' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close chart' }))
    expect(screen.queryByRole('region', { name: 'Working history' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('restores the stored filter and falls back to All when the project is gone', async () => {
    window.localStorage.setItem('agentStudio.overview.projectFilter', '/work/gone')
    mockSnapshot([session('1', '/work/alpha')])
    render(<OverviewView />)
    const select = (await screen.findByLabelText('Project filter')) as HTMLSelectElement
    expect(select.value).toBe('')
    expect(screen.getByText('agent-1')).toBeTruthy()
  })

  it('shows an empty state with a New Agent button when there are no agents', async () => {
    mockSnapshot([])
    const onOpenNewAgent = vi.fn()
    render(<OverviewView onOpenNewAgent={onOpenNewAgent} />)
    fireEvent.click(await screen.findByText('New Agent'))
    expect(onOpenNewAgent).toHaveBeenCalledTimes(1)
  })

  it('shows an error state when the overview is unavailable', async () => {
    window.hydra = {
      ...window.hydra,
      getOverview: vi.fn().mockRejectedValue(new Error('404')),
      onOverviewSnapshot: vi.fn().mockReturnValue(() => undefined)
    }
    render(<OverviewView />)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
