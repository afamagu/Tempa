// Your Mark — Checkpoint 1 (engine audit + visual prototype), extended
// in Checkpoint 1B (organic geometry pass) with real contour tracing,
// path simplification, and curve smoothing — replacing the "smooth
// upscale of a small grid" approach, which read as softly-smoothed but
// still grid-aligned/blocky rather than genuinely flowing. Every
// function in this file is pure and DOM-free on purpose: no Canvas, no
// Image, no File — just plain arrays/numbers in, plain arrays/numbers
// out. That is what makes this module directly unit-testable in this
// repo's node-environment test runner (vitest.config.mts has no jsdom),
// matching the codebase's own established "extract pure logic for
// testability" convention (canWriteToMind, dispatchTitleError,
// canEditDispatch, ...). The browser-only orchestration (loading a
// File, drawing to a real <canvas>) lives in mark-engine.ts and calls
// into these functions — it owns none of the actual math itself.

export type RGB = [number, number, number]
export type HSL = [number, number, number]
export type Point = { x: number; y: number }

// ============================================================
// DETERMINISTIC HASHING + PRNG — never Math.random(). Given the same
// input numbers, hashInts always returns the same hash; given the same
// seed, createSeededRandom always returns the same infinite sequence.
// This is what makes texture/accent decisions reproducible per Mark
// while still varying between different people's Marks.
// ============================================================

/** FNV-1a over a flat list of integers — the same small, well-worn
 * hash shape already used elsewhere in this codebase (app/mindform.tsx,
 * app/minds/page.tsx's stableShuffle) for exactly this "stable,
 * non-cryptographic identifier" purpose. */
export function hashInts(values: ArrayLike<number>): number {
  let h = 2166136261
  for (let i = 0; i < values.length; i++) {
    h ^= values[i] & 0xff
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 — a tiny, well-known deterministic PRNG (public domain).
 * Returns a function producing floats in [0, 1); calling it repeatedly
 * from the same seed always replays the exact same sequence. */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0
  return function mulberry32() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ============================================================
// COLOUR
// ============================================================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function luminance([r, g, b]: RGB): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function colorDistanceSq(a: RGB, b: RGB): number {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return dr * dr + dg * dg + db * db
}

export function rgbToHsl([r, g, b]: RGB): HSL {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0)
      break
    case gn:
      h = (bn - rn) / d + 2
      break
    default:
      h = (rn - gn) / d + 4
  }
  return [h / 6, s, l]
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t
  if (tt < 0) tt += 1
  if (tt > 1) tt -= 1
  if (tt < 1 / 6) return p + (q - p) * 6 * tt
  if (tt < 1 / 2) return q
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
  return p
}

export function hslToRgb([h, s, l]: HSL): RGB {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r = hueToRgb(p, q, h + 1 / 3)
  const g = hueToRgb(p, q, h)
  const b = hueToRgb(p, q, h - 1 / 3)
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

/** Nudges a raw source-derived palette into a restrained, "premium
 * editorial" range — never fully desaturated (flat grey), never
 * shouting-saturated, and spread across enough lightness that regions
 * stay separable once downscaled to avatar size (Section G). Operates
 * entirely in HSL so hue — the actual source-derived colour
 * relationship — is preserved; only saturation/lightness are reined in. */
export function harmonizePalette(palette: RGB[]): RGB[] {
  return palette.map((rgb) => {
    const [h, s, l] = rgbToHsl(rgb)
    const harmonizedS = clamp(s * 0.82, 0.16, 0.6)
    const harmonizedL = clamp(l, 0.14, 0.88)
    return hslToRgb([h, harmonizedS, harmonizedL])
  })
}

// ============================================================
// PALETTE EXTRACTION (colour-space clustering)
// ============================================================

export function nearestPaletteIndex(color: RGB, palette: RGB[]): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < palette.length; i++) {
    const d = colorDistanceSq(color, palette[i])
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/**
 * Deterministic k-means over a flat RGB sample list. Deliberately
 * seeded by DETERMINISTIC selection (evenly-spaced samples after
 * sorting by luminance) rather than randomly, so palette extraction
 * itself needs no PRNG at all and two runs against identical samples
 * always converge to the identical centers, in the identical order.
 */
export function extractPalette(samples: RGB[], k: number, iterations = 6): RGB[] {
  if (samples.length === 0) return []
  const paletteSize = Math.max(1, Math.min(k, samples.length))

  const sorted = [...samples].sort((a, b) => luminance(a) - luminance(b))
  const centers: RGB[] = []
  for (let i = 0; i < paletteSize; i++) {
    const idx = paletteSize === 1 ? 0 : Math.round((i * (sorted.length - 1)) / (paletteSize - 1))
    centers.push(sorted[idx])
  }

  let assignments = new Int32Array(samples.length)
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < samples.length; i++) {
      assignments[i] = nearestPaletteIndex(samples[i], centers)
    }

    const sums = centers.map(() => [0, 0, 0, 0])
    for (let i = 0; i < samples.length; i++) {
      const c = assignments[i]
      sums[c][0] += samples[i][0]
      sums[c][1] += samples[i][1]
      sums[c][2] += samples[i][2]
      sums[c][3] += 1
    }
    for (let c = 0; c < centers.length; c++) {
      if (sums[c][3] > 0) {
        centers[c] = [
          Math.round(sums[c][0] / sums[c][3]),
          Math.round(sums[c][1] / sums[c][3]),
          Math.round(sums[c][2] / sums[c][3]),
        ]
      }
      // A center with zero members keeps its previous value rather than
      // being reseeded — deliberate: reseeding would need either
      // randomness (breaking determinism) or a second data-dependent
      // rule to pick a replacement, neither of which a prototype needs.
      // A near-flat source image (e.g. a plain wall) legitimately ends
      // up with fewer effectively-distinct colours than paletteSize.
    }
  }

  return centers
}

// ============================================================
// SPATIAL REGION SEGMENTATION
// ============================================================

/** Assigns every sample to its nearest palette entry — the "spatial
 * region segmentation" step, expressed as a flat label grid the caller
 * already knows the width/height of. */
export function quantizeToLabels(samples: RGB[], palette: RGB[]): Int32Array {
  const labels = new Int32Array(samples.length)
  for (let i = 0; i < samples.length; i++) labels[i] = nearestPaletteIndex(samples[i], palette)
  return labels
}

/**
 * Merges insignificant (small, isolated) regions into whichever
 * larger neighbouring region touches them most. Two passes over a
 * label grid: (1) 4-connected flood fill to find contiguous same-label
 * components and their sizes; (2) for every component under
 * `minRegionSize`, count its neighbours' labels and reassign the whole
 * component to the most common one. A single pass, not iterated to a
 * fixed point — sufficient for the small analysis grids this pipeline
 * uses, and keeps the operation's cost bounded and easy to reason
 * about for a prototype.
 */
