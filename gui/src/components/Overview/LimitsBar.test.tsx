// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsagePeriod, UsageState } from '@shared/usage/types'
import { NOW, profile, summaryOf, usageState } from '../Usage/fixtures'
import { LimitsBar, shortLimitLabel } from './LimitsBar'

const getUsageSummary = vi.fn(async (period: UsagePeriod, _projectKey?: string) => summaryOf(period))
const setUsageVisible = vi.fn(async () => {})

function renderBar(state: UsageState | null = usageState(), projectDir = '') {
  const onOpenReport = vi.fn()
  const { container } = render(<LimitsBar state={state} projectDir={projectDir} onOpenReport={onOpenReport} />)
  return { onOpenReport, container }
}

describe('LimitsBar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    getUsageSummary.mockClear()
    getUsageSummary.mockImplementation(async (period) => summaryOf(period))
    setUsageVisible.mockClear()
    ;(window as unknown as { hydra: unknown }).hydra = { getUsageSummary, setUsageVisible }
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows at most four limit bars with short labels, percent and a tooltip', async () => {
    renderBar()
    await screen.findByText('48.2M')
    const bars = screen.getAllByRole('progressbar')
    expect(bars).toHaveLength(4)
    expect(screen.getByText('Claude default 5h')).toBeTruthy()
    expect(screen.getByText('29%')).toBeTruthy()
    const first = bars[0].parentElement!
    expect(first.getAttribute('title')).toBe('Claude default · session (5h) · 29% used · resets in 1h 48m')
    expect(first.getAttribute('data-severity')).toBe('ok')
  })

  it('shows today tokens for the project and opens the report', async () => {
    const { onOpenReport } = renderBar(usageState(), '/work/alpha')
    await waitFor(() => expect(getUsageSummary).toHaveBeenCalledWith('today', '/work/alpha'))
    expect(await screen.findByText(/tokens today · alpha/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Usage report' }))
    expect(onOpenReport).toHaveBeenCalledTimes(1)
  })

  it('renders nothing while the state is loading and fetches nothing', () => {
    const { container } = renderBar(null)
    expect(container.firstChild).toBeNull()
    expect(getUsageSummary).not.toHaveBeenCalled()
  })

  it('renders nothing with no limit tiles and zero tokens', async () => {
    getUsageSummary.mockImplementation(async (period) => summaryOf(period, { totalTokens: 0 }))
    const { container } = renderBar(usageState({ claude: [] }))
    await waitFor(() => expect(getUsageSummary).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('skips accounts with a problem instead of a window', async () => {
    renderBar(usageState({ claude: [profile('work', { plan: null, status: 'expired', windows: [], fetchedAt: null })] }))
    await screen.findByText('48.2M')
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0)
  })

  it('tells the service it is visible', () => {
    renderBar()
    expect(setUsageVisible).toHaveBeenCalled()
  })
})

describe('shortLimitLabel', () => {
  it('shortens the window names', () => {
    expect(shortLimitLabel('Claude · session (5h)')).toBe('Claude 5h')
    expect(shortLimitLabel('Codex · weekly')).toBe('Codex week')
    expect(shortLimitLabel('Claude alternative · weekly Sonnet')).toBe('Claude alternative weekly Sonnet')
  })
})
