import { describe, it, expect } from 'vitest'
import {
  hashInts,
  createSeededRandom,
  rgbToHsl,
  hslToRgb,
  harmonizePalette,
  extractPalette,
  nearestPaletteIndex,
  quantizeToLabels,
  mergeSmallRegions,
  findConnectedComponents,
  regionSizes,
  regionCentroid,
  computeSquareFitRect,
  colorDistanceSq,
  luminance,
  reducePalette,
  remapLabels,
  traceRegionContours,
  simplifyPath,
  chaikinSmooth,
  polygonArea,
  boxBlurGrid,
  computeMassStatistics,
  buildAdjacency,
  scoreFocalCandidacy,
  classifyMassShape,
  generateRegularizedMassPoints,
  generateNestedBands,
  chooseAccentMass,
  boundsOfPoints,
  gradientContrastFor,
  generateCutMassPoints,
  generateGlassMassPoints,
  cutToneColor,
  glassToneColor,
  type RGB,
  type Point,
  type MassStats,
} from './mark-math'

describe('hashInts — deterministic, non-cryptographic', () => {
  it('the same input always produces the same hash', () => {
    const input = [1, 2, 3, 250, 0]
    expect(hashInts(input)).toBe(hashInts(input))
    expect(hashInts([...input])).toBe(hashInts(input))
  })

  it('a different input produces a different hash (not a constant function)', () => {
    expect(hashInts([1, 2, 3])).not.toBe(hashInts([3, 2, 1]))
  })

  it('always returns a non-negative 32-bit unsigned integer', () => {
    const h = hashInts([255, 255, 255, 255])
    expect(h).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeLessThanOrEqual(0xffffffff)
  })
})