export function mergeSmallRegions(
  labels: Int32Array,
  width: number,
  height: number,
  minRegionSize: number
): Int32Array {
  const n = width * height
  const visited = new Uint8Array(n)
  const componentId = new Int32Array(n).fill(-1)
  const componentSize: number[] = []
  let numComponents = 0

  for (let start = 0; start < n; start++) {
    if (visited[start]) continue
    const label = labels[start]
    const stack = [start]
    visited[start] = 1
    let size = 0
    while (stack.length > 0) {
      const idx = stack.pop() as number
      componentId[idx] = numComponents
      size++
      const x = idx % width
      const y = (idx / width) | 0
      if (x > 0 && !visited[idx - 1] && labels[idx - 1] === label) {
        visited[idx - 1] = 1
        stack.push(idx - 1)
      }
      if (x < width - 1 && !visited[idx + 1] && labels[idx + 1] === label) {
        visited[idx + 1] = 1
        stack.push(idx + 1)
      }
      if (y > 0 && !visited[idx - width] && labels[idx - width] === label) {
        visited[idx - width] = 1
        stack.push(idx - width)
      }
      if (y < height - 1 && !visited[idx + width] && labels[idx + width] === label) {
        visited[idx + width] = 1
        stack.push(idx + width)
      }
    }
    componentSize.push(size)
    numComponents++
  }

  const result = Int32Array.from(labels)
  for (let c = 0; c < numComponents; c++) {
    if (componentSize[c] >= minRegionSize) continue

    const votes = new Map<number, number>()
    for (let idx = 0; idx < n; idx++) {
      if (componentId[idx] !== c) continue
      const x = idx % width
      const y = (idx / width) | 0
      const neighborIdxs: number[] = []
      if (x > 0) neighborIdxs.push(idx - 1)
      if (x < width - 1) neighborIdxs.push(idx + 1)
      if (y > 0) neighborIdxs.push(idx - width)
      if (y < height - 1) neighborIdxs.push(idx + width)
      for (const nb of neighborIdxs) {
        if (componentId[nb] !== c) {
          const nbLabel = result[nb]
          votes.set(nbLabel, (votes.get(nbLabel) ?? 0) + 1)
        }
      }
    }
    if (votes.size === 0) continue // the whole grid is this one component

    let bestLabel = -1
    let bestVotes = -1
    for (const [lbl, v] of votes) {
      if (v > bestVotes) {
        bestVotes = v
        bestLabel = lbl
      }
    }
    for (let idx = 0; idx < n; idx++) {
      if (componentId[idx] === c) result[idx] = bestLabel
    }
  }

  return result
}

/**
 * 4-connected flood fill returning every distinct spatial component in
 * a label grid, regardless of which palette label each one carries —
 * used by the engine to trace and render EACH disjoint blob of a given
 * colour as its own contour (a colour that appears in two separate
 * corners of a photograph is two components, and must become two
 * independently-shaped masses, not one contour spanning both).
 */
export function findConnectedComponents(
  labels: Int32Array,
  width: number,
  height: number
): { componentId: Int32Array; sizes: number[]; labelOf: number[]; count: number } {
  const n = width * height
  const visited = new Uint8Array(n)
  const componentId = new Int32Array(n).fill(-1)
  const sizes: number[] = []
  const labelOf: number[] = []
  let numComponents = 0

  for (let start = 0; start < n; start++) {
    if (visited[start]) continue
    const label = labels[start]
    const stack = [start]
    visited[start] = 1
    let size = 0
    while (stack.length > 0) {
      const idx = stack.pop() as number
      componentId[idx] = numComponents
      size++
      const x = idx % width
      const y = (idx / width) | 0
      if (x > 0 && !visited[idx - 1] && labels[idx - 1] === label) {
        visited[idx - 1] = 1
        stack.push(idx - 1)
      }
      if (x < width - 1 && !visited[idx + 1] && labels[idx + 1] === label) {
        visited[idx + 1] = 1
        stack.push(idx + 1)
      }
      if (y > 0 && !visited[idx - width] && labels[idx - width] === label) {
        visited[idx - width] = 1
        stack.push(idx - width)
      }
      if (y < height - 1 && !visited[idx + width] && labels[idx + width] === label) {
        visited[idx + width] = 1
        stack.push(idx + width)
      }
    }
    sizes.push(size)
    labelOf.push(label)
    numComponents++
  }

  return { componentId, sizes, labelOf, count: numComponents }
}

/** Pixel count per palette index — "how large is each surviving
 * region," used to pick which regions are significant enough for an
 * accent stroke. */
export function regionSizes(labels: Int32Array, paletteSize: number): number[] {
  const sizes = new Array(paletteSize).fill(0)
  for (let i = 0; i < labels.length; i++) sizes[labels[i]]++
  return sizes
}

/** The mean grid position of every cell carrying `label` — used for
 * placing the (now geometry-following, see mark-engine.ts) accent
 * stroke decision, and to
 * place restrained accent strokes near a region's visual center. */
export function regionCentroid(
  labels: Int32Array,
  width: number,
  height: number,
  label: number
): { x: number; y: number; count: number } {
  let sx = 0
  let sy = 0
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (labels[y * width + x] === label) {
        sx += x
        sy += y
        count++
      }
    }
  }
  return count > 0 ? { x: sx / count, y: sy / count, count } : { x: width / 2, y: height / 2, count: 0 }
}

// ============================================================
// COMPOSITION / CROP MATH
// ============================================================

/** Center-crop-to-square source rectangle — deliberately never
 * subject-detection-driven (the transformation must not depend on face
 * detection as its core mechanism, and must work identically for a
 * person, a pet, a bicycle, or a landscape). */
export function computeSquareFitRect(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height)
  return {
    sx: Math.floor((width - size) / 2),
    sy: Math.floor((height - size) / 2),
    size,
  }
}

// ============================================================
// CHECKPOINT 1B — REGION REDUCTION (area + adjacency + colour)
// ============================================================

/**
 * Reduces a set of weighted palette colours toward a restrained number
 * of "meaningful visual masses" (Section C: large masses, not hundreds
 * of shapes) via deterministic, repeated closest-pair agglomerative
 * merging: at every step, find the two colours with the smallest
 * squared RGB distance; merge them (an area/weight-weighted mean,
 * never a randomly-picked representative) if EITHER they're closer
 * than `colorMergeThresholdSq` (the "colour similarity" half of
 * Section C's area+adjacency+colour merge rule) OR the palette is
 * still over `maxRegions` (a hard cap, so a very busy photograph can
 * never produce more than a restrained number of masses). Ties are
 * broken by scan order (lowest index pair found first), so the same
 * palette+weights always merges identically every time.
 *
 * This handles the "colour similarity" merging globally, across the
 * whole palette, independent of spatial adjacency — two different
 * corners of a photograph that happen to be a similar colour (e.g. sky
 * glimpsed in two places) are allowed to become one visual mass, which
 * is exactly the "restrained number of masses" effect wanted here.
 * Spatial "area + adjacency" merging (absorbing a small, spatially
 * isolated patch into whichever neighbouring mass actually touches it)
 * is the separate, complementary job of mergeSmallRegions below —
 * together they satisfy Section C's full "area + adjacency + colour"
 * rule without needing a combined spatial-and-colour graph algorithm.
 */
