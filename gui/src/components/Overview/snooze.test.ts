// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { activeSnoozes, readSnoozes, SNOOZE_KEY, SNOOZE_MS, snoozeKey, useSnoozes } from './snooze'

const NOW = 5_000_000

describe('snooze storage', () => {
  beforeEach(() => localStorage.clear())

  it('keys by agent and wait start', () => {
    expect(snoozeKey('a', 7)).toBe('a@7')
  })

  it('drops expired entries', () => {
    expect(activeSnoozes({ 'a@1': NOW - 1, 'b@2': NOW, 'c@3': NOW + 1 }, NOW)).toEqual({ 'c@3': NOW + 1 })
  })

  it('reads tolerantly', () => {
    expect(readSnoozes(NOW)).toEqual({})
    localStorage.setItem(SNOOZE_KEY, 'not json')
    expect(readSnoozes(NOW)).toEqual({})
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ 'a@1': 'x', 'b@2': NOW + 5 }))
    expect(readSnoozes(NOW)).toEqual({ 'b@2': NOW + 5 })
  })

  it('snoozes for 15 minutes, never hides a new wait, unsnoozes and prunes', () => {
    const { result, rerender } = renderHook(({ now }) => useSnoozes(now), { initialProps: { now: NOW } })
    act(() => result.current.snooze('a', 100))
    expect(result.current.isSnoozed('a', 100)).toBe(true)
    expect(result.current.isSnoozed('a', 200)).toBe(false)
    expect(JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}')).toEqual({ 'a@100': NOW + SNOOZE_MS })

    act(() => result.current.unsnooze('a', 100))
    expect(result.current.isSnoozed('a', 100)).toBe(false)
    expect(localStorage.getItem(SNOOZE_KEY)).toBeNull()

    act(() => result.current.snooze('a', 100))
    rerender({ now: NOW + SNOOZE_MS })
    expect(result.current.isSnoozed('a', 100)).toBe(false)
    expect(localStorage.getItem(SNOOZE_KEY)).toBeNull()
  })
})
