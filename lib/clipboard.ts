/**
 * lib/clipboard.ts — Clipboard writes with reliable auto-clear
 *
 * navigator.clipboard.writeText() only succeeds while the document is focused.
 * The normal flow — copy a password, switch to another app to paste it — leaves
 * this tab unfocused when the 30-second clear fires, so a bare setTimeout(clear)
 * throws NotAllowedError and the password stays in the clipboard indefinitely.
 *
 * This module tracks when a clear is due and retries it the moment the window
 * regains focus or visibility. lock() can also force an immediate clear via
 * clearClipboardNow().
 *
 * Known limitation: the clear overwrites whatever is in the clipboard at that
 * moment. Checking first would require clipboard READ permission (an extra
 * browser prompt), so we accept the trade-off — same as other password managers.
 */

const CLIPBOARD_CLEAR_DELAY_MS = 30_000

// Epoch ms when the clipboard must be cleared; null = no secret pending
let clearDueAt: number | null = null
let clearTimer: ReturnType<typeof setTimeout> | null = null

/** Copies a secret to the clipboard and schedules an auto-clear. */
export async function copyWithAutoClear(
  text: string,
  delayMs: number = CLIPBOARD_CLEAR_DELAY_MS
): Promise<void> {
  await navigator.clipboard.writeText(text)
  clearDueAt = Date.now() + delayMs
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = setTimeout(() => { void attemptClear() }, delayMs)
}

/**
 * Immediately clears the clipboard if a copied secret is still pending.
 * Called on every lock. Best-effort: if the tab is unfocused the write fails,
 * but the due-time stays set and the focus listener retries.
 */
export async function clearClipboardNow(): Promise<void> {
  if (clearDueAt === null) return
  clearDueAt = 0
  await attemptClear()
}

async function attemptClear(): Promise<void> {
  if (clearDueAt === null || Date.now() < clearDueAt) return
  try {
    await navigator.clipboard.writeText('')
    clearDueAt = null
    if (clearTimer) {
      clearTimeout(clearTimer)
      clearTimer = null
    }
  } catch {
    // Document not focused — the listeners below retry when it is.
  }
}

// If the clear came due while the tab was unfocused, retry as soon as the
// user returns. Registered once at module load (client bundles only).
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => { void attemptClear() })
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void attemptClear()
  })
}