describe('createSeededRandom — mulberry32, never Math.random', () => {
  it('the same seed replays the exact same sequence', () => {
    const a = createSeededRandom(12345)
    const b = createSeededRandom(12345)
    const seqA = [a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })

  it('different seeds produce different sequences', () => {
    const a = createSeededRandom(1)
    const b = createSeededRandom(2)
    expect(a()).not.toBe(b())
  })

  it('every value stays within [0, 1)', () => {
    const rand = createSeededRandom(999)
    for (let i = 0; i < 200; i++) {
      const v = rand()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('colour conversions — rgbToHsl / hslToRgb round-trip', () => {
  it('round-trips primary colours within a small rounding tolerance', () => {
    const cases: RGB[] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [128, 64, 200],
      [10, 200, 90],
    ]
    for (const rgb of cases) {
      const back = hslToRgb(rgbToHsl(rgb))
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(back[i] - rgb[i])).toBeLessThanOrEqual(1)
      }
    }
  })

  it('a pure grey has zero saturation', () => {
    const [, s] = rgbToHsl([128, 128, 128])
    expect(s).toBe(0)
  })
})

describe('harmonizePalette — restrained, never flat-grey, never garish', () => {
  it('never fully desaturates a colour that started with some saturation', () => {
    const harmonized = harmonizePalette([[255, 0, 0]])
    const [, s] = rgbToHsl(harmonized[0])
    expect(s).toBeGreaterThan(0)
  })

  // 8-bit RGB round-tripping (harmonize -> integer RGB -> re-measure
  // via rgbToHsl) inherently loses a fraction of a percent of
  // precision — these use a small epsilon rather than the theoretical
  // exact clamp boundary, which is a real-number constraint the 8-bit
  // storage format itself cannot represent exactly.
  const EPSILON = 0.002

  it('caps saturation below a "shouting" ceiling even for a fully saturated source colour', () => {
    const harmonized = harmonizePalette([[255, 0, 0]])
    const [, s] = rgbToHsl(harmonized[0])
    expect(s).toBeLessThanOrEqual(0.6 + EPSILON)
  })

  it('never crushes lightness fully to black or white', () => {
    const harmonized = harmonizePalette([
      [0, 0, 0],
      [255, 255, 255],
    ])
    for (const rgb of harmonized) {
      const [, , l] = rgbToHsl(rgb)
      expect(l).toBeGreaterThanOrEqual(0.14 - EPSILON)
      expect(l).toBeLessThanOrEqual(0.88 + EPSILON)
    }
  })

  it('preserves hue — the actual source-derived colour relationship — unchanged', () => {
    const [h] = rgbToHsl([40, 120, 200])
    const [hHarmonized] = rgbToHsl(harmonizePalette([[40, 120, 200]])[0])
    expect(Math.abs(hHarmonized - h)).toBeLessThan(0.01)
  })

  it('is a pure function: the same palette in always produces the same palette out', () => {
    const palette: RGB[] = [
      [12, 200, 90],
      [220, 40, 60],
    ]
    expect(harmonizePalette(palette)).toEqual(harmonizePalette([...palette.map((c) => [...c] as RGB)]))
  })
})

describe('extractPalette — deterministic k-means, no PRNG involved', () => {
  function repeat(color: RGB, n: number): RGB[] {
    return Array.from({ length: n }, () => [...color] as RGB)
  }

  it('the same samples always produce the same palette, in the same order', () => {
    const samples: RGB[] = [...repeat([10, 10, 10], 20), ...repeat([240, 240, 240], 20)]
    const a = extractPalette(samples, 2)
    const b = extractPalette([...samples], 2)
    expect(a).toEqual(b)
  })

  it('two well-separated colour clusters converge to (approximately) those two colours', () => {
    const samples: RGB[] = [...repeat([200, 20, 20], 30), ...repeat([20, 20, 200], 30)]
    const palette = extractPalette(samples, 2)
    expect(palette).toHaveLength(2)
    const distances = palette.map((c) => Math.min(colorDistanceSq(c, [200, 20, 20]), colorDistanceSq(c, [20, 20, 200])))
    for (const d of distances) expect(d).toBeLessThan(400) // close to one of the two source clusters
  })

  it('never returns more colours than requested, even with abundant samples', () => {
    const samples: RGB[] = Array.from({ length: 50 }, (_, i) => [i * 4, i * 4, i * 4])
    expect(extractPalette(samples, 4)).toHaveLength(4)
  })

  it('clamps palette size to the number of available samples, never crashing on too few', () => {
    const samples: RGB[] = [[10, 10, 10], [20, 20, 20]]
    expect(extractPalette(samples, 6)).toHaveLength(2)
  })

  it('returns an empty palette for an empty sample list, without throwing', () => {
    expect(extractPalette([], 6)).toEqual([])
  })
})

describe('nearestPaletteIndex / quantizeToLabels', () => {
  const palette: RGB[] = [
    [0, 0, 0],
    [255, 255, 255],
  ]

  it('assigns a dark sample to the dark palette entry', () => {
    expect(nearestPaletteIndex([10, 5, 5], palette)).toBe(0)
  })

  it('assigns a light sample to the light palette entry', () => {
    expect(nearestPaletteIndex([250, 250, 245], palette)).toBe(1)
  })

  it('quantizeToLabels labels every sample, in order', () => {
    const samples: RGB[] = [[5, 5, 5], [250, 250, 250], [0, 0, 0]]
    expect(Array.from(quantizeToLabels(samples, palette))).toEqual([0, 1, 0])
  })
})

describe('mergeSmallRegions — insignificant regions absorb into their dominant neighbour', () => {
  it('a single stray cell surrounded by one other label is reassigned to that label', () => {
    // 3x3 grid, all label 0 except the very center, which is a lone
    // label-1 cell — an insignificant one-cell "region."
    // 0 0 0
    // 0 1 0
    // 0 0 0
    const labels = Int32Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0])
    const merged = mergeSmallRegions(labels, 3, 3, 2)
    expect(Array.from(merged)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('a region at or above the minimum size survives untouched', () => {
    // Left column label 1 (3 cells), rest label 0 — a genuinely
    // significant region at minRegionSize = 2.
    // 1 0 0
    // 1 0 0
    // 1 0 0
    const labels = Int32Array.from([1, 0, 0, 1, 0, 0, 1, 0, 0])
    const merged = mergeSmallRegions(labels, 3, 3, 2)
    expect(Array.from(merged)).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0])
  })

  it('is a pure function — the same grid in always produces the same grid out', () => {
    const labels = Int32Array.from([0, 0, 1, 0, 2, 1, 1, 1, 0])
    const a = mergeSmallRegions(labels, 3, 3, 2)
    const b = mergeSmallRegions(Int32Array.from(labels), 3, 3, 2)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('never crashes when the whole grid is a single region smaller than minRegionSize', () => {
    const labels = Int32Array.from([5, 5, 5, 5])
    expect(() => mergeSmallRegions(labels, 2, 2, 10)).not.toThrow()
  })
})

describe('regionSizes / regionCentroid', () => {
  it('regionSizes counts every cell exactly once, across all labels', () => {
    const labels = Int32Array.from([0, 0, 1, 1, 1, 2])
    const sizes = regionSizes(labels, 3)
    expect(sizes).toEqual([2, 3, 1])
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(labels.length)
  })

  it('regionCentroid finds the mean position of a symmetric region', () => {
    // label 1 occupies the whole middle column of a 3x3 grid — centroid
    // should land exactly at (1, 1).
    const labels = Int32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0])
    const centroid = regionCentroid(labels, 3, 3, 1)
    expect(centroid).toEqual({ x: 1, y: 1, count: 3 })
  })

  it('regionCentroid falls back to the grid center for a label with no members, never NaN', () => {
    const labels = Int32Array.from([0, 0, 0, 0])
    const centroid = regionCentroid(labels, 2, 2, 9)
    expect(centroid.count).toBe(0)
    expect(Number.isNaN(centroid.x)).toBe(false)
    expect(Number.isNaN(centroid.y)).toBe(false)
  })
})

describe('computeSquareFitRect — center-crop math, never subject-detection-driven', () => {
  it('a landscape image crops symmetrically from the left/right', () => {
    const fit = computeSquareFitRect(400, 200)
    expect(fit).toEqual({ sx: 100, sy: 0, size: 200 })
  })

  it('a portrait image crops symmetrically from the top/bottom', () => {
    const fit = computeSquareFitRect(200, 400)
    expect(fit).toEqual({ sx: 0, sy: 100, size: 200 })
  })

  it('an already-square image needs no crop offset', () => {
    const fit = computeSquareFitRect(300, 300)
    expect(fit).toEqual({ sx: 0, sy: 0, size: 300 })
  })

  it('is a pure function of width/height alone — no dependency on pixel content, i.e. no face/subject detection', () => {
    expect(computeSquareFitRect(400, 200)).toEqual(computeSquareFitRect(400, 200))
  })
})

describe('luminance / colorDistanceSq — sanity', () => {
  it('white has greater luminance than black', () => {
    expect(luminance([255, 255, 255])).toBeGreaterThan(luminance([0, 0, 0]))
  })

  it('an identical colour has zero distance from itself', () => {
    expect(colorDistanceSq([10, 20, 30], [10, 20, 30])).toBe(0)
  })
})

// ============================================================
// CHECKPOINT 1B — organic geometry pass
// ============================================================

describe('findConnectedComponents — 4-connected flood fill, independent of palette label', () => {
  it('two disjoint blobs of the SAME label are two separate components', () => {
    // 1 0 1
    // 0 0 0
    // 1 0 1
    const labels = Int32Array.from([1, 0, 1, 0, 0, 0, 1, 0, 1])
    const { count } = findConnectedComponents(labels, 3, 3)
    // four isolated label-1 corners + one connected label-0 cross = 5 components
    expect(count).toBe(5)
  })

  it('a single fully-connected label is exactly one component', () => {
    const labels = Int32Array.from([7, 7, 7, 7])
    const { count, sizes } = findConnectedComponents(labels, 2, 2)
    expect(count).toBe(1)
    expect(sizes).toEqual([4])
  })

  it('is a pure function — same grid in, same result out', () => {
    const labels = Int32Array.from([0, 1, 1, 0])
    const a = findConnectedComponents(labels, 2, 2)
    const b = findConnectedComponents(Int32Array.from(labels), 2, 2)
    expect(Array.from(a.componentId)).toEqual(Array.from(b.componentId))
    expect(a.sizes).toEqual(b.sizes)
  })
})

describe('reducePalette — deterministic closest-pair agglomerative merging (area + colour)', () => {
  it('merges two colours closer than the threshold, area-weighting the result', () => {
    const palette: RGB[] = [
      [100, 100, 100],
      [102, 100, 100], // within a tiny threshold of the first
      [10, 200, 10], // far away, untouched
    ]
    const weights = [10, 30, 5]
    const { palette: reduced, mapping } = reducePalette(palette, weights, {
      colorMergeThresholdSq: 100,
      maxRegions: 10,
    })
    expect(reduced).toHaveLength(2)
    expect(mapping[0]).toBe(mapping[1]) // the two close colours landed in the same final entry
    expect(mapping[2]).not.toBe(mapping[0])
    // Area-weighted mean, not a naive 50/50 average (which would land
    // at 101): (100*10 + 102*30) / 40 = 101.5, rounding to 102 — closer
    // to entry 1 (weight 30) than a naive midpoint would be.
    const mergedColor = reduced[mapping[0]]
    expect(mergedColor[0]).toBeGreaterThan(101)
    expect(mergedColor[0]).toBeLessThanOrEqual(102)
  })

  it('never merges colours further apart than the threshold, when already at or under the region cap', () => {
    const palette: RGB[] = [
      [0, 0, 0],
      [255, 255, 255],
    ]
    const { palette: reduced } = reducePalette(palette, [10, 10], {
      colorMergeThresholdSq: 100,
      maxRegions: 10,
    })
    expect(reduced).toHaveLength(2)
  })

  it('enforces the hard maxRegions cap even when no two colours are otherwise similar', () => {
    const palette: RGB[] = [
      [0, 0, 0],
      [80, 0, 0],
      [160, 0, 0],
      [240, 0, 0],
    ]
    const { palette: reduced } = reducePalette(palette, [1, 1, 1, 1], {
      colorMergeThresholdSq: 1, // effectively "never merge for similarity"
      maxRegions: 2,
    })
    expect(reduced).toHaveLength(2)
  })

  it('every mapping index lands within bounds of the reduced palette', () => {
    const palette: RGB[] = [[1, 1, 1], [2, 2, 2], [200, 0, 0], [201, 0, 0], [5, 5, 5]]
    const { palette: reduced, mapping } = reducePalette(palette, [1, 1, 1, 1, 1], {
      colorMergeThresholdSq: 30,
      maxRegions: 8,
    })
    for (const m of mapping) {
      expect(m).toBeGreaterThanOrEqual(0)
      expect(m).toBeLessThan(reduced.length)
    }
  })

  it('is deterministic — the same palette and weights always reduce identically', () => {
    const palette: RGB[] = [[10, 10, 10], [12, 11, 10], [200, 200, 10], [199, 201, 11]]
    const weights = [4, 6, 3, 9]
    const a = reducePalette(palette, weights, { colorMergeThresholdSq: 50, maxRegions: 6 })
    const b = reducePalette([...palette.map((c) => [...c] as RGB)], [...weights], {
      colorMergeThresholdSq: 50,
      maxRegions: 6,
    })
    expect(a.palette).toEqual(b.palette)
    expect(a.mapping).toEqual(b.mapping)
  })
})

describe('remapLabels', () => {
  it('remaps every cell through the given mapping', () => {
    const labels = Int32Array.from([0, 1, 2, 1])
    const mapping = [5, 6, 5] // labels 0 and 2 both collapse onto 5
    expect(Array.from(remapLabels(labels, mapping))).toEqual([5, 6, 5, 6])
  })
})

// A small helper: every consecutive pair in a closed loop (including
// the wrap from the last point back to the first) must be exactly one
// grid unit apart, horizontally or vertically — the generic "this is a
// well-formed, actually-closed boundary" property every loop
// traceRegionContours returns must satisfy, regardless of the mask.
function assertLoopCloses(loop: Point[]) {
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    const dx = Math.abs(a.x - b.x)
    const dy = Math.abs(a.y - b.y)
    const isUnitStep = (dx === 1 && dy === 0) || (dx === 0 && dy === 1)
    expect(isUnitStep, `expected a unit step between ${JSON.stringify(a)} and ${JSON.stringify(b)}`).toBe(true)
  }
}

describe('traceRegionContours — deterministic boundary extraction (marching-squares equivalent for a binary mask)', () => {
  it('an empty mask produces no contours', () => {
    expect(traceRegionContours(new Uint8Array(9), 3, 3)).toEqual([])
  })

  it('a fully-filled 2x2 mask traces exactly its 8-point perimeter, in order', () => {
    const mask = Uint8Array.from([1, 1, 1, 1])
    const loops = traceRegionContours(mask, 2, 2)
    expect(loops).toHaveLength(1)
    expect(loops[0]).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 1 },
    ])
  })

  it('every returned loop actually closes — every consecutive pair (wrapping) is a unit step', () => {
    // An irregular blob with a concave notch:
    // 1 1 1
    // 1 0 1
    // 1 1 1
    const mask = Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1])
    const loops = traceRegionContours(mask, 3, 3)
    expect(loops.length).toBeGreaterThan(0)
    for (const loop of loops) assertLoopCloses(loop)
  })

  it('a region with a hole produces two loops — an outer boundary and an inner hole boundary', () => {
    // 1 1 1
    // 1 0 1
    // 1 1 1
    const mask = Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1])
    const loops = traceRegionContours(mask, 3, 3)
    expect(loops).toHaveLength(2)
    const sizes = loops.map((l) => l.length).sort((a, b) => a - b)
    expect(sizes[0]).toBe(4) // the small hole around the single missing center cell
    expect(sizes[1]).toBe(12) // the outer 3x3 perimeter
  })

  it('is deterministic — the same mask always traces identically', () => {
    const mask = Uint8Array.from([1, 1, 0, 1, 1, 1, 0, 1, 1])
    const a = traceRegionContours(mask, 3, 3)
    const b = traceRegionContours(Uint8Array.from(mask), 3, 3)
    expect(a).toEqual(b)
  })

  it('every traced point stays within the mask bounds', () => {
    const mask = Uint8Array.from([1, 1, 1, 0, 1, 0, 1, 1, 1])
    const loops = traceRegionContours(mask, 3, 3)
    for (const loop of loops) {
      for (const p of loop) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(3)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(3)
      }
    }
  })
})