export function reducePalette(
  palette: RGB[],
  weights: number[],
  options: { colorMergeThresholdSq: number; maxRegions: number }
): { palette: RGB[]; mapping: number[] } {
  type Entry = { color: RGB; weight: number; members: number[] }
  let entries: Entry[] = palette.map((color, i) => ({
    color,
    weight: Math.max(1, weights[i] ?? 1),
    members: [i],
  }))

  while (entries.length > 1) {
    let bestI = 0
    let bestJ = 1
    let bestDist = Infinity
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const d = colorDistanceSq(entries[i].color, entries[j].color)
        if (d < bestDist) {
          bestDist = d
          bestI = i
          bestJ = j
        }
      }
    }

    const mustMergeForCap = entries.length > options.maxRegions
    const closeEnoughToMerge = bestDist < options.colorMergeThresholdSq
    if (!mustMergeForCap && !closeEnoughToMerge) break

    const a = entries[bestI]
    const b = entries[bestJ]
    const totalWeight = a.weight + b.weight
    const mergedColor: RGB = [
      Math.round((a.color[0] * a.weight + b.color[0] * b.weight) / totalWeight),
      Math.round((a.color[1] * a.weight + b.color[1] * b.weight) / totalWeight),
      Math.round((a.color[2] * a.weight + b.color[2] * b.weight) / totalWeight),
    ]
    const merged: Entry = { color: mergedColor, weight: totalWeight, members: [...a.members, ...b.members] }
    entries = [...entries.filter((_, idx) => idx !== bestI && idx !== bestJ), merged]
  }

  const mapping = new Array(palette.length).fill(0)
  const finalPalette: RGB[] = entries.map((e) => e.color)
  entries.forEach((entry, finalIndex) => {
    for (const origIdx of entry.members) mapping[origIdx] = finalIndex
  })
  return { palette: finalPalette, mapping }
}

/** Remaps a label grid through a palette-index mapping (as produced by
 * reducePalette) — a pure array remap, kept separate from
 * reducePalette itself so the merge decision and its application are
 * independently testable. */
export function remapLabels(labels: Int32Array, mapping: number[]): Int32Array {
  const result = new Int32Array(labels.length)
  for (let i = 0; i < labels.length; i++) result[i] = mapping[labels[i]]
  return result
}

// ============================================================
// CHECKPOINT 1B — CONTOUR TRACING, SIMPLIFICATION, SMOOTHING
// ============================================================

/**
 * Traces the boundary of a binary mask (1 = inside the region, 0/out-
 * of-bounds = outside) as one or more closed polygon loops, in
 * grid-CORNER coordinate space (a mask cell (x, y) spans corners
 * (x,y)-(x+1,y)-(x+1,y+1)-(x,y+1)). This is the deterministic-
 * boundary-extraction step (equivalent to marching squares for a
 * crisp, already-binary field — no interpolation is needed here
 * because there is no continuous gradient to interpolate across, only
 * a hard inside/outside decision already made by the region merge
 * steps above).
 *
 * Method: collect every mask-edge that separates an inside cell from
 * an outside one, then walk the resulting edge graph, at each corner
 * point always taking the first not-yet-used connecting edge — this
 * produces one or more closed loops, deterministically, since the
 * traversal order depends only on the mask itself (edges are collected
 * in a fixed row-major order and each corner's neighbour list is
 * built in a fixed compass order).
 */
export function traceRegionContours(mask: Uint8Array, width: number, height: number): Point[][] {
  const isInside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1

  type Edge = [Point, Point]
  const edges: Edge[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInside(x, y)) continue
      if (!isInside(x, y - 1)) edges.push([{ x, y }, { x: x + 1, y }]) // top
      if (!isInside(x, y + 1)) edges.push([{ x, y: y + 1 }, { x: x + 1, y: y + 1 }]) // bottom
      if (!isInside(x - 1, y)) edges.push([{ x, y }, { x, y: y + 1 }]) // left
      if (!isInside(x + 1, y)) edges.push([{ x: x + 1, y }, { x: x + 1, y: y + 1 }]) // right
    }
  }
  if (edges.length === 0) return []

  const keyOf = (p: Point) => `${p.x},${p.y}`
  const edgeKey = (a: Point, b: Point) => {
    const ka = keyOf(a)
    const kb = keyOf(b)
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
  }

  const neighborsOf = new Map<string, Point[]>()
  for (const [a, b] of edges) {
    const ka = keyOf(a)
    const kb = keyOf(b)
    if (!neighborsOf.has(ka)) neighborsOf.set(ka, [])
    if (!neighborsOf.has(kb)) neighborsOf.set(kb, [])
    neighborsOf.get(ka)!.push(b)
    neighborsOf.get(kb)!.push(a)
  }

  const usedEdges = new Set<string>()
  const loops: Point[][] = []

  for (const [a, b] of edges) {
    const startKey = edgeKey(a, b)
    if (usedEdges.has(startKey)) continue

    const loop: Point[] = [a]
    let current = b
    usedEdges.add(startKey)

    while (keyOf(current) !== keyOf(a)) {
      loop.push(current)
      const neighbors = neighborsOf.get(keyOf(current)) ?? []
      let next: Point | null = null
      for (const candidate of neighbors) {
        const ek = edgeKey(current, candidate)
        if (!usedEdges.has(ek)) {
          next = candidate
          usedEdges.add(ek)
          break
        }
      }
      if (!next) break // malformed/open chain — stop rather than loop forever
      current = next
    }
    loops.push(loop)
  }

  return loops
}

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Ramer-Douglas-Peucker path simplification — removes points that lie
 * within `epsilon` of the straight line between their neighbours (the
 * stair-stepped runs a grid-aligned trace produces), while keeping
 * genuine corners. Applied to the loop as an open chain from its first
 * to its last point; the seam between last-and-first is accepted
 * as-is rather than also being simplified across the wrap, a
 * deliberate, disclosed simplification for a first implementation
 * (the loop already has many points near that seam from
 * traceRegionContours, so this costs at most one or two redundant
 * points at a single joint, never a visible defect after smoothing).
 */
