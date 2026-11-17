/**
 * Stops xterm.js from re-sending stale text when an input method (IBus on
 * WebKitGTK) is active.
 *
 * With an input method running, WebKitGTK reports printable keydowns as
 * `keyCode === 229` ("Process"). xterm.js then does not send the key itself:
 * it snapshots its hidden helper textarea and, in a `setTimeout(0)`, sends
 * `newValue.replace(oldValue, '')` (or the WHOLE value when the length is
 * unchanged). The textarea accumulates typed text and IBus edits it (surrounding
 * text), and two fast keydowns can both snapshot before either timeout runs, so
 * old text gets re-sent: "and do" became "and é      TH     T      é  do".
 *
 * Worse, IBus commits keys like è/é/ò (Italian layout) as a 229 keydown + `insertFromComposition` + `compositionend` with
 * NO `compositionstart`: xterm's composition helper then has a stale start offset and sends the whole textarea on
 * compositionend. The guard sends such a one-shot commit's `data` itself and swallows its compositionend.
 *
 * This guard replaces that diff with the authoritative `InputEvent.data`:
 *  - a 229 keydown outside a composition is blocked (the custom key handler
 *    returns false), so xterm never diffs the textarea;
 *  - the following `input` event is sent from `data` and stopped before xterm's
 *    own listener, then the textarea is cleared so it never accumulates;
 *  - a 229 Backspace is sent as DEL straight from the keydown (the cleared
 *    textarea has nothing to delete, so IBus may emit no input event at all);
 *    a later `deleteContentBackward` for it is swallowed.
 *
 * Real compositions (CJK etc., between compositionstart and compositionend) are
 * left entirely to xterm.
 *
 * Rule for taking over an `input` event: only an `insertText`/`deleteContentBackward`
 * on xterm's textarea, outside a composition, AND only while a blocked 229
 * keydown is still waiting for its input (a counter, expiring after
 * IME_PENDING_WINDOW_MS). Input events with nothing pending (e.g. one that
 * trails compositionend, which xterm's composition helper already handles) are
 * left to xterm. The counter makes both orderings work: IBus commits can
 * arrive before or after the keyup, and two keydowns can precede both commits.
 */

export interface ImeTerminal {
  readonly textarea?: HTMLTextAreaElement
}

/** A blocked 229 keydown whose input event has not arrived after this long is forgotten. */
export const IME_PENDING_WINDOW_MS = 1000

const NON_TEXT_CODE = /^(Arrow|Enter|NumpadEnter|Tab|Escape|F\d|Home|End|Page|Delete|Insert|Shift|Control|Alt|Meta|CapsLock|ContextMenu)/

export interface ImeInputGuard {
  /** For the custom key handler: true when the keydown must be hidden from xterm. */
  blockKeydown(e: KeyboardEvent): boolean
  dispose(): void
}

export function installImeInputGuard(
  wrapper: HTMLElement,
  terminal: ImeTerminal,
  send: (data: string) => void,
  now: () => number = Date.now
): ImeInputGuard {
  let composing = false
  let pendingText = 0
  let swallowDeletes = 0 // deletes already sent from a 229 Backspace keydown
  let lastBlockedAt = 0

  const expire = () => {
    if (now() - lastBlockedAt > IME_PENDING_WINDOW_MS) {
      pendingText = 0
      swallowDeletes = 0
    }
  }

  const blockKeydown = (e: KeyboardEvent): boolean => {
    if (e.type !== 'keydown') return false
    if (e.keyCode !== 229 && e.key !== 'Process') return false
    if (composing || e.isComposing) return false
    expire()
    lastBlockedAt = now()
    if (e.code === 'Backspace' || e.key === 'Backspace') {
      send('\x7f')
      swallowDeletes++
    } else if (!NON_TEXT_CODE.test(e.code ?? '')) {
      pendingText++
    }
    return true
  }

  // A one-shot commit already sent by onInput: the compositionend that follows it must not reach xterm.
  let swallowCompositionEnd = false

  const onCompositionStart = () => {
    composing = true
    pendingText = 0
    swallowDeletes = 0
    swallowCompositionEnd = false
  }
  const onCompositionEnd = (e: Event) => {
    if (e.target !== terminal.textarea) return
    composing = false
    if (swallowCompositionEnd) {
      swallowCompositionEnd = false
      e.stopImmediatePropagation()
      if (terminal.textarea) terminal.textarea.value = ''
    }
  }

  const onInput = (e: Event) => {
    const ev = e as InputEvent
    const textarea = terminal.textarea
    if (!textarea || ev.target !== textarea) return
    if (composing) return
    expire()
    if (ev.inputType === 'insertFromComposition' && ev.data) {
      // IBus on WebKitGTK commits dead-key-free accented keys (è, é, ò, à, ù on the Italian layout) as
      // `insertFromComposition` + `compositionend` WITHOUT a `compositionstart`. xterm's composition helper then has a stale
      // start offset and sends the WHOLE textarea on compositionend (" è", then "é ò"...). Send the committed text ourselves.
      if (pendingText > 0) pendingText-- // the 229 keydown of this key
      swallowCompositionEnd = true
      send(ev.data)
    } else if (ev.isComposing) {
      return
    } else if (ev.inputType === 'insertText' && ev.data) {
      if (pendingText <= 0) {
        // xterm already sent this key from keydown/keypress (e.g. Space, which WebKit still inserts into the textarea):
        // leave the event to xterm but keep the textarea empty so stale text can never be re-sent later.
        textarea.value = ''
        return
      }
      pendingText--
      send(ev.data)
    } else if (ev.inputType === 'deleteContentBackward') {
      if (swallowDeletes > 0) swallowDeletes--
      else return
    } else {
      return
    }
    ev.stopImmediatePropagation()
    textarea.value = ''
  }

  // Capture phase: runs before xterm.js's own listeners on its textarea.
  wrapper.addEventListener('compositionstart', onCompositionStart, true)
  wrapper.addEventListener('compositionend', onCompositionEnd, true)
  wrapper.addEventListener('input', onInput, true)

  return {
    blockKeydown,
    dispose: () => {
      wrapper.removeEventListener('compositionstart', onCompositionStart, true)
      wrapper.removeEventListener('compositionend', onCompositionEnd, true)
      wrapper.removeEventListener('input', onInput, true)
    },
  }
}