describe('simplifyPath — Ramer-Douglas-Peucker', () => {
  it('removes collinear points along a straight run, keeping the endpoints', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
    ]
    const simplified = simplifyPath(points, 0.1)
    expect(simplified).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
    ])
  })

  it('keeps a genuine corner that exceeds epsilon', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 5 }, // a real spike, far from the 0,0 -> 2,0 line
      { x: 2, y: 0 },
    ]
    const simplified = simplifyPath(points, 0.5)
    expect(simplified).toEqual(points)
  })

  it('a larger epsilon simplifies at least as aggressively as a smaller one', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0.2 },
      { x: 2, y: -0.2 },
      { x: 3, y: 0.3 },
      { x: 4, y: 0 },
    ]
    const loose = simplifyPath(points, 5)
    const tight = simplifyPath(points, 0.01)
    expect(loose.length).toBeLessThanOrEqual(tight.length)
  })

  it('is deterministic and never returns more points than it was given', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 2, y: 1 },
      { x: 4, y: 0 },
      { x: 6, y: 2 },
    ]
    const a = simplifyPath(points, 0.4)
    const b = simplifyPath([...points], 0.4)
    expect(a).toEqual(b)
    expect(a.length).toBeLessThanOrEqual(points.length)
  })
})

describe('chaikinSmooth — deterministic corner cutting, never escapes input bounds', () => {
  function boundsOf(points: Point[]) {
    return {
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxY: Math.max(...points.map((p) => p.y)),
    }
  }

  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ]

  it('is deterministic — the same points and iteration count always smooth identically', () => {
    const a = chaikinSmooth(square, 3)
    const b = chaikinSmooth(square.map((p) => ({ ...p })), 3)
    expect(a).toEqual(b)
  })

  it('never produces a point outside the original bounding box (every output point is a convex combination of two input points)', () => {
    const smoothed = chaikinSmooth(square, 4)
    const original = boundsOf(square)
    const result = boundsOf(smoothed)
    expect(result.minX).toBeGreaterThanOrEqual(original.minX)
    expect(result.maxX).toBeLessThanOrEqual(original.maxX)
    expect(result.minY).toBeGreaterThanOrEqual(original.minY)
    expect(result.maxY).toBeLessThanOrEqual(original.maxY)
  })

  it('cuts every corner — no output point exactly reproduces an original sharp corner', () => {
    const smoothed = chaikinSmooth(square, 1)
    for (const corner of square) {
      expect(smoothed).not.toContainEqual(corner)
    }
  })

  it('doubles the point count each iteration for a closed polygon', () => {
    expect(chaikinSmooth(square, 1)).toHaveLength(square.length * 2)
    expect(chaikinSmooth(square, 2)).toHaveLength(square.length * 4)
  })

  it('zero iterations returns the input unchanged', () => {
    expect(chaikinSmooth(square, 0)).toEqual(square)
  })
})

