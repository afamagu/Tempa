// Your Mark — Checkpoint 1 (engine audit + visual prototype), rebuilt
// in Checkpoint 1B (organic geometry pass, "v2": real contour tracing
// instead of a raster upscale), and rebuilt again after the v2-vs-
// reference visual audit ("v3": a compositional abstraction engine).
//
// The audit's conclusion, in one line: v2 is a REGION-RECONSTRUCTION
// system (measure pixel colours, trace their literal footprint); the
// reference Mark is a COMPOSITIONAL INTERPRETATION (a small hierarchy
// of regularized, deliberately-shaped masses with internal tonal
// treatment and real layering). v3 is a genuinely different pipeline,
// not a tuned v2 — see generateMarkV3's own header below for the full
// architecture. v2 is kept fully intact and exported alongside v3
// (generateMarkV2) specifically so the prototype can show SOURCE | V2 |
// V3 side by side, per instruction — this is not dead code.
//
// This file owns Canvas/Image calls only — every actual computation
// (palette, region/mass statistics, contour tracing, simplification,
// smoothing, shape generation) is delegated to the pure, unit-tested
// functions in mark-math.ts, deliberately kept out of this file so
// those contracts can be verified without a real <canvas>.
//
// PRIVACY (all four families alike): no network request of any kind. The
// source File is read via a transient blob: object URL, released the
// instant the pixels have been drawn into the analysis canvas — never
// uploaded, never cached at module scope, never written to any browser
// persistence layer. Every returned Mark is a freshly re-encoded PNG
// built ENTIRELY from re-derived geometry; the original photograph's
// own pixels are never drawn into the output canvas at any point, and
// canvas re-encoding carries no EXIF/metadata forward (the same
// reasoning lib/image-processing.ts's own doc comment already
// establishes for this codebase's other canvas-based upload pipeline).
// Neither pipeline uses an AI/vision model, face/subject detection, or
// any network-hosted processing — this remains an artistic
// de-identification technique, never a biometric-anonymity guarantee.
//
// DETERMINISM (all four families): given the same decoded source pixels,
// the same algorithm version, and the same tuning constants, generation
// always produces the same output. The only "randomness" (accent
// choice, texture grain) is a seeded PRNG whose seed is derived from
// already-abstracted data (never raw pixels, never a non-deterministic
// RNG call) — see mark-math.ts's createSeededRandom.

import {
  boxBlurGrid,
  buildAdjacency,
  chaikinSmooth,
  chooseAccentMass,
  classifyMassShape,
  computeMassStatistics,
  computeSquareFitRect,
  createSeededRandom,
  extractPalette,
  findConnectedComponents,
  generateContourRings,
  generateGlyphAnchors,
  generateWeaveStrands,
  generateNestedBands,
  generateRegularizedMassPoints,
  harmonizePalette,
  hashInts,
  hslToRgb,
  mergeSmallRegions,
  polygonArea,
  quantizeToLabels,
  reducePalette,
  regionSizes,
  remapLabels,
  rgbToHsl,
  scoreFocalCandidacy,
  simplifyPath,
  traceRegionContours,
  type MassStats,
  type Point,
  type RGB,
} from './mark-math'

/** Retained for backward compatibility with anything still importing
 * the un-versioned name — always mirrors the CURRENT algorithm
 * (v3). Prefer the explicit MARK_ALGORITHM_VERSION_V2 /
 * MARK_ALGORITHM_VERSION_V3 constants below, which is what the
 * prototype actually uses to label each column. */
export const MARK_ALGORITHM_VERSION = 3
export const MARK_ALGORITHM_VERSION_V2 = 2
export const MARK_ALGORITHM_VERSION_V3 = 3
/** "Choose Your Mark" checkpoint: v2/v3/CUT/WASH are independent
 * artistic FAMILIES the member will eventually choose between, not
 * generations superseding one another. These ordinals are internal
 * development labels only — see generateMarkCut/generateMarkWash. */
export const MARK_ALGORITHM_VERSION_WEAVE = 4
export const MARK_ALGORITHM_VERSION_CONTOUR = 5
export const MARK_ALGORITHM_VERSION_GLYPH = 6

const ANALYSIS_GRID = 48
const MASTER_SIZE = 512

export type MarkResult = {
  /** The finished Mark — geometry + accent line(s) + texture. */
  dataUrl: string
  blob: Blob
  /** The SAME geometry with texture and accent lines omitted — a
   * diagnostic-only view (Section J's "Show structure" toggle) that
   * proves whether the underlying abstraction is doing the work,
   * rather than texture disguising a weak one. Never shown in
   * production. */
  structureDataUrl: string
  size: number
  /** v2: traced-region count. v3: final principal-mass count (the
   * genuinely variable "smallest set of principal masses" the source
   * resolved into — never forced to one fixed number). */
  regionCount: number
  seed: number
  algorithmVersion: number
}

export class MarkGenerationError extends Error {}

