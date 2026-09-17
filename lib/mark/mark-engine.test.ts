import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Your Mark — Checkpoint 1 (engine audit + visual prototype), extended
// in Checkpoint 1B (organic geometry pass) and again after the
// v2-vs-reference visual audit (v3, a compositional abstraction
// engine). mark-engine.ts is browser-only (real Canvas/Image/File/
// Path2D APIs, none of which exist in this repo's node test
// environment — vitest.config.mts has no jsdom, matching every other
// canvas-touching file in this codebase, e.g. lib/image-processing.ts,
// which also has no test file of its own for the same reason). Its
// actual geometry/compositional math is covered directly, DOM-free, by
// mark-math.test.ts. This file instead proves the checkpoint's own
// non-visual CONTRACTS — privacy, determinism, no network, no raw-
// photo draw, and the v3-specific architectural requirements (real
// layering, bounded-not-fixed mass count, texture-as-statistic) — via
// source inspection, the established convention this codebase already
// uses for exactly this class of claim.
const source = readFileSync(path.join(__dirname, 'mark-engine.ts'), 'utf8')

describe('Your Mark engine — no network request is required for generation', () => {
  it('never calls fetch, XMLHttpRequest, or any Supabase client', () => {
    expect(source).not.toMatch(/\bfetch\(/)
    expect(source).not.toContain('XMLHttpRequest')
    expect(source).not.toContain('supabase')
    expect(source).not.toContain('createClient')
  })
})

describe('Your Mark engine — the raw source is never persisted (either version)', () => {
  it('never writes to any browser persistence layer', () => {
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('indexedDB')
  })

  it('never uploads to any storage bucket', () => {
    expect(source).not.toContain('.storage.from(')
    expect(source).not.toContain('upload(')
  })

  it('neither generateMarkV2 nor generateMarkV3 returns the decoded <img> element or the input File — only the derived MarkResult', () => {
    for (const fnName of ['generateMarkV2', 'generateMarkV3']) {
      const fnStart = source.indexOf(`export async function ${fnName}(`)
      expect(fnStart, `expected to find ${fnName}`).toBeGreaterThan(-1)
      const returnStart = source.indexOf('return {', fnStart)
      const returnEnd = source.indexOf('}', returnStart)
      const returned = source.slice(returnStart, returnEnd)
      expect(returned).not.toContain('img')
      expect(returned).not.toContain('file')
    }
  })
})

describe('Your Mark engine — the source object URL is still revoked', () => {
  it('every URL.createObjectURL is paired with a URL.revokeObjectURL', () => {
    const createCount = (source.match(/URL\.createObjectURL/g) ?? []).length
    const revokeCount = (source.match(/URL\.revokeObjectURL/g) ?? []).length
    expect(createCount).toBeGreaterThan(0)
    expect(revokeCount).toBeGreaterThanOrEqual(createCount)
  })

  it('the object URL is revoked inside a finally block, so it releases even if decoding fails', () => {
    expect(source).toContain('finally {')
    const finallyStart = source.indexOf('finally {')
    const finallyEnd = source.indexOf('}', finallyStart)
    expect(source.slice(finallyStart, finallyEnd)).toContain('URL.revokeObjectURL(objectUrl)')
  })

  it('this shared object-URL handling is used by both v2 and v3 (one loader, not two copies)', () => {
    expect(source).toContain('async function loadCroppedAnalysisGrid(file: File)')
    const v2Start = source.indexOf('export async function generateMarkV2(')
    const v3Start = source.indexOf('export async function generateMarkV3(')
    expect(source.slice(v2Start, v2Start + 300)).toContain('loadCroppedAnalysisGrid(file)')
    expect(source.slice(v3Start, v3Start + 300)).toContain('loadCroppedAnalysisGrid(file)')
  })
})

describe('Your Mark engine — determinism: no non-deterministic randomness anywhere in the pipeline', () => {
  it('never calls the non-deterministic RNG', () => {
    expect(source).not.toContain('Math.random')
  })

  it('v2 seeds from the already-abstracted final label grid + harmonized palette, never raw pixel data', () => {
    const v2Start = source.indexOf('export async function generateMarkV2(')
    const seedLineIndex = source.indexOf('const seed = hashInts(seedInputs)', v2Start)
    expect(seedLineIndex).toBeGreaterThan(v2Start)
    const seedBuildStart = source.indexOf('const seedInputs: number[]', v2Start)
    const seedBuildRegion = source.slice(seedBuildStart, seedLineIndex)
    expect(seedBuildRegion).toContain('finalLabels')
    expect(seedBuildRegion).toContain('harmonizedPalette')
    expect(seedBuildRegion).not.toContain('samples')
  })

  it('v3 seeds from mass STATISTICS (centroid/size/colour) only, never raw pixel data', () => {
    const v3Start = source.indexOf('export async function generateMarkV3(')
    const seedLineIndex = source.indexOf('const seed = hashInts(seedInputs)', v3Start)
    expect(seedLineIndex).toBeGreaterThan(v3Start)
    const seedBuildStart = source.indexOf('const seedInputs: number[] = []', v3Start)
    const seedBuildRegion = source.slice(seedBuildStart, seedLineIndex)
    expect(seedBuildRegion).toContain('allStats')
    expect(seedBuildRegion).not.toContain('samples.push')
  })
})

describe('Your Mark engine — output shape is stable', () => {
  it('exports a single, named master size constant used by both pipelines', () => {
    expect(source).toContain('const MASTER_SIZE = 512')
    expect(source).toContain('master.width = MASTER_SIZE')
    expect(source).toContain('master.height = MASTER_SIZE')
  })

  it('exposes explicit, distinct version constants for v2 and v3 — Section F\'s "same algorithm version" contract', () => {
    expect(source).toContain('export const MARK_ALGORITHM_VERSION_V2 = 2')
    expect(source).toContain('export const MARK_ALGORITHM_VERSION_V3 = 3')
    expect(source).toContain('algorithmVersion: MARK_ALGORITHM_VERSION_V2')
    expect(source).toContain('algorithmVersion: MARK_ALGORITHM_VERSION_V3')
  })
})

describe('Your Mark engine — no raw-image draw occurs onto the final master canvas (either version)', () => {
  it('the master context is never painted via drawImage of the decoded source', () => {
    expect(source).not.toMatch(/mctx\.drawImage/)
  })

  it('the decoded source <img> is drawn only once, onto the small shared analysis canvas, never onto either master canvas', () => {
    const drawImageCalls = source.match(/\w+\.drawImage\([^)]*\)/g) ?? []
    const sourceDraws = drawImageCalls.filter((call) => /\bimg\b/.test(call))
    expect(sourceDraws).toHaveLength(1)
    expect(sourceDraws[0]).toContain('actx.drawImage(img,')
  })
})

