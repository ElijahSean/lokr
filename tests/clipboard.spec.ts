/**
 * tests/clipboard.spec.ts — the 30-second clear and its retry on focus
 *
 * lib/clipboard.ts keeps module-level state (when a clear is due) and adds
 * window/document listeners when it is first imported. So each test stubs a
 * fresh window, document and clipboard, then imports a fresh copy of the
 * module: an older copy's listeners stay on the old stubs and never fire.
 *
 * Fake timers also fake Date, which attemptClear() compares against.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

type Clipboard = typeof import('@/lib/clipboard')

let clipboard: Clipboard
let contents: string
let unfocused: boolean   // while true, writeText fails the way a real unfocused tab does
let win: EventTarget
let doc: EventTarget & { hidden: boolean }
const writeText = vi.fn(async (text: string) => {
  if (unfocused) throw new DOMException('Document is not focused.', 'NotAllowedError')
  contents = text
})

/** Lets the async work started by a timer or event listener finish. */
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(async () => {
  vi.useFakeTimers()
  contents = ''
  unfocused = false
  writeText.mockClear()
  win = new EventTarget()
  doc = Object.assign(new EventTarget(), { hidden: false })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  vi.resetModules()
  clipboard = await import('@/lib/clipboard')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('copyWithAutoClear', () => {
  it('copies the secret and clears it after 30 seconds, not before', async () => {
    await clipboard.copyWithAutoClear('s3cret')
    expect(contents).toBe('s3cret')

    await vi.advanceTimersByTimeAsync(29_999)
    expect(contents).toBe('s3cret')

    await vi.advanceTimersByTimeAsync(1)
    expect(contents).toBe('')
  })

  // The normal flow: copy, switch to another app to paste, and the 30-second
  // clear fires while this tab is unfocused (CLAUDE.md, Clipboard auto-clear).
  it('retries a clear that failed while unfocused when the window regains focus', async () => {
    await clipboard.copyWithAutoClear('s3cret')
    unfocused = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(contents).toBe('s3cret')

    unfocused = false
    win.dispatchEvent(new Event('focus'))
    await settle()
    expect(contents).toBe('')
  })

  it('retries when the tab becomes visible again', async () => {
    await clipboard.copyWithAutoClear('s3cret')
    unfocused = true
    await vi.advanceTimersByTimeAsync(30_000)

    unfocused = false
    doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(contents).toBe('')
  })

  // Control for the two above: focus alone must not clear early
  it('does not clear on focus before the 30 seconds are up', async () => {
    await clipboard.copyWithAutoClear('s3cret')
    await vi.advanceTimersByTimeAsync(10_000)
    win.dispatchEvent(new Event('focus'))
    await settle()
    expect(contents).toBe('s3cret')
  })
})

describe('clearClipboardNow', () => {
  it('clears at once when a copied secret is pending (called on lock)', async () => {
    await clipboard.copyWithAutoClear('s3cret')
    await vi.advanceTimersByTimeAsync(1_000)
    await clipboard.clearClipboardNow()
    expect(contents).toBe('')
  })

  // Clearing overwrites whatever the user copied since, so with nothing of
  // ours pending it must leave the clipboard alone.
  it('does nothing when no secret is pending', async () => {
    await clipboard.clearClipboardNow()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('does nothing once the scheduled clear has already happened', async () => {
    await clipboard.copyWithAutoClear('s3cret')
    await vi.advanceTimersByTimeAsync(30_000)
    writeText.mockClear()
    await clipboard.clearClipboardNow()
    expect(writeText).not.toHaveBeenCalled()
  })
})