export function simplifyPath(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points

  function rdp(pts: Point[]): Point[] {
    if (pts.length < 3) return pts
    const first = pts[0]
    const last = pts[pts.length - 1]
    let maxDist = 0
    let index = 0
    for (let i = 1; i < pts.length - 1; i++) {
      const d = pointToSegmentDistance(pts[i], first, last)
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (maxDist > epsilon) {
      const left = rdp(pts.slice(0, index + 1))
      const right = rdp(pts.slice(index))
      return [...left.slice(0, -1), ...right]
    }
    return [first, last]
  }

  return rdp(points)
}

/**
 * Chaikin corner-cutting — each iteration replaces every edge with two
 * new points at 1/4 and 3/4 along it, a classic, deterministic way to
 * turn a polygon into a smooth curve (it converges toward a quadratic
 * B-spline as iterations increase). Because every output point is a
 * convex combination (weights 0.75/0.25, both positive, summing to 1)
 * of two INPUT points, every output point stays within the convex hull
 * of the input polygon — smoothing can never escape the original
 * shape's bounds.
 */
export function chaikinSmooth(points: Point[], iterations: number, closed = true): Point[] {
  let pts = points
  for (let iter = 0; iter < iterations; iter++) {
    if (pts.length < 3) break
    const next: Point[] = []
    const n = pts.length
    const limit = closed ? n : n - 1
    for (let i = 0; i < limit; i++) {
      const p0 = pts[i]
      const p1 = pts[(i + 1) % n]
      next.push({ x: p0.x * 0.75 + p1.x * 0.25, y: p0.y * 0.75 + p1.y * 0.25 })
      next.push({ x: p0.x * 0.25 + p1.x * 0.75, y: p0.y * 0.25 + p1.y * 0.75 })
    }
    if (!closed) {
      next.unshift(pts[0])
      next.push(pts[pts.length - 1])
    }
    pts = next
  }
  return pts
}

/** The signed area of a closed polygon (shoelace formula) — used only
 * to rank regions by size for draw order (largest mass first) and for
 * "is this contour degenerate" sanity checks; sign is irrelevant to
 * this codebase's use of it, so callers take the absolute value. */
export function polygonArea(points: Point[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

// ============================================================
// ALGORITHM V3 — COMPOSITIONAL ABSTRACTION ENGINE
// ============================================================
// The audit against the reference Mark (Checkpoint 1B follow-up)
// concluded that v2 is fundamentally a REGION-RECONSTRUCTION system
// (measure pixel colours, trace their literal footprint) while the
// reference is a COMPOSITIONAL INTERPRETATION (a small hierarchy of
// regularized, deliberately-shaped masses with internal tonal
// treatment and real layering). The functions below implement that
// different kind of pipeline: derive a handful of MASSES with real
// geometric/tonal STATISTICS, score them against generic (never
// semantic) visual-hierarchy criteria, classify each one's shape by
// its own geometry, and generate a REGULARIZED parametric form for it
// rather than tracing its literal boundary. None of this depends on
// recognizing what a mass depicts.

/** Simple, deterministic separable box blur over an RGB sample grid —
 * applied to the analysis grid BEFORE any clustering happens. This is
 * the mechanism for "treat local texture as a statistic, not
 * geometry": blurring first means a patterned area's real local colour
 * variation never gets the chance to fragment into many small
 * same-colour regions — clustering afterward only ever sees the
 * area's large-scale colour, exactly the macro-shape a compositional
 * mass should be. (The UNBLURRED samples are kept and passed
 * separately to computeMassStatistics, so genuine tonal/colour RANGE
 * information from the original pixels is never lost — only the
 * *clustering* decision is based on the smoothed version.) */
export function boxBlurGrid(samples: RGB[], width: number, height: number, radius: number): RGB[] {
  if (radius <= 0) return samples.map((c) => [...c] as RGB)

  function blurPass(input: RGB[], horizontal: boolean): RGB[] {
    const output: RGB[] = new Array(input.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sr = 0
        let sg = 0
        let sb = 0
        let count = 0
        for (let d = -radius; d <= radius; d++) {
          const sx = horizontal ? x + d : x
          const sy = horizontal ? y : y + d
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue
          const c = input[sy * width + sx]
          sr += c[0]
          sg += c[1]
          sb += c[2]
          count++
        }
        output[y * width + x] = [Math.round(sr / count), Math.round(sg / count), Math.round(sb / count)]
      }
    }
    return output
  }

  return blurPass(blurPass(samples, true), false)
}

export type MassStats = {
  label: number
  centroid: Point
  pixelCount: number
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number }
  /** Principal-axis angle in radians, derived from the mass's own
   * pixel covariance — never from assumed subject orientation. */
  orientationRad: number
  /** Ratio of major to minor axis spread; 1 = perfectly round, larger
   * = more elongated. */
  elongation: number
  /** pixelCount / boundingBoxArea, in (0, 1] — how much of its own
   * bounding box the mass actually fills. Close to 1 means a clean,
   * regular blob; low means an irregular/scattered footprint. */
  compactness: number
  /** Mean colour from the ORIGINAL (pre-blur) samples within this
   * mass's footprint — real source colour, not a blurred average. */
  meanColor: RGB
  minLuminance: number
  maxLuminance: number
  /** Mean squared colour distance of the mass's own original pixels
   * from its own mean colour — the "how much local variation did this
   * mass absorb" statistic driving internal tonal banding, standing in
   * for texture energy without ever creating separate geometry for it. */
  textureEnergy: number
  touchesEdge: { top: boolean; bottom: boolean; left: boolean; right: boolean }
}

/**
 * Computes the full statistic set for one mass (a binary mask over the
 * analysis grid) from the ORIGINAL, unblurred per-cell colours — this
 * is what lets a mass's true tonal/colour RANGE survive even though
 * its spatial extent was decided from blurred, clustered data.
 */
export function computeMassStatistics(
  mask: Uint8Array,
  width: number,
  height: number,
  originalColors: RGB[],
  label: number
): MassStats {
  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumYY = 0
  let sumXY = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let count = 0
  let minX = width
  let maxX = -1
  let minY = height
  let maxY = -1
  let minLum = Infinity
  let maxLum = -Infinity
  const touchesEdge = { top: false, bottom: false, left: false, right: false }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] !== 1) continue
      sumX += x
      sumY += y
      sumXX += x * x
      sumYY += y * y
      sumXY += x * y
      const c = originalColors[y * width + x]
      sumR += c[0]
      sumG += c[1]
      sumB += c[2]
      const lum = luminance(c)
      if (lum < minLum) minLum = lum
      if (lum > maxLum) maxLum = lum
      count++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x === 0) touchesEdge.left = true
      if (x === width - 1) touchesEdge.right = true
      if (y === 0) touchesEdge.top = true
      if (y === height - 1) touchesEdge.bottom = true
    }
  }

  if (count === 0) {
    return {
      label,
      centroid: { x: width / 2, y: height / 2 },
      pixelCount: 0,
      boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      orientationRad: 0,
      elongation: 1,
      compactness: 0,
      meanColor: [128, 128, 128],
      minLuminance: 0,
      maxLuminance: 0,
      textureEnergy: 0,
      touchesEdge,
    }
  }

  const centroid = { x: sumX / count, y: sumY / count }
  const meanColor: RGB = [Math.round(sumR / count), Math.round(sumG / count), Math.round(sumB / count)]

  const varX = sumXX / count - centroid.x * centroid.x
  const varY = sumYY / count - centroid.y * centroid.y
  const covXY = sumXY / count - centroid.x * centroid.y
  const trace = varX + varY
  const det = varX * varY - covXY * covXY
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det))
  const lambda1 = trace / 2 + disc
  const lambda2 = Math.max(0, trace / 2 - disc)
  const orientationRad =
    varX === varY && covXY === 0 ? 0 : 0.5 * Math.atan2(2 * covXY, varX - varY)
  const elongation = Math.sqrt(lambda1 / Math.max(lambda2, 0.0001))

  const boundingBox = { minX, minY, maxX, maxY }
  const boundingArea = (maxX - minX + 1) * (maxY - minY + 1)
  const compactness = boundingArea > 0 ? count / boundingArea : 1

  let varianceSum = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] !== 1) continue
      varianceSum += colorDistanceSq(originalColors[y * width + x], meanColor)
    }
  }
  const textureEnergy = varianceSum / count

  return {
    label,
    centroid,
    pixelCount: count,
    boundingBox,
    orientationRad,
    elongation: Number.isFinite(elongation) ? elongation : 1,
    compactness: Math.min(1, compactness),
    meanColor,
    minLuminance: minLum,
    maxLuminance: maxLum,
    textureEnergy,
    touchesEdge,
  }
}