describe('polygonArea', () => {
  it('computes the exact area of a simple square', () => {
    const square: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    expect(Math.abs(polygonArea(square))).toBe(16)
  })

  it('a larger polygon has a larger absolute area than a smaller one', () => {
    const small: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
    const large: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(Math.abs(polygonArea(large))).toBeGreaterThan(Math.abs(polygonArea(small)))
  })
})

// ============================================================
// ALGORITHM V3 — compositional abstraction engine
// ============================================================

describe('boxBlurGrid — deterministic pre-clustering smoothing (texture-as-statistic mechanism)', () => {
  it('a uniform grid is unchanged by blurring', () => {
    const samples: RGB[] = Array.from({ length: 9 }, () => [100, 100, 100])
    expect(boxBlurGrid(samples, 3, 3, 1)).toEqual(samples)
  })

  it('radius 0 returns an unchanged copy', () => {
    const samples: RGB[] = [[10, 20, 30], [200, 200, 200]]
    const blurred = boxBlurGrid(samples, 2, 1, 0)
    expect(blurred).toEqual(samples)
    expect(blurred).not.toBe(samples) // a copy, not the same array reference
  })

  it('smooths a single bright outlier toward its darker neighbours', () => {
    // 3x3 all dark except the center, which is bright.
    const samples: RGB[] = Array.from({ length: 9 }, () => [0, 0, 0])
    samples[4] = [255, 255, 255]
    const blurred = boxBlurGrid(samples, 3, 3, 1)
    expect(blurred[4][0]).toBeLessThan(255) // the outlier itself is pulled down
    expect(blurred[4][0]).toBeGreaterThan(0)
    expect(blurred[1][0]).toBeGreaterThan(0) // a neighbour picks up some brightness
  })

  it('is deterministic', () => {
    const samples: RGB[] = [[10, 20, 30], [40, 50, 60], [70, 80, 90], [100, 110, 120]]
    const a = boxBlurGrid(samples, 2, 2, 1)
    const b = boxBlurGrid([...samples.map((c) => [...c] as RGB)], 2, 2, 1)
    expect(a).toEqual(b)
  })
})