// ============================================================
// SHARED — image loading and the analysis grid both pipelines start
// from. Composition (crop) is never subject/face-detection-driven —
// computeSquareFitRect only ever looks at width/height.
// ============================================================

async function loadCroppedAnalysisGrid(file: File): Promise<RGB[]> {
  const objectUrl = URL.createObjectURL(file)
  let img: HTMLImageElement
  try {
    img = await loadImage(objectUrl)
  } finally {
    // Released as soon as the image has decoded — nothing below this
    // line still needs the blob URL, and nothing holds a reference to
    // `file` itself either.
    URL.revokeObjectURL(objectUrl)
  }

  const fit = computeSquareFitRect(img.naturalWidth, img.naturalHeight)
  if (fit.size <= 0) {
    throw new MarkGenerationError('This image could not be read.')
  }

  const analysisCanvas = document.createElement('canvas')
  analysisCanvas.width = ANALYSIS_GRID
  analysisCanvas.height = ANALYSIS_GRID
  const actx = analysisCanvas.getContext('2d')
  if (!actx) throw new MarkGenerationError('This browser cannot process images.')
  actx.imageSmoothingEnabled = true
  actx.imageSmoothingQuality = 'high'
  actx.drawImage(img, fit.sx, fit.sy, fit.size, fit.size, 0, 0, ANALYSIS_GRID, ANALYSIS_GRID)
  const analysisData = actx.getImageData(0, 0, ANALYSIS_GRID, ANALYSIS_GRID)

  const samples: RGB[] = []
  for (let i = 0; i < ANALYSIS_GRID * ANALYSIS_GRID; i++) {
    const o = i * 4
    samples.push([analysisData.data[o], analysisData.data[o + 1], analysisData.data[o + 2]])
  }
  return samples
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new MarkGenerationError('Could not read this image.'))
    img.src = src
  })
}