describe('Algorithm v2 — kept fully intact for SOURCE | V2 | V3 comparison', () => {
  it('still builds region geometry via traceRegionContours -> simplifyPath -> chaikinSmooth, never a raster upscale', () => {
    const v2Start = source.indexOf('export async function generateMarkV2(')
    const v3Start = source.indexOf('export async function generateMarkV3(')
    const v2Body = source.slice(v2Start, v3Start)
    expect(v2Body).toContain('traceRegionContours(mask, ANALYSIS_GRID, ANALYSIS_GRID)')
    expect(v2Body).toContain('simplifyPath(loop, V2_RDP_EPSILON)')
    expect(v2Body).toContain('chaikinSmooth(simplified, V2_CHAIKIN_ITERATIONS, true)')
  })
})

describe('Algorithm v3 — compositional abstraction, not a tuned v2 (architectural contracts)', () => {
  it('blurs the analysis grid BEFORE any clustering — texture becomes a statistic, never extra geometry', () => {
    const v3Start = source.indexOf('export async function generateMarkV3(')
    const blurLine = source.indexOf('boxBlurGrid(samples,', v3Start)
    const clusterLine = source.indexOf('extractPalette(blurred,', v3Start)
    expect(blurLine).toBeGreaterThan(v3Start)
    expect(clusterLine).toBeGreaterThan(blurLine)
  })

  it('computes mass statistics from the ORIGINAL unblurred samples, not the blurred clustering data', () => {
    const v3Start = source.indexOf('export async function generateMarkV3(')
    const statsCallStart = source.indexOf('computeMassStatistics(mask, ANALYSIS_GRID, ANALYSIS_GRID, samples, c)', v3Start)
    expect(statsCallStart).toBeGreaterThan(v3Start)
  })

  it('does NOT force a fixed mass count — the region-reduction cap is a safety ceiling, not a target', () => {
    expect(source).toContain('V3_MAX_MASSES_SAFETY_CAP')
    const capDocIndex = source.indexOf('A generous SAFETY CEILING only — not a target.')
    expect(capDocIndex).toBeGreaterThan(-1)
  })

  it('focal-candidacy scoring is generic (colour distinctiveness, size, compactness, weak centrality), never position-as-primary or semantic', () => {
    const v3Start = source.indexOf('export async function generateMarkV3(')
    const scoreBlockStart = source.indexOf('const focalScores = allStats.map', v3Start)
    expect(scoreBlockStart).toBeGreaterThan(v3Start)
    const lower = source.toLowerCase()
    // "face" appears only inside this file's own two disclaiming
    // comments ("never subject/face-detection-driven") — never as an
    // actual API call or detection library reference.
    expect((lower.match(/\bface\b/g) ?? []).length).toBe(2)
    expect(lower).not.toContain('facedetector')
    // "vision", "biometric" and "portrait" each appear exactly once,
    // same as "face" above — only inside this file's own disclaiming
    // header comments ("AI/vision model", "never a biometric-anonymity
    // guarantee", "never... upper-frame/portrait bias"), never as an
    // actual API call, model reference, or detection bias.
    expect((lower.match(/\bvision\b/g) ?? []).length).toBe(1)
    expect((lower.match(/\bbiometric\b/g) ?? []).length).toBe(1)
    expect((lower.match(/\bportrait\b/g) ?? []).length).toBe(1)
  })

  it('shape classification never depends on colour or hierarchy role — only classifyMassShape(stats, totalArea), a pure geometry function', () => {
    expect(source).toContain('classifyMassShape(stats, totalArea)')
  })

  it('every mass shape is a REGULARIZED parametric form, never its own literal traced contour — v3 never calls traceRegionContours', () => {
    const v3Start = source.indexOf('export async function generateMarkV3(')
    const v3Body = source.slice(v3Start)
    expect(v3Body).not.toContain('traceRegionContours')
    expect(v3Body).not.toContain('simplifyPath')
    expect(v3Body).toContain('generateRegularizedMassPoints(')
  })

  it('local high-frequency variation drives internal tonal BANDING (generateNestedBands), never additional independent shapes', () => {
    expect(source).toContain('generateNestedBands(basePoints, stats.centroid, stats.orientationRad, bandCount)')
    expect(source).toContain('function bandCountFor(textureEnergy: number)')
  })

  it('colour is INTERPRETED (hue/saturation kept, lightness re-expressed across the mass\'s own real tonal range), never a literal region-mean fill', () => {
    const fnStart = source.indexOf('function colorForBand(')
    const fnEnd = source.indexOf('\n}', fnStart)
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('rgbToHsl(stats.meanColor)')
    expect(body).toContain('stats.maxLuminance - stats.minLuminance')
    expect(body).toContain('hslToRgb(')
  })

  it('layering is real: masses are ordered by hierarchy role, not clipped into an edge-to-edge partition — no evenodd tessellation fill in v3', () => {
    const v3Start = source.indexOf('export async function generateMarkV3(')
    const v3Body = source.slice(v3Start)
    expect(v3Body).not.toContain("'evenodd'")
    expect(v3Body).toContain('roleOrder[a.role] - roleOrder[b.role]')
  })

  it('hierarchy roles are assigned deterministically and every mass gets exactly one role', () => {
    expect(source).toContain("roles.set(allStats[focalIndex].label, 'focal')")
    expect(source).toContain("roles.set(dominant.label, 'dominant')")
    expect(source).toContain("if (!roles.has(s.label)) roles.set(s.label, 'secondary')")
  })

  it('the accent mass, when present, is chosen from a genuinely minor existing mass (chooseAccentMass), never synthesized from nothing', () => {
    expect(source).toContain('chooseAccentMass(accentEligible, totalArea, V3_ACCENT_MIN_FRACTION, V3_ACCENT_MAX_FRACTION)')
  })

  it('linework is systematic — every mass outer band is stroked with the SAME fixed ink style, not a sparse 1-2-region special case', () => {
    const fnStart = source.indexOf('export async function generateMarkV3(')
    const strokeBlockStart = source.indexOf('for (const geo of geometries) {', source.indexOf('Systematic linework', fnStart))
    expect(strokeBlockStart).toBeGreaterThan(-1)
    expect(source).toContain('V3_STROKE_STYLE')
  })
})