describe('computeMassStatistics — geometry/tonal statistics from a mask, never from semantic knowledge', () => {
  function flatColorGrid(width: number, height: number, color: RGB): RGB[] {
    return Array.from({ length: width * height }, () => [...color] as RGB)
  }

  it('a fully-filled square mask centers correctly, fills its own bounding box, and reads as unelongated', () => {
    const mask = Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1]) // 3x3
    const colors = flatColorGrid(3, 3, [100, 100, 100])
    const stats = computeMassStatistics(mask, 3, 3, colors, 0)
    expect(stats.centroid).toEqual({ x: 1, y: 1 })
    expect(stats.pixelCount).toBe(9)
    expect(stats.compactness).toBeCloseTo(1, 5)
    expect(stats.elongation).toBeCloseTo(1, 1)
  })

  it('a horizontally elongated mask reports elongation greater than 1', () => {
    // 1 row x 6 cols, all inside.
    const mask = Uint8Array.from([1, 1, 1, 1, 1, 1])
    const colors = flatColorGrid(6, 1, [50, 50, 50])
    const stats = computeMassStatistics(mask, 6, 1, colors, 0)
    expect(stats.elongation).toBeGreaterThan(1)
  })

  it('a uniformly-coloured mass has zero texture energy', () => {
    const mask = Uint8Array.from([1, 1, 1, 1])
    const colors = flatColorGrid(2, 2, [80, 80, 80])
    const stats = computeMassStatistics(mask, 2, 2, colors, 0)
    expect(stats.textureEnergy).toBe(0)
  })

  it('a mass spanning very different colours has non-zero texture energy', () => {
    const mask = Uint8Array.from([1, 1, 1, 1])
    const colors: RGB[] = [[0, 0, 0], [255, 255, 255], [0, 0, 0], [255, 255, 255]]
    const stats = computeMassStatistics(mask, 2, 2, colors, 0)
    expect(stats.textureEnergy).toBeGreaterThan(0)
  })

  it('correctly flags which canvas edges the mass touches', () => {
    // 3x3 grid, mask covers only the top-left cell (0,0) — touches top and left, not bottom/right.
    const mask = Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0])
    const colors = flatColorGrid(3, 3, [1, 1, 1])
    const stats = computeMassStatistics(mask, 3, 3, colors, 0)
    expect(stats.touchesEdge).toEqual({ top: true, bottom: false, left: true, right: false })
  })

  it('an empty mask returns a well-formed, non-NaN result rather than crashing', () => {
    const mask = new Uint8Array(9)
    const colors = flatColorGrid(3, 3, [1, 1, 1])
    const stats = computeMassStatistics(mask, 3, 3, colors, 0)
    expect(stats.pixelCount).toBe(0)
    expect(Number.isNaN(stats.centroid.x)).toBe(false)
    expect(Number.isNaN(stats.centroid.y)).toBe(false)
    expect(Number.isNaN(stats.orientationRad)).toBe(false)
  })

  it('is deterministic — same mask and colours always produce the same statistics', () => {
    const mask = Uint8Array.from([1, 1, 0, 1])
    const colors: RGB[] = [[10, 20, 30], [40, 50, 60], [0, 0, 0], [70, 80, 90]]
    const a = computeMassStatistics(mask, 2, 2, colors, 3)
    const b = computeMassStatistics(Uint8Array.from(mask), 2, 2, [...colors.map((c) => [...c] as RGB)], 3)
    expect(a).toEqual(b)
  })
})

describe('buildAdjacency', () => {
  it('two components sharing a grid edge are mutually adjacent', () => {
    // component 0 | component 1
    const componentId = Int32Array.from([0, 1, 0, 1])
    const adjacency = buildAdjacency(componentId, 2, 2, 2)
    expect(adjacency[0].has(1)).toBe(true)
    expect(adjacency[1].has(0)).toBe(true)
  })

  it('two components with no shared edge are not adjacent', () => {
    // 0 0 1
    // 0 0 1
    // 1 1 2
    // Component 0 (top-left 2x2) and component 2 (bottom-right corner
    // only) never share a grid edge — component 1 sits between them.
    const componentId = Int32Array.from([0, 0, 1, 0, 0, 1, 1, 1, 2])
    const adjacency = buildAdjacency(componentId, 3, 3, 3)
    expect(adjacency[0].has(2)).toBe(false)
    expect(adjacency[2].has(0)).toBe(false)
    // Sanity: 0 and 1 (and 1 and 2) ARE adjacent, confirming the grid
    // itself is wired the way this test assumes.
    expect(adjacency[0].has(1)).toBe(true)
    expect(adjacency[1].has(2)).toBe(true)
  })
})