function rgbToCss([r, g, b]: RGB): string {
  return `rgb(${r}, ${g}, ${b})`
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Renders a set of point loops as a single Path2D, each loop a closed
 * subpath built from quadratic Bezier segments through the loop's own
 * points — reconstruction as paths, never a raster upscale. Shared by
 * both v2 (traced-and-smoothed contours) and v3 (parametric mass
 * shapes) — the rendering technique is identical; only where the
 * points COME FROM differs between the two pipelines. */
function pathFromLoops(loops: Point[][]): Path2D {
  const path = new Path2D()
  for (const loop of loops) {
    if (loop.length < 3) continue
    const start = midpoint(loop[0], loop[1])
    path.moveTo(start.x, start.y)
    for (let i = 1; i <= loop.length; i++) {
      const curr = loop[i % loop.length]
      const next = loop[(i + 1) % loop.length]
      const mid = midpoint(curr, next)
      path.quadraticCurveTo(curr.x, curr.y, mid.x, mid.y)
    }
    path.closePath()
  }
  return path
}

function strokeLoop(ctx: CanvasRenderingContext2D, loop: Point[]) {
  if (loop.length < 3) return
  ctx.beginPath()
  const start = midpoint(loop[0], loop[1])
  ctx.moveTo(start.x, start.y)
  for (let i = 1; i <= loop.length; i++) {
    const curr = loop[i % loop.length]
    const next = loop[(i + 1) % loop.length]
    const mid = midpoint(curr, next)
    ctx.quadraticCurveTo(curr.x, curr.y, mid.x, mid.y)
  }
  ctx.closePath()
  ctx.stroke()
}

function drawDeterministicTexture(ctx: CanvasRenderingContext2D, random: () => number, masterSize: number, dotFraction: number) {
  const dotCount = Math.round(masterSize * dotFraction)
  ctx.save()
  for (let i = 0; i < dotCount; i++) {
    const x = random() * masterSize
    const y = random() * masterSize
    const r = 0.6 + random() * 1.1
    const alpha = 0.015 + random() * 0.03
    ctx.fillStyle = random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

// ============================================================
// V2 — region-reconstruction pipeline (Checkpoint 1B). Kept fully
// intact, unmodified in behaviour, specifically so the prototype can
// still show its result alongside v3 for comparison.
// ============================================================

const V2_INITIAL_PALETTE_SIZE = 10
const V2_MAX_REGIONS = 7
const V2_COLOR_MERGE_THRESHOLD_SQ = 3600
const V2_MIN_REGION_FRACTION = 0.012
const V2_RDP_EPSILON = 0.8
const V2_CHAIKIN_ITERATIONS = 3
const V2_REGION_OVERLAP_PX = 1.4

export async function generateMarkV2(file: File): Promise<MarkResult> {
  const samples = await loadCroppedAnalysisGrid(file)

  const rawPalette = extractPalette(samples, V2_INITIAL_PALETTE_SIZE)
  const initialLabels = quantizeToLabels(samples, rawPalette)

  const rawWeights = regionSizes(initialLabels, rawPalette.length)
  const { palette: reducedPalette, mapping } = reducePalette(rawPalette, rawWeights, {
    colorMergeThresholdSq: V2_COLOR_MERGE_THRESHOLD_SQ,
    maxRegions: V2_MAX_REGIONS,
  })
  const remapped = remapLabels(initialLabels, mapping)
  const minRegionSize = Math.max(2, Math.round(ANALYSIS_GRID * ANALYSIS_GRID * V2_MIN_REGION_FRACTION))
  const finalLabels = mergeSmallRegions(remapped, ANALYSIS_GRID, ANALYSIS_GRID, minRegionSize)

  const harmonizedPalette = harmonizePalette(reducedPalette)

  const seedInputs: number[] = [...Array.from(finalLabels)]
  for (const [r, g, b] of harmonizedPalette) seedInputs.push(r, g, b)
  const seed = hashInts(seedInputs)
  const random = createSeededRandom(seed)

  const { componentId, sizes, labelOf, count } = findConnectedComponents(finalLabels, ANALYSIS_GRID, ANALYSIS_GRID)

  type RegionGeometry = { loops: Point[][]; color: RGB; area: number }
  const scale = MASTER_SIZE / ANALYSIS_GRID
  const regions: RegionGeometry[] = []

  for (let c = 0; c < count; c++) {
    const mask = new Uint8Array(ANALYSIS_GRID * ANALYSIS_GRID)
    for (let i = 0; i < componentId.length; i++) {
      if (componentId[i] === c) mask[i] = 1
    }
    const rawLoops = traceRegionContours(mask, ANALYSIS_GRID, ANALYSIS_GRID)
    if (rawLoops.length === 0) continue

    const smoothedLoops = rawLoops.map((loop) => {
      const simplified = simplifyPath(loop, V2_RDP_EPSILON)
      const smoothed = chaikinSmooth(simplified, V2_CHAIKIN_ITERATIONS, true)
      return dilateLoop(
        smoothed.map((p) => ({ x: p.x * scale, y: p.y * scale })),
        V2_REGION_OVERLAP_PX
      )
    })

    const color = harmonizedPalette[labelOf[c]] ?? [128, 128, 128]
    regions.push({ loops: smoothedLoops, color, area: sizes[c] })
  }

  regions.sort((a, b) => b.area - a.area)

  const master = document.createElement('canvas')
  master.width = MASTER_SIZE
  master.height = MASTER_SIZE
  const mctx = master.getContext('2d')
  if (!mctx) throw new MarkGenerationError('This browser cannot process images.')

  for (const region of regions) {
    const path = pathFromLoops(region.loops)
    mctx.fillStyle = rgbToCss(region.color)
    mctx.fill(path, 'evenodd')
  }

  const structureDataUrl = master.toDataURL('image/png')

  // Sparse accent line(s): only the single largest region (and a close
  // runner-up, if any) is re-stroked — meaningful geometry, never an
  // arbitrary decorative shape.
  const accentCandidates = regions.length > 0 ? [regions[0]] : []
  if (regions.length > 1 && regions[1].area > regions[0].area * 0.55) accentCandidates.push(regions[1])
  mctx.save()
  mctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
  mctx.lineWidth = Math.max(1, MASTER_SIZE * 0.003)
  for (const region of accentCandidates) {
    const outer = region.loops.reduce((a, b) => (Math.abs(polygonArea(a)) >= Math.abs(polygonArea(b)) ? a : b))
    strokeLoop(mctx, outer)
  }
  mctx.restore()

  drawDeterministicTexture(mctx, random, MASTER_SIZE, 0.4)

  const blob = await new Promise<Blob>((resolve, reject) => {
    master.toBlob((b) => (b ? resolve(b) : reject(new MarkGenerationError('Could not render this Mark.'))), 'image/png')
  })
  const dataUrl = master.toDataURL('image/png')

  return {
    dataUrl,
    blob,
    structureDataUrl,
    size: MASTER_SIZE,
    regionCount: regions.length,
    seed,
    algorithmVersion: MARK_ALGORITHM_VERSION_V2,
  }
}

function dilateLoop(points: Point[], amount: number): Point[] {
  if (points.length === 0) return points
  let cx = 0
  let cy = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
  }
  cx /= points.length
  cy /= points.length
  return points.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const dist = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / dist) * amount, y: p.y + (dy / dist) * amount }
  })
}