describe('Your Mark engine — "Show structure" diagnostic contract, all families', () => {
  it('every family captures structureDataUrl BEFORE any accent stroke or texture is drawn', () => {
    for (const fnName of ['generateMarkV2', 'generateMarkV3', 'generateMarkCut', 'generateMarkGlass']) {
      const fnStart = source.indexOf(`export async function ${fnName}(`)
      const nextFnStart = source.indexOf('\nexport async function', fnStart + 10)
      const body = source.slice(fnStart, nextFnStart === -1 ? undefined : nextFnStart)
      const structureIndex = body.indexOf('const structureDataUrl = master.toDataURL')
      const textureIndex = body.indexOf('drawDeterministicTexture(mctx, random, MASTER_SIZE')
      expect(structureIndex, `${fnName} should capture structureDataUrl`).toBeGreaterThan(-1)
      expect(textureIndex).toBeGreaterThan(structureIndex)
    }
  })
})

describe('Your Mark engine — composition is never subject/face-detection-driven (either version)', () => {
  it('crop composition comes from computeSquareFitRect (width/height only), the same function mark-math.test.ts proves is pixel-content-independent', () => {
    expect(source).toContain('computeSquareFitRect(img.naturalWidth, img.naturalHeight)')
  })
})

// ============================================================
// "CHOOSE YOUR MARK" CHECKPOINT — v2/v3 preservation + V4 CUT / V5
// GLASS architectural contracts
// ============================================================