describe('scoreFocalCandidacy — generic statistics only, no position/semantic bias', () => {
  function baseStats(overrides: Partial<MassStats>): MassStats {
    return {
      label: 0,
      centroid: { x: 24, y: 24 },
      pixelCount: 100,
      boundingBox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      orientationRad: 0,
      elongation: 1,
      compactness: 0.8,
      meanColor: [128, 128, 128],
      minLuminance: 100,
      maxLuminance: 150,
      textureEnergy: 0,
      touchesEdge: { top: false, bottom: false, left: false, right: false },
      ...overrides,
    }
  }

  it('returns 0 for an empty "others" list rather than crashing', () => {
    expect(scoreFocalCandidacy(baseStats({}), [], 1000, 48)).toBe(0)
  })

  it('a colour-distinctive mass scores higher than one identical to its surroundings, all else equal', () => {
    const others = [baseStats({ meanColor: [30, 30, 30], pixelCount: 800 })]
    const distinctive = baseStats({ meanColor: [230, 30, 30], pixelCount: 100 })
    const blendsIn = baseStats({ meanColor: [30, 30, 30], pixelCount: 100 })
    expect(scoreFocalCandidacy(distinctive, others, 1000, 48)).toBeGreaterThan(
      scoreFocalCandidacy(blendsIn, others, 1000, 48)
    )
  })

  it('centrality is only a weak tiebreaker — a central mass scores at least as high as an identical corner mass', () => {
    const others = [baseStats({ meanColor: [30, 30, 30], pixelCount: 800 })]
    const central = baseStats({ meanColor: [230, 30, 30], pixelCount: 100, centroid: { x: 24, y: 24 } })
    const corner = baseStats({ meanColor: [230, 30, 30], pixelCount: 100, centroid: { x: 1, y: 1 } })
    expect(scoreFocalCandidacy(central, others, 1000, 48)).toBeGreaterThanOrEqual(
      scoreFocalCandidacy(corner, others, 1000, 48)
    )
  })

  it('is deterministic', () => {
    const others = [baseStats({ meanColor: [10, 10, 10] })]
    const target = baseStats({ meanColor: [200, 200, 200] })
    expect(scoreFocalCandidacy(target, others, 1000, 48)).toBe(scoreFocalCandidacy(target, others, 1000, 48))
  })
})

describe('classifyMassShape — geometry only, never colour or position semantics', () => {
  function baseStats(overrides: Partial<MassStats>): MassStats {
    return {
      label: 0,
      centroid: { x: 24, y: 24 },
      pixelCount: 100,
      boundingBox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      orientationRad: 0,
      elongation: 1,
      compactness: 0.8,
      meanColor: [128, 128, 128],
      minLuminance: 100,
      maxLuminance: 150,
      textureEnergy: 0,
      touchesEdge: { top: false, bottom: false, left: false, right: false },
      ...overrides,
    }
  }

  it('a highly elongated, modest-size mass classifies as a sweep', () => {
    expect(classifyMassShape(baseStats({ elongation: 3, pixelCount: 50 }), 1000)).toBe('sweep')
  })

  it('a very large mass classifies as a field regardless of elongation', () => {
    expect(classifyMassShape(baseStats({ elongation: 1, pixelCount: 400 }), 1000)).toBe('field')
  })

  it('a compact, modest-size mass classifies as a lobe', () => {
    expect(classifyMassShape(baseStats({ elongation: 1.1, pixelCount: 50 }), 1000)).toBe('lobe')
  })

  it('is deterministic', () => {
    const stats = baseStats({ elongation: 2, pixelCount: 80 })
    expect(classifyMassShape(stats, 1000)).toBe(classifyMassShape(stats, 1000))
  })
})

describe('generateRegularizedMassPoints — parametric, never a literal traced contour', () => {
  function baseStats(overrides: Partial<MassStats>): MassStats {
    return {
      label: 0,
      centroid: { x: 24, y: 24 },
      pixelCount: 100,
      boundingBox: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
      orientationRad: 0,
      elongation: 1,
      compactness: 0.8,
      meanColor: [128, 128, 128],
      minLuminance: 100,
      maxLuminance: 150,
      textureEnergy: 0,
      touchesEdge: { top: false, bottom: false, left: false, right: false },
      ...overrides,
    }
  }

  it('returns the requested number of points', () => {
    expect(generateRegularizedMassPoints(baseStats({}), 'lobe', 48, 16)).toHaveLength(16)
  })

  it('the generated points are centered on the mass\'s own centroid', () => {
    const points = generateRegularizedMassPoints(baseStats({}), 'lobe', 48, 20)
    const meanX = points.reduce((s, p) => s + p.x, 0) / points.length
    const meanY = points.reduce((s, p) => s + p.y, 0) / points.length
    expect(meanX).toBeCloseTo(24, 0)
    expect(meanY).toBeCloseTo(24, 0)
  })

  it('a "field" style spreads further from centroid than a "lobe" for the same statistics', () => {
    const stats = baseStats({})
    const lobePoints = generateRegularizedMassPoints(stats, 'lobe', 48, 20)
    const fieldPoints = generateRegularizedMassPoints(stats, 'field', 48, 20)
    const avgRadius = (pts: Point[]) =>
      pts.reduce((s, p) => s + Math.hypot(p.x - 24, p.y - 24), 0) / pts.length
    expect(avgRadius(fieldPoints)).toBeGreaterThan(avgRadius(lobePoints))
  })

  it('is deterministic', () => {
    const stats = baseStats({ elongation: 1.5 })
    const a = generateRegularizedMassPoints(stats, 'sweep', 48, 20)
    const b = generateRegularizedMassPoints({ ...stats }, 'sweep', 48, 20)
    expect(a).toEqual(b)
  })
})