// ============================================================
// V3 — compositional abstraction engine.
// ============================================================
// Genuinely different from v2, not a tuned variant of it:
//
//   analysis grid -> HEAVILY BLURRED before any clustering (so local
//   high-frequency pattern noise contributes to a mass's measured
//   TONAL RANGE, never to how many masses exist — "texture as
//   statistic, not geometry") -> cluster + reduce on the BLURRED data
//   toward a BOUNDED but not fixed count of principal masses (the
//   reduction stops naturally once every surviving mass is both
//   large-enough and distinct-enough — a simple photo can legitimately
//   resolve into fewer masses than a complex one) -> for each mass,
//   compute real geometric/tonal STATISTICS from the ORIGINAL
//   (unblurred) pixels — centroid, scale, elongation/orientation
//   (principal-axis covariance), compactness, tonal range, texture
//   energy -> score every mass's FOCAL CANDIDACY from generic
//   statistics only (colour distinctiveness, a size sweet-spot, its
//   own compactness, and only a WEAK centrality tiebreaker — never an
//   upper-frame/portrait bias, never semantic detection of any kind)
//   -> assign a small hierarchy (focal / dominant / atmosphere /
//   secondary / accent) -> classify EACH mass's shape purely from ITS
//   OWN geometry (lobe / sweep / field) -> generate a REGULARIZED
//   parametric shape for it (never its literal traced boundary) ->
//   render nested tonal bands inside larger/higher-texture-energy
//   masses (this is where the discarded local pattern information
//   reappears, as shading, not as separate shapes) -> layer
//   back-to-front by hierarchy role, deliberately WITHOUT requiring an
//   exact edge-to-edge partition, so real overlap and negative space
//   can exist -> stroke every mass's outer edge with one consistent
//   ink treatment (not per-mass decorative lines) -> apply the same
//   deterministic texture pass as v2, slightly more present.
//
// Colour remains fully source-derived (every hue comes from a real
// measured mass), but each mass's LIGHTNESS is re-expressed across its
// own real tonal range as banding, rather than rendering its single
// measured mean colour — interpretation, not extraction.

const V3_BLUR_RADIUS = 3
const V3_INITIAL_PALETTE_SIZE = 10
// A generous SAFETY CEILING only — not a target. The colour-similarity
// threshold and the minimum-significance area below do the real work
// of deciding how many masses a given photograph resolves into; simple
// photos legitimately end up with far fewer than this ceiling.
const V3_MAX_MASSES_SAFETY_CAP = 9
const V3_COLOR_MERGE_THRESHOLD_SQ = 6000
const V3_MIN_MASS_FRACTION = 0.035
const V3_ACCENT_MIN_FRACTION = 0.015
const V3_ACCENT_MAX_FRACTION = 0.12
// Texture-energy thresholds deciding how many internal tonal bands a
// mass gets — a first-pass heuristic based on the actual numeric range
// mean-squared-RGB-distance produces, not tuned against any one
// photograph.
const V3_BAND_THRESHOLDS = [300, 1200, 3500]
const V3_MAX_BANDS = 4
const V3_STROKE_STYLE = 'rgba(250, 240, 220, 0.28)'

type Role = 'focal' | 'dominant' | 'atmosphere' | 'secondary' | 'accent'