/** Adjacency set per component, from a componentId grid — which
 * components share at least one grid edge with which others. */
export function buildAdjacency(
  componentId: Int32Array,
  width: number,
  height: number,
  count: number
): Set<number>[] {
  const adjacency: Set<number>[] = Array.from({ length: count }, () => new Set<number>())
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const c = componentId[idx]
      if (x < width - 1) {
        const cr = componentId[idx + 1]
        if (cr !== c) {
          adjacency[c].add(cr)
          adjacency[cr].add(c)
        }
      }
      if (y < height - 1) {
        const cb = componentId[idx + width]
        if (cb !== c) {
          adjacency[c].add(cb)
          adjacency[cb].add(c)
        }
      }
    }
  }
  return adjacency
}

/**
 * A deterministic focal-candidacy score from GENERIC visual statistics
 * only — no semantic assumption of any kind. Combines: color
 * distinctiveness (distance from the area-weighted mean colour of
 * every OTHER mass — "does this stand out"), a size sweet-spot curve
 * (peaks at a modest fraction of the total canvas — neither a speck
 * nor the dominant background is usually the focal point), compactness
 * (a regular, gathered shape reads as more focal than a scattered
 * one), and a DELIBERATELY WEAK centrality term (mild pull toward the
 * frame center, carrying far less weight than the other three — never
 * an upper-frame/portrait bias). Every input is something already
 * measured about the mass's own geometry and colour; nothing here
 * knows or guesses what the mass depicts.
 */
export function scoreFocalCandidacy(
  stats: MassStats,
  others: MassStats[],
  totalArea: number,
  canvasSize: number
): number {
  if (others.length === 0 || totalArea <= 0) return 0

  let otherWeight = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  for (const o of others) {
    sumR += o.meanColor[0] * o.pixelCount
    sumG += o.meanColor[1] * o.pixelCount
    sumB += o.meanColor[2] * o.pixelCount
    otherWeight += o.pixelCount
  }
  const othersMeanColor: RGB =
    otherWeight > 0 ? [sumR / otherWeight, sumG / otherWeight, sumB / otherWeight] : stats.meanColor
  const colorDistinctiveness = Math.sqrt(colorDistanceSq(stats.meanColor, othersMeanColor)) / 441.67 // 441.67 = sqrt(255^2*3), the max possible RGB distance — normalizes to [0,1]

  const areaFraction = stats.pixelCount / totalArea
  // A gentle bump function peaking around 12% of the canvas, i.e.
  // "a modest, substantial mass" — neither a speck nor the dominant
  // field. sigma chosen wide enough to score a reasonable range of
  // sizes without being a hard cliff.
  const sweetSpot = 0.12
  const sigma = 0.14
  const sizeScore = Math.exp(-((areaFraction - sweetSpot) ** 2) / (2 * sigma * sigma))

  const compactnessScore = stats.compactness

  const dx = (stats.centroid.x - canvasSize / 2) / (canvasSize / 2)
  const dy = (stats.centroid.y - canvasSize / 2) / (canvasSize / 2)
  const centrality = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy))

  // Weights: colour distinctiveness and size sweet-spot dominate;
  // compactness contributes meaningfully; centrality is a deliberately
  // minor tiebreaker only.
  return colorDistinctiveness * 0.35 + sizeScore * 0.3 + compactnessScore * 0.25 + centrality * 0.1
}

export type MassShapeStyle = 'lobe' | 'sweep' | 'field'

/**
 * Classifies a mass's rendering style from its own geometry alone —
 * elongation, compactness, and how much of the canvas it occupies.
 * 'lobe': compact, roughly round -> an ellipse. 'sweep': elongated ->
 * a tapered ribbon along its own principal axis. 'field': very large
 * and/or heavily touching the canvas perimeter -> a broad expanded
 * form suitable as a background/atmosphere layer. No case here ever
 * inspects colour or asks "what is this" — only shape.
 */
export function classifyMassShape(stats: MassStats, totalArea: number): MassShapeStyle {
  const areaFraction = stats.pixelCount / Math.max(1, totalArea)
  const edgeTouchCount = Object.values(stats.touchesEdge).filter(Boolean).length

  if (areaFraction > 0.3 || (edgeTouchCount >= 2 && areaFraction > 0.12)) return 'field'
  if (stats.elongation > 1.7) return 'sweep'
  return 'lobe'
}

/**
 * Generates a regularized, deterministic parametric point loop for a
 * mass — never its literal traced boundary. 'lobe' is a smooth ellipse
 * sized from the mass's own principal-axis spread. 'sweep' is a
 * tapered ribbon running along the mass's own orientation. 'field' is
 * a broad softened form, deliberately expanded beyond the mass's
 * measured extent (and pushed past any canvas edge it already
 * touches) so it can plausibly sit BEHIND neighbouring masses once
 * layered — this expansion is what makes real overlap/negative space
 * possible instead of an exact edge-to-edge partition.
 */