describe('generateNestedBands — texture-as-tonal-range, never as extra geometry', () => {
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]
  const centroid = { x: 5, y: 5 }

  it('a single band returns the base shape unchanged', () => {
    const bands = generateNestedBands(square, centroid, 0, 1)
    expect(bands).toHaveLength(1)
    expect(bands[0].points).toEqual(square)
  })

  it('multiple bands are each successively smaller (closer to the centroid on average)', () => {
    const bands = generateNestedBands(square, centroid, 0, 3)
    expect(bands).toHaveLength(3)
    const avgRadius = (pts: Point[]) => pts.reduce((s, p) => s + Math.hypot(p.x - 5, p.y - 5), 0) / pts.length
    expect(avgRadius(bands[1].points)).toBeLessThan(avgRadius(bands[0].points))
    expect(avgRadius(bands[2].points)).toBeLessThan(avgRadius(bands[1].points))
  })

  it('band t values span from 0 to 1', () => {
    const bands = generateNestedBands(square, centroid, 0, 4)
    expect(bands[0].t).toBe(0)
    expect(bands[bands.length - 1].t).toBe(1)
  })

  it('is deterministic', () => {
    const a = generateNestedBands(square, centroid, 0.4, 3)
    const b = generateNestedBands([...square.map((p) => ({ ...p }))], { ...centroid }, 0.4, 3)
    expect(a).toEqual(b)
  })
})

describe('chooseAccentMass — a genuinely present minor hue, never an invented one', () => {
  it('picks the smallest mass that is still above the minimum floor', () => {
    const masses = [
      { label: 0, meanColor: [10, 10, 10] as RGB, pixelCount: 500 },
      { label: 1, meanColor: [200, 50, 50] as RGB, pixelCount: 60 },
      { label: 2, meanColor: [50, 200, 50] as RGB, pixelCount: 5 }, // below the floor
    ]
    const accent = chooseAccentMass(masses, 1000, 0.02, 0.3)
    expect(accent?.label).toBe(1)
  })

  it('returns null when nothing qualifies — never manufactures an accent', () => {
    const masses = [
      { label: 0, meanColor: [10, 10, 10] as RGB, pixelCount: 900 },
      { label: 1, meanColor: [200, 50, 50] as RGB, pixelCount: 100 },
    ]
    // Both masses exceed maxFraction — no legitimate "minor" mass exists.
    expect(chooseAccentMass(masses, 1000, 0.5, 0.6)).toBeNull()
  })

  it('is deterministic', () => {
    const masses = [
      { label: 0, meanColor: [10, 10, 10] as RGB, pixelCount: 500 },
      { label: 1, meanColor: [200, 50, 50] as RGB, pixelCount: 60 },
    ]
    expect(chooseAccentMass(masses, 1000, 0.02, 0.3)).toEqual(chooseAccentMass(masses, 1000, 0.02, 0.3))
  })
})

describe('Checkpoint 1B pipeline pieces compose deterministically end-to-end', () => {
  it('trace -> simplify -> smooth is deterministic as a whole for the same mask', () => {
    const mask = Uint8Array.from([
      1, 1, 1, 0, 0,
      1, 1, 1, 1, 0,
      0, 1, 1, 1, 1,
      0, 0, 1, 1, 1,
      0, 0, 0, 1, 1,
    ])
    function run() {
      const loops = traceRegionContours(mask, 5, 5)
      return loops.map((loop) => chaikinSmooth(simplifyPath(loop, 0.6), 3))
    }
    expect(run()).toEqual(run())
  })
})

// ============================================================
// "CHOOSE YOUR MARK" CHECKPOINT — V4 CUT / V5 GLASS SHARED PRIMITIVES
// ============================================================

function baseCutGlassStats(overrides: Partial<MassStats>): MassStats {
  return {
    label: 0,
    centroid: { x: 24, y: 24 },
    pixelCount: 100,
    boundingBox: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
    orientationRad: 0,
    elongation: 1,
    compactness: 0.8,
    meanColor: [128, 128, 128],
    minLuminance: 100,
    maxLuminance: 150,
    textureEnergy: 0,
    touchesEdge: { top: false, bottom: false, left: false, right: false },
    ...overrides,
  }
}

describe('boundsOfPoints', () => {
  it('returns the axis-aligned center and half-extents of a point set', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
      { x: 0, y: 6 },
    ]
    expect(boundsOfPoints(points)).toEqual({ cx: 5, cy: 3, rx: 5, ry: 3 })
  })

  it('returns a safe, non-degenerate fallback for an empty point set', () => {
    const bounds = boundsOfPoints([])
    expect(bounds.rx).toBeGreaterThan(0)
    expect(bounds.ry).toBeGreaterThan(0)
  })
})

describe('gradientContrastFor — continuous analogue of v3\'s discrete bandCountFor', () => {
  it('near-zero texture energy produces the minimum contrast', () => {
    expect(gradientContrastFor(0)).toBeCloseTo(0.08, 5)
  })

  it('higher texture energy produces higher contrast, monotonically', () => {
    const low = gradientContrastFor(200)
    const mid = gradientContrastFor(1500)
    const high = gradientContrastFor(4000)
    expect(mid).toBeGreaterThan(low)
    expect(high).toBeGreaterThan(mid)
  })

  it('contrast is bounded — texture energy can never blow it past the ceiling', () => {
    expect(gradientContrastFor(1_000_000)).toBeLessThanOrEqual(0.4)
  })

  it('never returns a negative contrast for a negative/degenerate input', () => {
    expect(gradientContrastFor(-500)).toBeGreaterThanOrEqual(0.08)
  })
})