export async function generateMarkV3(file: File): Promise<MarkResult> {
  const samples = await loadCroppedAnalysisGrid(file)
  const blurred = boxBlurGrid(samples, ANALYSIS_GRID, ANALYSIS_GRID, V3_BLUR_RADIUS)

  const rawPalette = extractPalette(blurred, V3_INITIAL_PALETTE_SIZE)
  const initialLabels = quantizeToLabels(blurred, rawPalette)
  const rawWeights = regionSizes(initialLabels, rawPalette.length)
  const { palette: reducedPalette, mapping } = reducePalette(rawPalette, rawWeights, {
    colorMergeThresholdSq: V3_COLOR_MERGE_THRESHOLD_SQ,
    maxRegions: V3_MAX_MASSES_SAFETY_CAP,
  })
  const remapped = remapLabels(initialLabels, mapping)
  const minMassSize = Math.max(2, Math.round(ANALYSIS_GRID * ANALYSIS_GRID * V3_MIN_MASS_FRACTION))
  const finalLabels = mergeSmallRegions(remapped, ANALYSIS_GRID, ANALYSIS_GRID, minMassSize)

  const { componentId, count } = findConnectedComponents(finalLabels, ANALYSIS_GRID, ANALYSIS_GRID)
  const totalArea = ANALYSIS_GRID * ANALYSIS_GRID

  // Real statistics from the ORIGINAL, unblurred samples — this is
  // what lets a mass's true tonal/colour range survive even though its
  // spatial extent was decided from blurred, clustered data.
  const allStats: MassStats[] = []
  for (let c = 0; c < count; c++) {
    const mask = new Uint8Array(totalArea)
    for (let i = 0; i < componentId.length; i++) {
      if (componentId[i] === c) mask[i] = 1
    }
    allStats.push(computeMassStatistics(mask, ANALYSIS_GRID, ANALYSIS_GRID, samples, c))
  }

  const adjacency = buildAdjacency(componentId, ANALYSIS_GRID, ANALYSIS_GRID, count)

  // Deterministic seed for texture — derived from the already-
  // abstracted mass statistics only, never raw pixels.
  const seedInputs: number[] = []
  for (const s of allStats) {
    seedInputs.push(Math.round(s.centroid.x), Math.round(s.centroid.y), s.pixelCount, ...s.meanColor)
  }
  const seed = hashInts(seedInputs)
  const random = createSeededRandom(seed)

  // ---------- HIERARCHY ----------
  const focalScores = allStats.map((s) =>
    scoreFocalCandidacy(
      s,
      allStats.filter((o) => o !== s),
      totalArea,
      ANALYSIS_GRID
    )
  )
  const roles = new Map<number, Role>()
  if (allStats.length > 0) {
    let focalIndex = 0
    for (let i = 1; i < focalScores.length; i++) {
      if (focalScores[i] > focalScores[focalIndex]) focalIndex = i
    }
    roles.set(allStats[focalIndex].label, 'focal')

    const byArea = [...allStats].sort((a, b) => b.pixelCount - a.pixelCount)
    const dominant = byArea.find((s) => !roles.has(s.label))
    if (dominant) roles.set(dominant.label, 'dominant')

    const byEdgeTouch = [...allStats]
      .filter((s) => !roles.has(s.label))
      .sort((a, b) => {
        const ea = Object.values(a.touchesEdge).filter(Boolean).length
        const eb = Object.values(b.touchesEdge).filter(Boolean).length
        return eb - ea || b.pixelCount - a.pixelCount
      })
    const atmosphere = byEdgeTouch[0]
    if (atmosphere && Object.values(atmosphere.touchesEdge).filter(Boolean).length >= 2) {
      roles.set(atmosphere.label, 'atmosphere')
    }

    for (const s of allStats) {
      if (!roles.has(s.label)) roles.set(s.label, 'secondary')
    }

    const accentEligible = allStats.filter((s) => roles.get(s.label) === 'secondary')
    const accent = chooseAccentMass(accentEligible, totalArea, V3_ACCENT_MIN_FRACTION, V3_ACCENT_MAX_FRACTION)
    if (accent) roles.set(accent.label, 'accent')
  }

  // ---------- SHAPE + GEOMETRY ----------
  type MassGeometry = {
    stats: MassStats
    role: Role
    style: ReturnType<typeof classifyMassShape>
    bands: { points: Point[]; t: number }[]
  }

  const geometries: MassGeometry[] = allStats.map((stats) => {
    const role = roles.get(stats.label) ?? 'secondary'
    const style = classifyMassShape(stats, totalArea)
    const basePoints = generateRegularizedMassPoints(stats, style, ANALYSIS_GRID, 24)
    const bandCount = bandCountFor(stats.textureEnergy)
    const bands = generateNestedBands(basePoints, stats.centroid, stats.orientationRad, bandCount)
    return { stats, role, style, bands }
  })

  // ---------- LAYERING ----------
  // Deliberately NOT an edge-to-edge partition: masses are painted in a
  // fixed role order (atmosphere/background first, focal and accent
  // last), and each mass's own shape generator already produces a
  // regularized form independent of its neighbours' — real overlap and
  // negative space are the natural result, not a special case.
  const roleOrder: Record<Role, number> = { atmosphere: 0, dominant: 1, secondary: 2, focal: 3, accent: 4 }
  geometries.sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || b.stats.pixelCount - a.stats.pixelCount)

  const scale = MASTER_SIZE / ANALYSIS_GRID
  const master = document.createElement('canvas')
  master.width = MASTER_SIZE
  master.height = MASTER_SIZE
  const mctx = master.getContext('2d')
  if (!mctx) throw new MarkGenerationError('This browser cannot process images.')

  for (const geo of geometries) {
    // Outermost band first (bottom), innermost (darkest/lightest
    // extreme) last, so banding reads as layered shading.
    for (const band of geo.bands) {
      const color = colorForBand(geo.stats, band.t)
      const scaledPoints = band.points.map((p) => ({ x: p.x * scale, y: p.y * scale }))
      const path = pathFromLoops([scaledPoints])
      mctx.fillStyle = rgbToCss(color)
      mctx.fill(path)
    }
  }

  const structureDataUrl = master.toDataURL('image/png')

  // Systematic linework: every mass's outer band gets the SAME
  // restrained ink treatment (a fixed warm-neutral stroke, not
  // per-mass decorative colour) — a consistent illustrative device
  // across the whole piece, not a sparse special case reserved for the
  // single largest shape.
  mctx.save()
  mctx.strokeStyle = V3_STROKE_STYLE
  mctx.lineWidth = Math.max(1, MASTER_SIZE * 0.0026)
  for (const geo of geometries) {
    const outer = geo.bands[0]?.points
    if (!outer) continue
    strokeLoop(
      mctx,
      outer.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    )
  }
  mctx.restore()

  drawDeterministicTexture(mctx, random, MASTER_SIZE, 0.55)

  const blob = await new Promise<Blob>((resolve, reject) => {
    master.toBlob((b) => (b ? resolve(b) : reject(new MarkGenerationError('Could not render this Mark.'))), 'image/png')
  })
  const dataUrl = master.toDataURL('image/png')

  return {
    dataUrl,
    blob,
    structureDataUrl,
    size: MASTER_SIZE,
    regionCount: geometries.length,
    seed,
    algorithmVersion: MARK_ALGORITHM_VERSION_V3,
  }
}