export function generateRegularizedMassPoints(
  stats: MassStats,
  style: MassShapeStyle,
  canvasSize: number,
  sides = 20
): Point[] {
  const { centroid, orientationRad } = stats
  const halfMajor = Math.max(1.2, Math.sqrt(stats.pixelCount / Math.PI) * Math.max(1, Math.sqrt(stats.elongation)))
  const halfMinor = Math.max(0.8, Math.sqrt(stats.pixelCount / Math.PI) / Math.max(1, Math.sqrt(stats.elongation)))

  function ellipsePoints(rx: number, ry: number, cx: number, cy: number, rot: number): Point[] {
    const pts: Point[] = []
    for (let i = 0; i < sides; i++) {
      const t = (i / sides) * Math.PI * 2
      const ex = rx * Math.cos(t)
      const ey = ry * Math.sin(t)
      pts.push({
        x: cx + ex * Math.cos(rot) - ey * Math.sin(rot),
        y: cy + ex * Math.sin(rot) + ey * Math.cos(rot),
      })
    }
    return pts
  }

  if (style === 'lobe') {
    return ellipsePoints(halfMajor, halfMinor, centroid.x, centroid.y, orientationRad)
  }

  if (style === 'sweep') {
    // A tapered ribbon: an ellipse stretched further along the major
    // axis than raw pixel spread alone would give, so it reads as a
    // confident long sweep rather than a modest oval.
    return ellipsePoints(halfMajor * 1.6, halfMinor * 0.85, centroid.x, centroid.y, orientationRad)
  }

  // 'field' — expand generously beyond the measured extent, and push
  // out to (or past) any canvas edge the mass already touches, so this
  // shape can act as a true background layer other masses sit in front
  // of.
  const expansion = 1.35
  let rx = halfMajor * expansion
  let ry = halfMinor * expansion * Math.max(1, stats.elongation * 0.6)
  let cx = centroid.x
  let cy = centroid.y
  if (stats.touchesEdge.left) {
    rx = Math.max(rx, cx + rx * 0.4)
  }
  if (stats.touchesEdge.right) {
    rx = Math.max(rx, canvasSize - cx + rx * 0.4)
  }
  if (stats.touchesEdge.top) {
    ry = Math.max(ry, cy + ry * 0.4)
  }
  if (stats.touchesEdge.bottom) {
    ry = Math.max(ry, canvasSize - cy + ry * 0.4)
  }
  return ellipsePoints(rx, ry, cx, cy, orientationRad)
}

/**
 * Nested inset copies of a mass's own regularized shape, at decreasing
 * scale toward its centroid (with the shrink center offset slightly
 * along the mass's own orientation, so the bands read as directional
 * shading rather than concentric rings), each paired with a position
 * along the mass's REAL measured tonal range. This is the "texture as
 * statistic, not geometry" mechanism: a patterned/high-variance mass
 * never gets extra independent shapes — it gets more/wider tonal
 * separation between these same nested bands instead.
 */
export function generateNestedBands(
  basePoints: Point[],
  centroid: Point,
  orientationRad: number,
  bandCount: number
): { points: Point[]; t: number }[] {
  if (bandCount <= 1 || basePoints.length === 0) {
    return [{ points: basePoints, t: 0.5 }]
  }
  const bands: { points: Point[]; t: number }[] = []
  const offsetDir = { x: Math.cos(orientationRad), y: Math.sin(orientationRad) }
  for (let i = 0; i < bandCount; i++) {
    const t = bandCount === 1 ? 0.5 : i / (bandCount - 1)
    const scale = 1 - t * 0.55 // shrink up to 55% for the innermost band
    const shiftAmount = t * 0.18 // small directional shift, in "shape units"
    const shiftedCentroid = {
      x: centroid.x + offsetDir.x * shiftAmount * averageRadius(basePoints, centroid),
      y: centroid.y + offsetDir.y * shiftAmount * averageRadius(basePoints, centroid),
    }
    const points = basePoints.map((p) => ({
      x: shiftedCentroid.x + (p.x - centroid.x) * scale,
      y: shiftedCentroid.y + (p.y - centroid.y) * scale,
    }))
    bands.push({ points, t })
  }
  return bands
}

function averageRadius(points: Point[], centroid: Point): number {
  if (points.length === 0) return 0
  let sum = 0
  for (const p of points) sum += Math.hypot(p.x - centroid.x, p.y - centroid.y)
  return sum / points.length
}

/**
 * Chooses a deterministic accent colour: the mass with the SMALLEST
 * pixel count that is still above a minimum floor (a genuinely
 * present, minor hue — never a colour invented from nothing, and
 * never merely "region number N"). Returns null when no mass qualifies
 * (a photo dominated by only 1-2 masses legitimately has no minor
 * accent hue to offer, and v3 must not manufacture one).
 */
export function chooseAccentMass(
  masses: { label: number; meanColor: RGB; pixelCount: number }[],
  totalArea: number,
  minFraction: number,
  maxFraction: number
): { label: number; meanColor: RGB; pixelCount: number } | null {
  let best: { label: number; meanColor: RGB; pixelCount: number } | null = null
  for (const m of masses) {
    const fraction = m.pixelCount / Math.max(1, totalArea)
    if (fraction < minFraction || fraction > maxFraction) continue
    if (!best || m.pixelCount < best.pixelCount) best = m
  }
  return best
}

// ============================================================
// "CHOOSE YOUR MARK" — prototype family rendering primitives
// ============================================================
// V2 remains untouched. The pure helpers below support the independent
// WEAVE, CONTOUR, and GLYPH prototype grammars. Nothing here inspects
// what a mass depicts.

/** The axis-aligned bounding circle-ish extent of a point set, in its
 * own coordinate space — used only to size a radial gradient around a
 * mass's already-generated shape; not a statistic used for any
 * compositional decision. */
export function boundsOfPoints(points: Point[]): { cx: number; cy: number; rx: number; ry: number } {
  if (points.length === 0) return { cx: 0, cy: 0, rx: 1, ry: 1 }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, rx: (maxX - minX) / 2, ry: (maxY - minY) / 2 }
}

/** A continuous analogue of v3's discrete bandCountFor: maps a mass's
 * textureEnergy to a bounded internal-gradient contrast, used by V4
 * CUT's continuous two-stop tonal gradient (rather than
 * v3's discrete nested-band shapes). Same underlying idea — "texture
 * becomes a tonal-range statistic, never new geometry" — expressed
 * through a different rendering technique. */
export function gradientContrastFor(textureEnergy: number): number {
  const normalized = Math.max(0, textureEnergy) / 3500
  return Math.min(0.4, 0.08 + normalized * 0.32)
}