describe('generateCutMassPoints — asymmetric "cut form" silhouette, never a perfect ellipse', () => {
  it('returns the requested number of points', () => {
    expect(generateCutMassPoints(baseCutGlassStats({}), 48, false, 16)).toHaveLength(16)
  })

  it('is deterministic for the same statistics', () => {
    const stats = baseCutGlassStats({ elongation: 1.4 })
    const a = generateCutMassPoints(stats, 48, false, 16)
    const b = generateCutMassPoints({ ...stats }, 48, false, 16)
    expect(a).toEqual(b)
  })

  it('is NOT a perfect ellipse — radii vary beyond what elongation alone explains', () => {
    const stats = baseCutGlassStats({ elongation: 1 }) // a perfect ellipse would be a circle here
    const points = generateCutMassPoints(stats, 48, false, 32)
    const radii = points.map((p) => Math.hypot(p.x - 24, p.y - 24))
    const min = Math.min(...radii)
    const max = Math.max(...radii)
    // A circle would have (near-)identical radii at every angle; CUT's
    // deterministic bulge control points must produce real variation.
    expect(max / min).toBeGreaterThan(1.05)
  })

  it('a field mass expands further than a non-field mass with identical statistics', () => {
    const stats = baseCutGlassStats({})
    const normal = generateCutMassPoints(stats, 48, false, 24)
    const field = generateCutMassPoints(stats, 48, true, 24)
    const avgRadius = (pts: Point[]) => pts.reduce((s, p) => s + Math.hypot(p.x - 24, p.y - 24), 0) / pts.length
    expect(avgRadius(field)).toBeGreaterThan(avgRadius(normal))
  })

  it('different masses (different centroid/colour/size) produce different silhouettes', () => {
    const a = generateCutMassPoints(baseCutGlassStats({ centroid: { x: 10, y: 10 } }), 48, false, 16)
    const b = generateCutMassPoints(baseCutGlassStats({ centroid: { x: 40, y: 40 } }), 48, false, 16)
    expect(a).not.toEqual(b)
  })
})

describe('generateGlassMassPoints — low-vertex faceted pane, never a mosaic of many pieces', () => {
  it('returns the requested number of facet points', () => {
    expect(generateGlassMassPoints(baseCutGlassStats({}), 48, false, 7)).toHaveLength(7)
  })

  it('is deterministic for the same statistics', () => {
    const stats = baseCutGlassStats({ elongation: 2 })
    const a = generateGlassMassPoints(stats, 48, false, 7)
    const b = generateGlassMassPoints({ ...stats }, 48, false, 7)
    expect(a).toEqual(b)
  })

  it('facet jitter stays subtle — radii vary only mildly around the base ellipse', () => {
    const stats = baseCutGlassStats({ elongation: 1 })
    const points = generateGlassMassPoints(stats, 48, false, 24)
    const radii = points.map((p) => Math.hypot(p.x - 24, p.y - 24))
    const min = Math.min(...radii)
    const max = Math.max(...radii)
    // Subtle facet jitter (~[0.92, 1.08]) — visibly faceted but never
    // as irregular as CUT's bulge treatment.
    expect(max / min).toBeLessThan(1.2)
  })

  it('a field mass expands further than a non-field mass with identical statistics', () => {
    const stats = baseCutGlassStats({})
    const normal = generateGlassMassPoints(stats, 48, false, 24)
    const field = generateGlassMassPoints(stats, 48, true, 24)
    const avgRadius = (pts: Point[]) => pts.reduce((s, p) => s + Math.hypot(p.x - 24, p.y - 24), 0) / pts.length
    expect(avgRadius(field)).toBeGreaterThan(avgRadius(normal))
  })

  it('CUT and GLASS silhouette generators produce different points for the same mass', () => {
    const stats = baseCutGlassStats({ elongation: 1.3 })
    const cut = generateCutMassPoints(stats, 48, false, 16)
    const glass = generateGlassMassPoints(stats, 48, false, 16)
    expect(cut).not.toEqual(glass)
  })
})

describe('cutToneColor / glassToneColor — source hue preserved, family-specific tonal treatment', () => {
  it('cutToneColor preserves the source hue', () => {
    const warmRed: RGB = [200, 60, 40]
    const [sourceHue] = rgbToHsl(warmRed)
    const [outHue] = rgbToHsl(cutToneColor(warmRed, 0.5, 0.2))
    expect(outHue).toBeCloseTo(sourceHue, 2)
  })

  it('glassToneColor preserves the source hue', () => {
    const coolBlue: RGB = [40, 90, 200]
    const [sourceHue] = rgbToHsl(coolBlue)
    const [outHue] = rgbToHsl(glassToneColor(coolBlue, 0.5, 0.2))
    expect(outHue).toBeCloseTo(sourceHue, 2)
  })

  it('glassToneColor is lighter than cutToneColor for the same colour and band position', () => {
    const color: RGB = [90, 90, 90]
    const [, , cutL] = rgbToHsl(cutToneColor(color, 0.5, 0.2))
    const [, , glassL] = rgbToHsl(glassToneColor(color, 0.5, 0.2))
    expect(glassL).toBeGreaterThan(cutL)
  })

  it('t=1 (inner) is lighter than t=0 (outer) for both families, given positive contrast', () => {
    const color: RGB = [120, 100, 80]
    const [, , cutOuterL] = rgbToHsl(cutToneColor(color, 0, 0.25))
    const [, , cutInnerL] = rgbToHsl(cutToneColor(color, 1, 0.25))
    expect(cutInnerL).toBeGreaterThan(cutOuterL)

    const [, , glassOuterL] = rgbToHsl(glassToneColor(color, 0, 0.25))
    const [, , glassInnerL] = rgbToHsl(glassToneColor(color, 1, 0.25))
    expect(glassInnerL).toBeGreaterThan(glassOuterL)
  })

  it('both are deterministic', () => {
    const color: RGB = [77, 133, 200]
    expect(cutToneColor(color, 0.3, 0.15)).toEqual(cutToneColor(color, 0.3, 0.15))
    expect(glassToneColor(color, 0.3, 0.15)).toEqual(glassToneColor(color, 0.3, 0.15))
  })

  it('never fabricates a hue unrelated to the source (two very different source colours stay distinguishable)', () => {
    const red: RGB = [220, 40, 40]
    const teal: RGB = [30, 150, 150]
    const [redHue] = rgbToHsl(cutToneColor(red, 0.5, 0.2))
    const [tealHue] = rgbToHsl(cutToneColor(teal, 0.5, 0.2))
    expect(Math.abs(redHue - tealHue)).toBeGreaterThan(0.1)
  })
})