function bandCountFor(textureEnergy: number): number {
  let bands = 1
  for (const threshold of V3_BAND_THRESHOLDS) {
    if (textureEnergy > threshold) bands++
  }
  return Math.min(V3_MAX_BANDS, bands)
}

/** The colour for one tonal band within a mass: the mass's own
 * measured HUE and saturation are kept (still fully source-derived),
 * but LIGHTNESS is re-expressed across the mass's own real luminance
 * range according to the band's position `t` — interpretation of a
 * measured tonal range, never a literal re-sample of source pixels. */
function colorForBand(stats: MassStats, t: number): RGB {
  const [h, s, baseL] = rgbToHsl(stats.meanColor)
  const harmonizedS = Math.min(0.6, Math.max(0.16, s * 0.85))
  const lumSpreadFraction = (stats.maxLuminance - stats.minLuminance) / 255
  const spread = Math.min(0.32, 0.1 + lumSpreadFraction * 0.4)
  const targetL = Math.min(0.88, Math.max(0.12, baseL + (0.5 - t) * spread))
  return hslToRgb([h, harmonizedS, targetL])
}

// ============================================================
// "CHOOSE YOUR MARK" CHECKPOINT — SHARED COMPOSITIONAL-MASS EXTRACTION
// ============================================================
// v2 and v3 above are NOT refactored to use this — their own inline
// implementations are left completely untouched, preserving their
// exact behaviour, seeds, and output. This is deliberate, disclosed
// duplication of v3's own mass-extraction+hierarchy logic (blur ->
// cluster -> reduce -> merge -> connected components -> per-mass
// statistics -> generic hierarchy scoring), factored out ONLY for the
// two new candidate families below, parameterized so each family can
// have its own mass-count character from one tested implementation
// rather than four independent copies of the whole analysis pipeline.
// (Role itself is v3's own type, declared above, in scope here too.)

export type CompositionalTuning = {
  blurRadius: number
  initialPaletteSize: number
  colorMergeThresholdSq: number
  maxMasses: number
  minMassFraction: number
  accentMinFraction: number
  accentMaxFraction: number
}

type CompositionalMass = { stats: MassStats; role: Role }

async function extractCompositionalMasses(
  file: File,
  tuning: CompositionalTuning
): Promise<{ masses: CompositionalMass[]; totalArea: number; seed: number; random: () => number }> {
  const samples = await loadCroppedAnalysisGrid(file)
  const blurred = boxBlurGrid(samples, ANALYSIS_GRID, ANALYSIS_GRID, tuning.blurRadius)

  const rawPalette = extractPalette(blurred, tuning.initialPaletteSize)
  const initialLabels = quantizeToLabels(blurred, rawPalette)
  const rawWeights = regionSizes(initialLabels, rawPalette.length)
  const { palette: reducedPalette, mapping } = reducePalette(rawPalette, rawWeights, {
    colorMergeThresholdSq: tuning.colorMergeThresholdSq,
    maxRegions: tuning.maxMasses,
  })
  const remapped = remapLabels(initialLabels, mapping)
  const minMassSize = Math.max(2, Math.round(ANALYSIS_GRID * ANALYSIS_GRID * tuning.minMassFraction))
  const finalLabels = mergeSmallRegions(remapped, ANALYSIS_GRID, ANALYSIS_GRID, minMassSize)

  const { componentId, count } = findConnectedComponents(finalLabels, ANALYSIS_GRID, ANALYSIS_GRID)
  const totalArea = ANALYSIS_GRID * ANALYSIS_GRID

  const allStats: MassStats[] = []
  for (let c = 0; c < count; c++) {
    const mask = new Uint8Array(totalArea)
    for (let i = 0; i < componentId.length; i++) {
      if (componentId[i] === c) mask[i] = 1
    }
    allStats.push(computeMassStatistics(mask, ANALYSIS_GRID, ANALYSIS_GRID, samples, c))
  }

  const seedInputs: number[] = []
  for (const s of allStats) {
    seedInputs.push(Math.round(s.centroid.x), Math.round(s.centroid.y), s.pixelCount, ...s.meanColor)
  }
  const seed = hashInts(seedInputs)
  const random = createSeededRandom(seed)

  const roles = new Map<number, Role>()
  if (allStats.length > 0) {
    const focalScores = allStats.map((s) =>
      scoreFocalCandidacy(
        s,
        allStats.filter((o) => o !== s),
        totalArea,
        ANALYSIS_GRID
      )
    )
    let focalIndex = 0
    for (let i = 1; i < focalScores.length; i++) {
      if (focalScores[i] > focalScores[focalIndex]) focalIndex = i
    }
    roles.set(allStats[focalIndex].label, 'focal')

    const byArea = [...allStats].sort((a, b) => b.pixelCount - a.pixelCount)
    const dominant = byArea.find((s) => !roles.has(s.label))
    if (dominant) roles.set(dominant.label, 'dominant')

    const byEdgeTouch = [...allStats]
      .filter((s) => !roles.has(s.label))
      .sort((a, b) => {
        const ea = Object.values(a.touchesEdge).filter(Boolean).length
        const eb = Object.values(b.touchesEdge).filter(Boolean).length
        return eb - ea || b.pixelCount - a.pixelCount
      })
    const atmosphere = byEdgeTouch[0]
    if (atmosphere && Object.values(atmosphere.touchesEdge).filter(Boolean).length >= 2) {
      roles.set(atmosphere.label, 'atmosphere')
    }

    for (const s of allStats) {
      if (!roles.has(s.label)) roles.set(s.label, 'secondary')
    }

    const accentEligible = allStats.filter((s) => roles.get(s.label) === 'secondary')
    const accent = chooseAccentMass(accentEligible, totalArea, tuning.accentMinFraction, tuning.accentMaxFraction)
    if (accent) roles.set(accent.label, 'accent')
  }

  const masses: CompositionalMass[] = allStats.map((stats) => ({
    stats,
    role: roles.get(stats.label) ?? 'secondary',
  }))

  return { masses, totalArea, seed, random }
}