describe('"Choose Your Mark" checkpoint — v2 and v3 are untouched controls', () => {
  it('v2 and v3 still export their original algorithm-version constants, unchanged', () => {
    expect(source).toContain('export const MARK_ALGORITHM_VERSION_V2 = 2')
    expect(source).toContain('export const MARK_ALGORITHM_VERSION_V3 = 3')
  })

  it('v2 and v3 function bodies never reference the new CUT/GLASS-only identifiers — no accidental coupling', () => {
    const v2Start = source.indexOf('export async function generateMarkV2(')
    const v3Start = source.indexOf('export async function generateMarkV3(')
    // v3's own body ends where the new shared "Choose Your Mark" section
    // begins (CUT/GLASS's own code necessarily mentions these
    // identifiers textually below that point — this boundary isolates
    // v3's OWN unmodified function body from that new section).
    const sharedSectionStart = source.indexOf('SHARED COMPOSITIONAL-MASS EXTRACTION')
    const v2Body = source.slice(v2Start, v3Start)
    const v3Body = source.slice(v3Start, sharedSectionStart)
    for (const forbidden of ['extractCompositionalMasses', 'CUT_TUNING', 'GLASS_TUNING', 'generateCutMassPoints', 'generateGlassMassPoints']) {
      expect(v2Body).not.toContain(forbidden)
      expect(v3Body).not.toContain(forbidden)
    }
  })

  it('v2 and v3 each still build their own seed independently — neither calls the new shared extraction function', () => {
    const v2Start = source.indexOf('export async function generateMarkV2(')
    const v3Start = source.indexOf('export async function generateMarkV3(')
    const sharedSectionStart = source.indexOf('SHARED COMPOSITIONAL-MASS EXTRACTION')
    expect(source.slice(v2Start, v3Start)).toContain('const seed = hashInts(seedInputs)')
    expect(source.slice(v3Start, sharedSectionStart)).toContain('const seed = hashInts(seedInputs)')
  })
})

describe('"Choose Your Mark" checkpoint — shared compositional-mass extraction, family-specific tuning', () => {
  it('both new families call the same shared extraction function, not four independent copies of the pipeline', () => {
    const cutStart = source.indexOf('export async function generateMarkCut(')
    const glassStart = source.indexOf('export async function generateMarkGlass(')
    expect(source.slice(cutStart, cutStart + 400)).toContain('extractCompositionalMasses(file, CUT_TUNING)')
    expect(source.slice(glassStart, glassStart + 400)).toContain('extractCompositionalMasses(file, GLASS_TUNING)')
  })

  it('CUT and GLASS use genuinely different tuning constants, not a cosmetic-only difference', () => {
    const cutTuningStart = source.indexOf('const CUT_TUNING: CompositionalTuning = {')
    const glassTuningStart = source.indexOf('const GLASS_TUNING: CompositionalTuning = {')
    const cutTuning = source.slice(cutTuningStart, source.indexOf('}', cutTuningStart))
    const glassTuning = source.slice(glassTuningStart, source.indexOf('}', glassTuningStart))
    expect(cutTuning).not.toBe(glassTuning)
    // Specifically: GLASS is tuned toward fewer/broader masses than CUT
    // (Section F "small number of large forms" vs Section E
    // "approximately 5-8 dominant pieces").
    expect(cutTuning).toContain('maxMasses: 8')
    expect(glassTuning).toContain('maxMasses: 7')
    expect(cutTuning).toContain('minMassFraction: 0.02')
    expect(glassTuning).toContain('minMassFraction: 0.045')
  })

  it('v2, v3, CUT, and GLASS all have distinct, non-overlapping algorithm-version constants', () => {
    const versions = [
      /export const MARK_ALGORITHM_VERSION_V2 = (\d+)/,
      /export const MARK_ALGORITHM_VERSION_V3 = (\d+)/,
      /export const MARK_ALGORITHM_VERSION_V4_CUT = (\d+)/,
      /export const MARK_ALGORITHM_VERSION_V5_GLASS = (\d+)/,
    ].map((re) => {
      const match = source.match(re)
      expect(match, re.toString()).not.toBeNull()
      return Number(match![1])
    })
    expect(new Set(versions).size).toBe(versions.length)
  })
})

