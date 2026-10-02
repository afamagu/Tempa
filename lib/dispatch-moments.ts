/** Keep every attachment in input order, including repeated paragraph positions. */
export function groupDispatchMoments<T extends { position: number }>(moments: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>()
  for (const moment of moments) {
    const existing = grouped.get(moment.position)
    if (existing) existing.push(moment)
    else grouped.set(moment.position, [moment])
  }
  return grouped
}