const ROLE_ORDER: Record<Role, number> = { atmosphere: 0, dominant: 1, secondary: 2, focal: 3, accent: 4 }

// ============================================================
// V4 CUT — first new candidate family. Reuses the shared extraction
// above with its own tuning constants aimed at MORE, smaller-but-
// still-restrained territories than v3 ("approximately 5-8 dominant
// pieces where the source supports them," a safety ceiling not a
// target — a busy or simple photo may still resolve into fewer).
// Diverges completely from v2 and v3 in rendering: an asymmetric,
// elegant "cut form" silhouette (generateCutMassPoints) instead of
// v3's perfect ellipse or v2's literal traced contour; a continuous
// two-stop tonal gradient per shape instead of v3's discrete nested
// bands; restrained per-shape translucency plus a soft drop-shadow for
// layered "cut and placed" depth instead of v3's systematic outline
// stroke — CUT has NO outline stroke at all, a deliberate, visible
// point of difference from v3.
// ============================================================

const WEAVE_TUNING: CompositionalTuning = {
  blurRadius: 3,
  initialPaletteSize: 10,
  colorMergeThresholdSq: 4800,
  maxMasses: 7,
  minMassFraction: 0.025,
  accentMinFraction: 0.015,
  accentMaxFraction: 0.12,
}

export async function generateMarkWeave(file: File): Promise<MarkResult> {
  const { masses, seed, random } = await extractCompositionalMasses(file, WEAVE_TUNING)

  const sorted = [...masses].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.stats.pixelCount - a.stats.pixelCount
  )

  const scale = MASTER_SIZE / ANALYSIS_GRID
  const master = document.createElement('canvas')
  master.width = MASTER_SIZE
  master.height = MASTER_SIZE
  const mctx = master.getContext('2d')
  if (!mctx) throw new MarkGenerationError('This browser cannot process images.')

  for (const mass of sorted) {
    const strands = generateWeaveStrands(mass.stats, mass.role === 'atmosphere' ? 4 : 6)
    mctx.save()
    mctx.strokeStyle = rgbToCss(mass.stats.meanColor)
    mctx.globalAlpha = mass.role === 'accent' ? 0.95 : 0.78
    mctx.lineCap = 'round'
    for (const strand of strands) {
      mctx.lineWidth = strand.width * scale
      mctx.beginPath()
      mctx.moveTo(strand.start.x * scale, strand.start.y * scale)
      mctx.quadraticCurveTo(strand.control.x * scale, strand.control.y * scale, strand.end.x * scale, strand.end.y * scale)
      mctx.stroke()
    }
    mctx.restore()
  }

  const structureDataUrl = master.toDataURL('image/png')

  drawDeterministicTexture(mctx, random, MASTER_SIZE, 0.12)

  const blob = await new Promise<Blob>((resolve, reject) => {
    master.toBlob((b) => (b ? resolve(b) : reject(new MarkGenerationError('Could not render this Mark.'))), 'image/png')
  })
  const dataUrl = master.toDataURL('image/png')

  return {
    dataUrl,
    blob,
    structureDataUrl,
    size: MASTER_SIZE,
    regionCount: sorted.length,
    seed,
    algorithmVersion: MARK_ALGORITHM_VERSION_WEAVE,
  }
}

// ============================================================
// V5 WASH — a genuinely separate fourth family. It shares only the
// source-derived compositional analysis above, tuned toward a quiet set
// of broad territories, then interprets each mass through its own
// low-frequency organic perimeter and layered pigment-density grammar.
// No traced contour, regularized lobe, CUT form, facet, outline, or
// seam survives into this renderer. Broad translucent bodies preserve
// placement/orientation; a pair of restrained, offset concentrations
// creates pigment pooling without obvious concentric bands.
// ============================================================