/**
 * V4 CUT's silhouette generator — a deliberately asymmetric, elegant
 * variant of the mass's own ellipse footprint, never a perfect
 * ellipse and never the mass's literal traced boundary. A small, fixed
 * number of deterministic "bulge" control points — derived from this
 * mass's own statistics, never Math.random() — are smoothly
 * interpolated around the full silhouette, giving the "cut form"
 * character a v3-style perfect ellipse or a v2-style literal contour
 * cannot produce. `isField` mirrors v3's own edge-aware background
 * treatment, with CUT's own smaller, more restrained expansion —
 * "restrained overlapping composition," not a dramatic background
 * bleed.
 */
export function generateCutMassPoints(
  stats: MassStats,
  canvasSize: number,
  isField: boolean,
  sides = 16
): Point[] {
  const { centroid, orientationRad, elongation, pixelCount, touchesEdge } = stats
  const fieldFactor = isField ? 1.2 : 1
  const halfMajor = Math.max(1.4, Math.sqrt(pixelCount / Math.PI) * Math.max(1, Math.sqrt(elongation)) * fieldFactor)
  const halfMinor = Math.max(
    1.0,
    (Math.sqrt(pixelCount / Math.PI) / Math.max(1, Math.sqrt(elongation))) * fieldFactor
  )

  const controlCount = 5
  const seed = hashInts([
    Math.round(centroid.x * 100),
    Math.round(centroid.y * 100),
    pixelCount,
    ...stats.meanColor,
    4001,
  ])
  const rand = createSeededRandom(seed)
  const controlOffsets: number[] = []
  for (let i = 0; i < controlCount; i++) {
    controlOffsets.push(0.78 + rand() * 0.5) // bounded ~[0.78, 1.28] — elegant, never spiky
  }

  const cx = centroid.x
  const cy = centroid.y
  let rx = halfMajor
  let ry = halfMinor
  if (isField) {
    if (touchesEdge.left) rx = Math.max(rx, cx + rx * 0.3)
    if (touchesEdge.right) rx = Math.max(rx, canvasSize - cx + rx * 0.3)
    if (touchesEdge.top) ry = Math.max(ry, cy + ry * 0.3)
    if (touchesEdge.bottom) ry = Math.max(ry, canvasSize - cy + ry * 0.3)
  }

  const points: Point[] = []
  for (let i = 0; i < sides; i++) {
    const t = (i / sides) * Math.PI * 2
    const controlPos = (t / (Math.PI * 2)) * controlCount
    const i0 = Math.floor(controlPos) % controlCount
    const i1 = (i0 + 1) % controlCount
    const frac = controlPos - Math.floor(controlPos)
    const smoothFrac = (1 - Math.cos(frac * Math.PI)) / 2
    const bulge = controlOffsets[i0] * (1 - smoothFrac) + controlOffsets[i1] * smoothFrac

    const ex = rx * bulge * Math.cos(t)
    const ey = ry * bulge * Math.sin(t)
    points.push({
      x: cx + ex * Math.cos(orientationRad) - ey * Math.sin(orientationRad),
      y: cy + ex * Math.sin(orientationRad) + ey * Math.cos(orientationRad),
    })
  }
  return points
}

/**
 * V5 WASH's organic perimeter. The mass's measured centroid,
 * orientation, area, elongation, and edge contact establish the broad
 * footprint. Three low-frequency, mass-seeded waves then introduce a
 * restrained spreading/contraction rhythm. This is neither a traced
 * contour nor a faceted/regularized polygon: it is a smooth,
 * deterministic interpretation of how diluted pigment might settle
 * around that particular source-derived territory.
 */
export function generateWashMassPoints(
  stats: MassStats,
  canvasSize: number,
  isField: boolean,
  pointCount = 24
): Point[] {
  const { centroid, orientationRad, elongation, pixelCount, touchesEdge } = stats
  const fieldFactor = isField ? 1.16 : 1.06
  const halfMajor = Math.max(1.6, Math.sqrt(pixelCount / Math.PI) * Math.max(1, Math.sqrt(elongation)) * fieldFactor)
  const halfMinor = Math.max(
    1.2,
    (Math.sqrt(pixelCount / Math.PI) / Math.max(1, Math.sqrt(elongation))) * fieldFactor
  )

  const seed = hashInts([
    Math.round(centroid.x * 100),
    Math.round(centroid.y * 100),
    pixelCount,
    ...stats.meanColor,
    Math.round(orientationRad * 1000),
    5007,
  ])
  const rand = createSeededRandom(seed)
  const phaseA = rand() * Math.PI * 2
  const phaseB = rand() * Math.PI * 2
  const phaseC = rand() * Math.PI * 2
  const amplitudeA = 0.07 + rand() * 0.035
  const amplitudeB = 0.035 + rand() * 0.025
  const amplitudeC = 0.02 + rand() * 0.02

  const cx = centroid.x
  const cy = centroid.y
  let rx = halfMajor
  let ry = halfMinor
  if (isField) {
    if (touchesEdge.left) rx = Math.max(rx, cx + rx * 0.18)
    if (touchesEdge.right) rx = Math.max(rx, canvasSize - cx + rx * 0.18)
    if (touchesEdge.top) ry = Math.max(ry, cy + ry * 0.18)
    if (touchesEdge.bottom) ry = Math.max(ry, canvasSize - cy + ry * 0.18)
  }

  const points: Point[] = []
  for (let i = 0; i < pointCount; i++) {
    const t = (i / pointCount) * Math.PI * 2
    const spread =
      1 +
      Math.sin(t * 2 + phaseA) * amplitudeA +
      Math.sin(t * 3 + phaseB) * amplitudeB +
      Math.sin(t + phaseC) * amplitudeC
    const ex = rx * spread * Math.cos(t)
    const ey = ry * spread * Math.sin(t)
    points.push({
      x: cx + ex * Math.cos(orientationRad) - ey * Math.sin(orientationRad),
      y: cy + ex * Math.sin(orientationRad) + ey * Math.cos(orientationRad),
    })
  }
  return points
}

/** V4 CUT's per-shape tone: keeps the mass's real hue, restrains
 * saturation similarly to v3's harmonizePalette, and expresses a
 * gentle two-stop gradient (t=0 outer/darker edge, t=1 inner/lighter
 * core) whose contrast is driven by gradientContrastFor — an
 * "editorial" restraint, not a full nested-band treatment. */
export function cutToneColor(meanColor: RGB, t: number, contrast: number): RGB {
  const [h, s, l] = rgbToHsl(meanColor)
  const harmonizedS = clamp(s * 0.8, 0.14, 0.55)
  const targetL = clamp(l + (t - 0.5) * contrast * 2, 0.12, 0.86)
  return hslToRgb([h, harmonizedS, targetL])
}

/** V5 WASH pigment tone. Density changes the measured source colour's
 * lightness and saturation gently: dilute body colour is quieter and
 * lighter; concentrated pigment is a little deeper and fuller. Hue is
 * never replaced, so relationships still come from the photograph. */