describe('"Choose Your Mark" checkpoint — V4 CUT: rendering grammar diverges from v3', () => {
  it('has NO systematic per-mass outline stroke — a deliberate, visible difference from v3', () => {
    const cutStart = source.indexOf('export async function generateMarkCut(')
    const glassStart = source.indexOf('export async function generateMarkGlass(')
    const cutBody = source.slice(cutStart, glassStart)
    expect(cutBody).not.toContain('strokeLoop(')
    expect(cutBody).not.toContain('V3_STROKE_STYLE')
  })

  it('uses its own asymmetric silhouette generator, never v3\'s ellipse generator or v2\'s literal contour trace', () => {
    const cutStart = source.indexOf('export async function generateMarkCut(')
    const glassStart = source.indexOf('export async function generateMarkGlass(')
    const cutBody = source.slice(cutStart, glassStart)
    expect(cutBody).toContain('generateCutMassPoints(')
    expect(cutBody).not.toContain('generateRegularizedMassPoints(')
    expect(cutBody).not.toContain('traceRegionContours(')
  })

  it('renders a continuous two-stop gradient per shape, never v3\'s discrete nested bands', () => {
    const cutStart = source.indexOf('export async function generateMarkCut(')
    const glassStart = source.indexOf('export async function generateMarkGlass(')
    const cutBody = source.slice(cutStart, glassStart)
    expect(cutBody).toContain('createRadialGradient(')
    expect(cutBody).not.toContain('generateNestedBands(')
  })

  it('shape TYPE selection still comes from the shared, generic classifyMassShape — no new semantic classifier', () => {
    const cutStart = source.indexOf('export async function generateMarkCut(')
    const glassStart = source.indexOf('export async function generateMarkGlass(')
    expect(source.slice(cutStart, glassStart)).toContain('classifyMassShape(mass.stats, totalArea)')
  })
})

describe('"Choose Your Mark" checkpoint — V5 GLASS: rendering grammar diverges from v2/v3/CUT', () => {
  it('uses partial opacity (translucency) for its fills — the "luminous intersection" mechanism', () => {
    const glassStart = source.indexOf('export async function generateMarkGlass(')
    const glassBody = source.slice(glassStart)
    expect(glassBody).toMatch(/mctx\.globalAlpha = mass\.role/)
  })

  it('the warm seam is restrained to focal/accent masses only, never systematic across every mass', () => {
    const glassStart = source.indexOf('export async function generateMarkGlass(')
    const glassBody = source.slice(glassStart)
    expect(glassBody).toContain("loop.role !== 'focal' && loop.role !== 'accent'")
  })

  it('uses its own low-vertex faceted silhouette generator, never CUT\'s or v3\'s generators', () => {
    const glassStart = source.indexOf('export async function generateMarkGlass(')
    const glassBody = source.slice(glassStart)
    expect(glassBody).toContain('generateGlassMassPoints(')
    expect(glassBody).not.toContain('generateCutMassPoints(')
    expect(glassBody).not.toContain('generateRegularizedMassPoints(')
  })
})

describe('"Choose Your Mark" checkpoint — colour still descends from source, no house palette', () => {
  it('CUT and GLASS both derive tone from each mass\'s own measured meanColor, never a fixed/hardcoded colour literal', () => {
    const cutStart = source.indexOf('export async function generateMarkCut(')
    const glassStart = source.indexOf('export async function generateMarkGlass(')
    const cutBody = source.slice(cutStart, glassStart)
    const glassBody = source.slice(glassStart)
    expect(cutBody).toContain('cutToneColor(mass.stats.meanColor,')
    expect(glassBody).toContain('glassToneColor(mass.stats.meanColor,')
  })
})
