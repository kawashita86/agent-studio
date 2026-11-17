// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IME_PENDING_WINDOW_MS, installImeInputGuard, type ImeInputGuard } from './imeInputGuard'

describe('installImeInputGuard', () => {
  let wrapper: HTMLDivElement
  let textarea: HTMLTextAreaElement
  let sent: string[]
  let xtermInput: ReturnType<typeof vi.fn>
  let guard: ImeInputGuard
  let clock: number

  const keydown = (init: KeyboardEventInit & { keyCode?: number }) => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    // jsdom honours keyCode in the init dict; make sure either way.
    if (init.keyCode !== undefined && e.keyCode !== init.keyCode) {
      Object.defineProperty(e, 'keyCode', { value: init.keyCode })
    }
    // What xterm's custom key handler wiring does.
    const blocked = guard.blockKeydown(e)
    return blocked
  }
  const ime = (code = 'KeyA') => keydown({ keyCode: 229, key: 'Process', code })
  const keyup = () => textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
  const input = (inputType: string, data: string | null, isComposing = false) => {
    textarea.value += data ?? ''
    textarea.dispatchEvent(new InputEvent('input', { inputType, data, isComposing, bubbles: true }))
  }
  const comp = (type: string, data = '') =>
    textarea.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }))

  beforeEach(() => {
    wrapper = document.createElement('div')
    textarea = document.createElement('textarea')
    wrapper.appendChild(textarea)
    document.body.appendChild(wrapper)
    sent = []
    clock = 1000
    xtermInput = vi.fn()
    textarea.addEventListener('input', xtermInput) // stands in for xterm's _inputEvent
    guard = installImeInputGuard(wrapper, { textarea }, (d) => sent.push(d), () => clock)
  })

  afterEach(() => {
    guard.dispose()
    wrapper.remove()
  })

  it('sends a plain IME commit from InputEvent.data and hides it from xterm', () => {
    expect(ime()).toBe(true)
    input('insertText', 'a')
    expect(sent).toEqual(['a'])
    expect(xtermInput).not.toHaveBeenCalled()
    expect(textarea.value).toBe('')
  })

  it('does not re-send stale textarea content on fast typing', () => {
    textarea.value = 'previous message'
    ime('KeyD')
    ime('KeyO')
    input('insertText', 'd')
    input('insertText', 'o')
    expect(sent).toEqual(['d', 'o'])
    expect(textarea.value).toBe('')
  })

  it('handles a commit arriving after keyup', () => {
    ime()
    keyup()
    input('insertText', 'x')
    expect(sent).toEqual(['x'])
  })

  it('handles a commit arriving before keyup', () => {
    ime()
    input('insertText', 'x')
    keyup()
    expect(sent).toEqual(['x'])
  })

  it('leaves a real composition alone', () => {
    comp('compositionstart')
    expect(ime()).toBe(false)
    input('insertCompositionText', 'に', true)
    input('insertText', 'に')
    comp('compositionend', 'に')
    expect(sent).toEqual([])
    expect(xtermInput).toHaveBeenCalledTimes(2)
  })

  it('does not touch input events with no blocked 229 keydown pending', () => {
    input('insertText', 'x')
    expect(sent).toEqual([])
    expect(xtermInput).toHaveBeenCalledTimes(1)
  })

  it('does not interfere with normal keys', () => {
    expect(keydown({ keyCode: 65, key: 'a', code: 'KeyA' })).toBe(false)
    expect(keydown({ keyCode: 13, key: 'Enter', code: 'Enter', shiftKey: true })).toBe(false)
    expect(sent).toEqual([])
  })

  it('does not take over input on another element', () => {
    const other = document.createElement('input')
    wrapper.appendChild(other)
    const spy = vi.fn()
    other.addEventListener('input', spy)
    ime()
    other.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'z', bubbles: true }))
    expect(sent).toEqual([])
    expect(spy).toHaveBeenCalled()
  })

  it('sends DEL once for a 229 Backspace, with or without a following delete input', () => {
    expect(keydown({ keyCode: 229, key: 'Process', code: 'Backspace' })).toBe(true)
    expect(sent).toEqual(['\x7f'])
    input('deleteContentBackward', null)
    expect(sent).toEqual(['\x7f'])
    expect(xtermInput).not.toHaveBeenCalled()
  })

  it('forgets a blocked keydown whose input never arrives', () => {
    ime()
    clock += IME_PENDING_WINDOW_MS + 1
    input('insertText', 'x')
    expect(sent).toEqual([])
    expect(xtermInput).toHaveBeenCalledTimes(1)
  })

  it('stops after dispose', () => {
    guard.dispose()
    ime()
    input('insertText', 'x')
    expect(sent).toEqual([])
  })

  // Sequences recorded on Wayland + IBus + Italian layout (WebKitGTK): accented keys come as a 229 keydown, then
  // insertFromComposition + compositionend with NO compositionstart; Space is sent by xterm but also lands in the textarea.
  describe('one-shot IBus commits (accented keys, no compositionstart)', () => {
    let xtermCompositionEnd: ReturnType<typeof vi.fn>
    beforeEach(() => {
      xtermCompositionEnd = vi.fn()
      textarea.addEventListener('compositionend', xtermCompositionEnd) // stands in for xterm's composition helper
    })
    const accented = (ch: string) => {
      ime('Unidentified')
      input('insertFromComposition', ch, true)
      comp('compositionend', ch)
    }
    const space = () => {
      // xterm sends the space itself from keypress; WebKit still inserts it into the textarea.
      input('insertText', ' ')
    }

    it('sends only the accented char, never the accumulated textarea', () => {
      space()
      accented('è')
      space()
      accented('é')
      space()
      accented('ò')
      expect(sent).toEqual(['è', 'é', 'ò'])
      expect(xtermCompositionEnd).not.toHaveBeenCalled()
      expect(textarea.value).toBe('')
    })

    it('leaves the Space input to xterm and does not send it twice after an accented key', () => {
      accented('è')
      space()
      expect(sent).toEqual(['è'])
      expect(xtermInput).toHaveBeenCalledTimes(1) // the space input event reached xterm (which ignores it: already sent)
      expect(textarea.value).toBe('')
    })

    it('still leaves a real composition (with compositionstart) to xterm', () => {
      comp('compositionstart')
      input('insertCompositionText', 'に', true)
      input('insertFromComposition', 'に', true)
      comp('compositionend', 'に')
      expect(sent).toEqual([])
      expect(xtermCompositionEnd).toHaveBeenCalledTimes(1)
    })
  })
})