export function washPigmentColor(meanColor: RGB, density: number): RGB {
  const [h, s, l] = rgbToHsl(meanColor)
  const d = clamp(density, 0, 1)
  const harmonizedS = clamp(s * (0.62 + d * 0.25), 0.1, 0.58)
  const targetL = clamp(l + (0.5 - d) * 0.2, 0.14, 0.9)
  return hslToRgb([h, harmonizedS, targetL])
}

export type WeaveTile = { row: number; column: number; color: RGB }

function averageSampleRect(
  samples: RGB[], gridSize: number, x0: number, y0: number, x1: number, y1: number
): RGB {
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const color = samples[y * gridSize + x]
      if (!color) continue
      r += color[0]
      g += color[1]
      b += color[2]
      count++
    }
  }
  return count ? [Math.round(r / count), Math.round(g / count), Math.round(b / count)] : [0, 0, 0]
}

/** A deliberately coarse colour weave. Each tile combines one broad
 * horizontal signal, one broad vertical signal and a restrained local
 * average. At 6x6 this retains source balance and placement without
 * becoming a pixelated reconstruction of the photograph. */
export function generateWeaveTiles(samples: RGB[], gridSize: number, columns = 6, rows = 6): WeaveTile[] {
  const tiles: WeaveTile[] = []
  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor(row * gridSize / rows)
    const y1 = Math.max(y0 + 1, Math.floor((row + 1) * gridSize / rows))
    const horizontal = averageSampleRect(samples, gridSize, 0, y0, gridSize, y1)
    for (let column = 0; column < columns; column++) {
      const x0 = Math.floor(column * gridSize / columns)
      const x1 = Math.max(x0 + 1, Math.floor((column + 1) * gridSize / columns))
      const vertical = averageSampleRect(samples, gridSize, x0, 0, x1, gridSize)
      const local = averageSampleRect(samples, gridSize, x0, y0, x1, y1)
      const horizontalWeight = (row + column) % 2 === 0 ? 0.38 : 0.27
      const verticalWeight = (row + column) % 2 === 0 ? 0.27 : 0.38
      const localWeight = 0.35
      tiles.push({
        row,
        column,
        color: [0, 1, 2].map((channel) => Math.round(
          horizontal[channel] * horizontalWeight + vertical[channel] * verticalWeight + local[channel] * localWeight
        )) as RGB,
      })
    }
  }
  return tiles
}

/** Broad topographic rings derived from mass moments, not traced
 * edges. Low-frequency perturbation keeps the family organic while a
 * fixed ring count prevents literal silhouette reconstruction. */
export function generateContourRings(stats: MassStats, ringCount = 4, pointCount = 20): Point[][] {
  const radius = Math.max(2, Math.sqrt(stats.pixelCount / Math.PI))
  const rx = radius * Math.max(1, Math.sqrt(stats.elongation)) * 1.34
  const ry = radius / Math.max(1, Math.sqrt(stats.elongation)) * 1.34
  const seed = hashInts([stats.pixelCount, ...stats.meanColor, Math.round(stats.orientationRad * 1000), 6203])
  const random = createSeededRandom(seed)
  const phase = random() * Math.PI * 2
  return Array.from({ length: ringCount }, (_, ringIndex) => {
    const scale = 1 - ringIndex * 0.2
    return Array.from({ length: pointCount }, (__, pointIndex) => {
      const t = pointIndex / pointCount * Math.PI * 2
      const pulse = 1 + Math.sin(t * 3 + phase) * 0.07
      const ex = rx * scale * pulse * Math.cos(t)
      const ey = ry * scale * pulse * Math.sin(t)
      return {
        x: stats.centroid.x + ex * Math.cos(stats.orientationRad) - ey * Math.sin(stats.orientationRad),
        y: stats.centroid.y + ex * Math.sin(stats.orientationRad) + ey * Math.cos(stats.orientationRad),
      }
    })
  })
}

/** Source-hued colour for one filled topographic level. Luminance is
 * quantized into a small, high-contrast family while hue remains tied
 * to the measured mass colour. */
export function contourLevelColor(meanColor: RGB, level: number, levelCount: number): RGB {
  const [h, s, l] = rgbToHsl(meanColor)
  const t = levelCount <= 1 ? 0.5 : level / (levelCount - 1)
  return hslToRgb([h, clamp(s * 0.88, 0.12, 0.68), clamp(l + (0.5 - t) * 0.34, 0.1, 0.9)])
}

/** One emblematic route through compositional mass centres. Anchors
 * are deliberately pulled toward a shared centre and angularly
 * quantized, producing a glyph rather than a portrait/object trace. */
export function generateGlyphAnchors(stats: MassStats[], canvasSize: number): Point[] {
  if (stats.length === 0) return []
  const ordered = [...stats]
    .sort((a, b) => b.pixelCount - a.pixelCount || a.label - b.label)
    .slice(0, 7)
  const totalWeight = ordered.reduce((sum, item) => sum + item.pixelCount, 0)
  const centre = {
    x: ordered.reduce((sum, item) => sum + item.centroid.x * item.pixelCount, 0) / totalWeight,
    y: ordered.reduce((sum, item) => sum + item.centroid.y * item.pixelCount, 0) / totalWeight,
  }
  const seed = hashInts(ordered.flatMap((item) => [item.label, item.pixelCount, ...item.meanColor]))
  const random = createSeededRandom(seed)
  const template: Point[] = [
    { x: -0.7, y: 0.72 }, { x: -0.78, y: 0.1 }, { x: -0.58, y: -0.58 },
    { x: -0.05, y: -0.78 }, { x: 0.62, y: -0.55 }, { x: 0.76, y: -0.04 },
    { x: 0.32, y: 0.12 }, { x: 0.66, y: 0.52 }, { x: 0.08, y: 0.74 },
    { x: -0.28, y: 0.25 }, { x: 0.12, y: 0.02 }, { x: -0.04, y: 0.7 },
  ]
  const dominantAngle = ordered[0].orientationRad * 0.22
  const extent = canvasSize * 0.43
  return template.map((point, index) => {
    const source = ordered[index % ordered.length]
    const jitterX = (source.centroid.x - centre.x) * 0.08 + (random() - 0.5) * canvasSize * 0.035
    const jitterY = (source.centroid.y - centre.y) * 0.08 + (random() - 0.5) * canvasSize * 0.035
    const x = point.x * extent
    const y = point.y * extent
    return {
      x: canvasSize / 2 + x * Math.cos(dominantAngle) - y * Math.sin(dominantAngle) + jitterX,
      y: canvasSize / 2 + x * Math.sin(dominantAngle) + y * Math.cos(dominantAngle) + jitterY,
    }
  })
}
