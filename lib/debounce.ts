/**
 * A minimal, framework-free debounce controller — not tied to React,
 * so it's testable with fake timers alone, with no component mount
 * required. `call` schedules `fn` after `delayMs`, resetting the timer
 * on every subsequent call within that window (only the LATEST
 * scheduled call ever actually fires — earlier ones are silently
 * superseded, never queued). `flush` cancels any pending timer and
 * runs `fn` immediately with the given args instead — this is exactly
 * "Enter triggers immediately," and it also prevents the pending
 * debounced call from firing again afterward. `cancel` discards a
 * pending call without running it at all (used on unmount, or when a
 * query is cleared and the caller wants to react synchronously
 * instead).
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number
): {
  call: (...args: Args) => void
  flush: (...args: Args) => void
  cancel: () => void
} {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  function clear() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return {
    call(...args: Args) {
      clear()
      timeoutId = setTimeout(() => {
        timeoutId = null
        fn(...args)
      }, delayMs)
    },
    flush(...args: Args) {
      clear()
      fn(...args)
    },
    cancel() {
      clear()
    },
  }
}
