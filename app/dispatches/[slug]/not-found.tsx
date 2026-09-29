import DispatchUnavailable from '@/app/d/[shareToken]/dispatch-unavailable'

/** Any slug that is not public on the web right now — unknown, members-
 * only, hidden, unpublished or deleted — gets the same calm page with a
 * real 404 status, never a 200 shell and never its former content. */
export default function PublicDispatchNotFound() {
  return <DispatchUnavailable />
}