const CONTOUR_TUNING: CompositionalTuning = {
  blurRadius: 4,
  initialPaletteSize: 8,
  colorMergeThresholdSq: 7200,
  maxMasses: 6,
  minMassFraction: 0.05,
  accentMinFraction: 0.02,
  accentMaxFraction: 0.12,
}

export async function generateMarkContour(file: File): Promise<MarkResult> {
  const { masses, seed, random } = await extractCompositionalMasses(file, CONTOUR_TUNING)

  const sorted = [...masses].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.stats.pixelCount - a.stats.pixelCount
  )

  const scale = MASTER_SIZE / ANALYSIS_GRID
  const master = document.createElement('canvas')
  master.width = MASTER_SIZE
  master.height = MASTER_SIZE
  const mctx = master.getContext('2d')
  if (!mctx) throw new MarkGenerationError('This browser cannot process images.')

  for (const mass of sorted) {
    const rings = generateContourRings(mass.stats, mass.role === 'atmosphere' ? 3 : 4)
    mctx.save()
    mctx.strokeStyle = rgbToCss(mass.stats.meanColor)
    mctx.globalAlpha = mass.role === 'accent' ? 0.94 : 0.72
    mctx.lineWidth = mass.role === 'accent' ? 8 : 5
    for (const ring of rings) {
      strokeLoop(mctx, ring.map((point) => ({ x: point.x * scale, y: point.y * scale })))
    }
    mctx.restore()
  }

  const structureDataUrl = master.toDataURL('image/png')
  drawDeterministicTexture(mctx, random, MASTER_SIZE, 0.1)

  const blob = await new Promise<Blob>((resolve, reject) => {
    master.toBlob((b) => (b ? resolve(b) : reject(new MarkGenerationError('Could not render this Mark.'))), 'image/png')
  })
  const dataUrl = master.toDataURL('image/png')

  return {
    dataUrl,
    blob,
    structureDataUrl,
    size: MASTER_SIZE,
    regionCount: sorted.length,
    seed,
    algorithmVersion: MARK_ALGORITHM_VERSION_CONTOUR,
  }
}

const GLYPH_TUNING: CompositionalTuning = {
  blurRadius: 5,
  initialPaletteSize: 7,
  colorMergeThresholdSq: 7600,
  maxMasses: 7,
  minMassFraction: 0.04,
  accentMinFraction: 0.02,
  accentMaxFraction: 0.12,
}

export async function generateMarkGlyph(file: File): Promise<MarkResult> {
  const { masses, seed, random } = await extractCompositionalMasses(file, GLYPH_TUNING)
  const anchors = generateGlyphAnchors(masses.map((mass) => mass.stats), ANALYSIS_GRID)
  const scale = MASTER_SIZE / ANALYSIS_GRID
  const master = document.createElement('canvas')
  master.width = MASTER_SIZE
  master.height = MASTER_SIZE
  const mctx = master.getContext('2d')
  if (!mctx) throw new MarkGenerationError('This browser cannot process images.')

  const palette = [...masses].sort((a, b) => b.stats.pixelCount - a.stats.pixelCount)
  const gradient = mctx.createLinearGradient(0, 0, MASTER_SIZE, MASTER_SIZE)
  for (let i = 0; i < Math.max(1, palette.length); i++) {
    gradient.addColorStop(palette.length === 1 ? 0 : i / (palette.length - 1), rgbToCss(palette[i].stats.meanColor))
  }
  mctx.save()
  mctx.strokeStyle = gradient
  mctx.lineWidth = 24
  mctx.lineCap = 'round'
  mctx.lineJoin = 'round'
  mctx.beginPath()
  if (anchors.length) mctx.moveTo(anchors[0].x * scale, anchors[0].y * scale)
  for (let i = 1; i < anchors.length; i++) {
    const previous = anchors[i - 1]
    const current = anchors[i]
    const controlX = (previous.x + current.x) / 2 * scale
    const controlY = (i % 2 === 0 ? previous.y : current.y) * scale
    mctx.quadraticCurveTo(controlX, controlY, current.x * scale, current.y * scale)
  }
  mctx.stroke()
  mctx.restore()

  const structureDataUrl = master.toDataURL('image/png')
  drawDeterministicTexture(mctx, random, MASTER_SIZE, 0.06)
  const blob = await new Promise<Blob>((resolve, reject) => {
    master.toBlob((b) => (b ? resolve(b) : reject(new MarkGenerationError('Could not render this Mark.'))), 'image/png')
  })
  return {
    dataUrl: master.toDataURL('image/png'), blob, structureDataUrl,
    size: MASTER_SIZE, regionCount: 1, seed,
    algorithmVersion: MARK_ALGORITHM_VERSION_GLYPH,
  }
}
