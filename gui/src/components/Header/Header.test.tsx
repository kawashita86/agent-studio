// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Header } from './Header'

vi.mock('../Usage/UsageMenu', () => ({ UsageMenu: () => null }))
vi.mock('./OpenInButton', () => ({ OpenInButton: () => null }))

function renderHeader(collapsed: boolean, onToggleSidebar = vi.fn()) {
  render(
    <Header
      viewMode="chat"
      onSelectViewMode={vi.fn()}
      sidebarCollapsed={collapsed}
      sidebarId="app-sidebar"
      onToggleSidebar={onToggleSidebar}
      onOpenNewAgent={vi.fn()}
      globalYolo={false}
      onToggleGlobalYolo={vi.fn()}
      onOpenSettings={vi.fn()}
      onOpenHeadless={vi.fn()}
      usage={null}
      onOpenUsage={vi.fn()}
      onOpenUpdates={vi.fn()}
      showUpdateAction={false}
      updateReadyToInstall={false}
      updateAvailable={false}
      projectDir={null}
      defaultEditor="vscode"
      onSetDefaultEditor={vi.fn()}
    />
  )
  return onToggleSidebar
}

describe('Header sidebar toggle', () => {
  afterEach(cleanup)

  it('offers to hide an open sidebar and reports aria state', () => {
    const onToggle = renderHeader(false)
    const button = screen.getByRole('button', { name: 'Hide sidebar' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-controls')).toBe('app-sidebar')
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('offers to show a collapsed sidebar', () => {
    renderHeader(true)
    const button = screen.getByRole('button', { name: 'Show sidebar' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })
})
