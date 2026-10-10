/** Coalesce input without serializing the document in the typing callback. */
export function createDraftSaveQueue(save: () => boolean, failed: () => void, delay = 300, maxWait = 1200) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  const cancel = () => {
    clearTimeout(timer)
    clearTimeout(deadline)
    timer = deadline = undefined
    dirty = false
  }
  const flush = () => {
    if (!dirty) return true
    cancel()
    try {
      if (save()) return true
    } catch { /* Storage can be unavailable in private mode or at quota. */ }
    dirty = true // Keep the in-memory draft eligible for a later lifecycle retry.
    failed()
    return false
  }
  return {
    schedule() {
      dirty = true
      clearTimeout(timer)
      timer = setTimeout(flush, delay)
      deadline ??= setTimeout(flush, maxWait)
    },
    flush,
    cancel,
  }
}
