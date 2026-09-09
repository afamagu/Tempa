import type { Moment, MomentDraft } from './moments'

// The plain-JSON shape of the composer's Tiptap/ProseMirror document —
// deliberately a hand-written type, not an import of ProseMirror's own
// Node type, so this file (and everything that tests against it) never
// needs a live editor instance or a DOM. This is exactly the shape
// `editor.getJSON()` produces for the schema the composer uses:
// paragraphs containing text (optionally marked bold/italic), hard
// breaks, and photoMoment atoms — no heading/list/link/color/font
// nodes or marks exist in that schema at all, so nothing beyond Bold
// and Italic can ever appear here regardless of what a member pastes
// (see docToPlainBody's own doc comment for why storage stays plain
// text rather than HTML/rich-JSON).
export type MarkJSON = { type: 'bold' } | { type: 'italic' }
export type TextNodeJSON = { type: 'text'; text: string; marks?: MarkJSON[] }
export type HardBreakNodeJSON = { type: 'hardBreak' }
export type PhotoMomentNodeJSON = {
  type: 'photoMoment'
  attrs: { imagePath: string; previewUrl?: string | null }
}
export type PostcardMomentNodeJSON = {
  type: 'postcardMoment'
  attrs: { postcardKey: string }
}
export type InlineNodeJSON = TextNodeJSON | HardBreakNodeJSON | PhotoMomentNodeJSON | PostcardMomentNodeJSON
export type ParagraphNodeJSON = { type: 'paragraph'; content?: InlineNodeJSON[] }
export type LetterDocJSON = { type: 'doc'; content?: ParagraphNodeJSON[] }

/** A single empty paragraph — Tiptap's own default empty-document shape
 * for this schema, and what a brand-new (no draft) compose session
 * starts from. */
export const EMPTY_LETTER_DOC: LetterDocJSON = { type: 'doc', content: [{ type: 'paragraph' }] }

// ============================================================
// BOLD/ITALIC STORAGE — writing/composer essentials checkpoint.
//
// letters.body (and question_answers.body) are, and remain, plain
// `text` columns — no schema change. Storing real HTML or ProseMirror
// JSON there would mean sanitizing/rendering arbitrary rich content
// everywhere a letter is read (search, previews, the reader, printed
// exports later) for a feature that's deliberately restricted to two
// marks. Instead, Bold/Italic are written into the EXISTING plain
// string as a small, unambiguous, non-HTML markup subset — **bold**
// and _italic_ — chosen specifically because "**" and "_" essentially
// never occur in ordinary correspondence prose, and because the two
// delimiters share no characters, so a token scanner never has to
// guess which one it's looking at. This is the encoding half; see
// parseFormattedText below for decoding, and markupBodyToLetterDoc for
// reconstructing an editable document from it (the reply-draft path).
//
// A literal "*", "_", or "\" a member actually types is escaped
// (backslash-prefixed) so it can never be mistaken for a delimiter —
// see escapePlainRun. This is a plain string transformation, never
// HTML generation: there is no injection surface, and paragraph/
// hard-break structure (what Moments position against) is completely
// untouched by any of this.
//
// HISTORICAL COMPATIBILITY — final compatibility audit (2026-09-05).
// Escaping protects content written THROUGH the new editor going
// forward; it does nothing for letters already stored before this
// feature existed, which were never escaped because there was nothing
// to escape from. A historical body containing "**not originally
// bold**" (someone's own markdown-style emphasis, or pure coincidence)
// or even a single stray "_" (e.g. "my_username" — the decoder has no
// closing marker to pair it with, so everything AFTER that underscore
// in the paragraph would render italic) would be silently
// reinterpreted as formatting by parseFormattedText alone. That
// violates the required invariant ("introducing Bold/Italic must not
// silently reinterpret ordinary historical letters as formatted
// content") for any row written before this checkpoint.
//
// Fix: an explicit format marker, RICH_BODY_MARKER, prepended to the
// plain body ONLY when docToPlainBody actually encoded at least one
// mark somewhere in the document. A body with no marker is — and can
// only ever be — either historical content or a letter written after
// this feature shipped that simply used no formatting; either way it
// is rendered as pure literal text, NEVER passed through
// parseFormattedText's tokenizer, regardless of what characters it
// contains. Only a body carrying the marker (meaning: definitely
// produced by this encoder, definitely properly escaped) is ever
// decoded for marks. This needs no schema/SQL change — the marker
// lives inside the existing plain `text` column, stripped before any
// paragraph splitting or display — and requires no migration of
// existing rows: they simply lack the marker forever, which is exactly
// the correct, safe outcome for them.
//
// U+2063 (INVISIBLE SEPARATOR) was chosen specifically because it is
// classified Unicode category Cf (format), not Zs/whitespace — so it
// survives both JavaScript's and Postgres's `trim()` untouched, no
// keyboard or IME produces it, and it renders as nothing if a marker-
// stripping step were ever somehow skipped. It is never valid content
// on its own; RICH_BODY_MARKER is what call sites check for, never a
// character members can type through this app's editors (Text
// extension aside, TEMPA's UI never inserts it except here).
// ============================================================

// Written via fromCharCode (rather than a literal character or a
// string-literal \u escape) so the marker is never an invisible,
// easy-to-accidentally-duplicate-or-delete glyph sitting silently in
// this file's source.
export const RICH_BODY_MARKER = String.fromCharCode(0x2063)

/**
 * Pure: whether a raw, stored body (letters.body, or a draft string in
 * lib/letter-draft.ts) was produced by the rich encoder, and the same
 * body with that marker removed either way. MUST be called once
 * against the untouched raw value, BEFORE any paragraph splitting —
 * the marker only ever appears at position 0 of the WHOLE body, not on
 * each paragraph independently, since a letter is either entirely
 * "from the new encoder" or entirely historical/legacy.
 */
export function stripRichBodyMarker(body: string): { isRich: boolean; body: string } {
  if (body.startsWith(RICH_BODY_MARKER)) {
    return { isRich: true, body: body.slice(RICH_BODY_MARKER.length) }
  }
  return { isRich: false, body }
}

function escapePlainRun(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\*/g, '\\*').replace(/_/g, '\\_')
}

function encodeTextNode(node: TextNodeJSON): string {
  const marks = node.marks ?? []
  const bold = marks.some((m) => m.type === 'bold')
  const italic = marks.some((m) => m.type === 'italic')
  let text = escapePlainRun(node.text)
  if (italic) text = `_${text}_`
  if (bold) text = `**${text}**`
  return text
}

/**
 * The document's plain-text `p_body`, exactly as the live RPC and its
 * paragraph_count validation expect: paragraphs joined by a blank line,
 * a hard break rendered as a single newline within its paragraph.
 * photoMoment nodes contribute no text at all — the whole point of
 * making it a real node in the tree rather than encoding it as text is
 * that it can never leak into the letter's own words. A text node's
 * bold/italic marks (if any) are encoded as delimiters (double
 * asterisks / a single underscore) around its own escaped text — see
 * the section comment above.
 */
/**
 * One paragraph's own plain-text contribution — factored out of
 * docToPlainBody so the collapse-aware position mapping below
 * (paragraphCollapsedPositions) computes emptiness from the EXACT same
 * per-paragraph text docToPlainBody itself produces, rather than a
 * second, separately-maintained guess that could quietly drift out of
 * agreement with what splitParagraphs actually collapses. `marks` is
 * irrelevant to whether a paragraph is empty (a bold/italic run around
 * real text is still real text), so this intentionally does not
 * replicate encodeTextNode's delimiter-wrapping — only docToPlainBody
 * itself needs that, for its own hasAnyMarks tracking.
 */
function paragraphPlainText(paragraph: ParagraphNodeJSON): string {
  return (paragraph.content ?? [])
    .map((node) => {
      if (node.type === 'text') return node.text
      if (node.type === 'hardBreak') return '\n'
      return ''
    })
    .join('')
}

export function docToPlainBody(doc: LetterDocJSON): string {
  const paragraphs = doc.content ?? []
  let hasAnyMarks = false

  const plain = paragraphs
    .map((paragraph) =>
      (paragraph.content ?? [])
        .map((node) => {
          if (node.type === 'text') {
            if ((node.marks ?? []).length > 0) hasAnyMarks = true
            return encodeTextNode(node)
          }
          if (node.type === 'hardBreak') return '\n'
          return ''
        })
        .join('')
    )
    .join('\n\n')

  // The marker is added ONLY when a mark was actually used anywhere —
  // an entirely plain letter (the overwhelming common case, and every
  // letter ever written before this checkpoint) produces byte-
  // identical output to before this feature existed. Only a body that
  // genuinely needs mark-decoding carries the marker that authorizes
  // it.
  return hasAnyMarks ? RICH_BODY_MARKER + plain : plain
}

export type LetterTextSegment = { text: string; bold: boolean; italic: boolean }

// Ordered so a run of two asterisks is always consumed as ONE "**"
// token rather than two separate "*" tokens — deliberately not using
// single-asterisk italic at all, precisely to avoid that ambiguity.
const MARKUP_TOKEN_RE = /(\\\*|\\_|\\\\|\*\*|_)/g

/**
 * Pure: decodes the restrained inline-markup subset docToPlainBody
 * writes bold/italic marks as — **bold** and _italic_ — into
 * renderable segments. A plain tokenizer over a plain string, never
 * HTML/dangerouslySetInnerHTML, so there is no injection surface
 * regardless of what a member types. `\*`, `\_`, and `\\` are the
 * escape sequences docToPlainBody writes for a literal asterisk/
 * underscore/backslash a member actually typed, so those round-trip
 * back to the literal character rather than toggling a mark.
 *
 * Known, accepted limitation: a body saved before this feature existed
 * that happens to already contain an unescaped "**" or "_" pair (rare
 * in ordinary prose) will be misread as formatting the first time it's
 * displayed under this parser — the words themselves are never lost,
 * only possibly mis-styled. Documented in the build guide rather than
 * silently treated as fully solved.
 */
export function parseFormattedText(line: string): LetterTextSegment[] {
  const tokens = line.split(MARKUP_TOKEN_RE)
  const segments: LetterTextSegment[] = []
  let bold = false
  let italic = false
  let buffer = ''

  function flush() {
    if (buffer.length > 0) segments.push({ text: buffer, bold, italic })
    buffer = ''
  }

  for (const token of tokens) {
    if (token === '') continue
    if (token === '\\*') buffer += '*'
    else if (token === '\\_') buffer += '_'
    else if (token === '\\\\') buffer += '\\'
    else if (token === '**') {
      flush()
      bold = !bold
    } else if (token === '_') {
      flush()
      italic = !italic
    } else {
      buffer += token
    }
  }
  flush()

  return segments
}

/**
 * Every attached photoMoment, with `position` computed by walking the
 * FINAL paragraph tree top to bottom — never a separately-maintained
 * index. A photoMoment is a real child of the paragraph node it
 * belongs to, so this is always correct after any edit anywhere else
 * in the document: inserting or deleting an earlier paragraph changes
 * which index a later paragraph's content is found at on this walk,
 * exactly matching where the database/RPC now expect it, with nothing
 * to go stale in between.
 */
/**
 * Draft-integrity checkpoint (2026-09-08) — root cause of "Photo Moments
 * break after a draft refresh": a photoMoment node's `previewUrl` attr
 * holds a `URL.createObjectURL(blob)` reference (see moments-
 * composer.tsx's handleFileChosen) that is valid only for the lifetime
 * of the page that created it. `onUpdate` persisted `editor.getJSON()`
 * VERBATIM into the draft (lib/letter-editor-draft.ts), so that
 * session-only blob: URL was written to localStorage as part of the
 * doc JSON. On restore, `editor.commands.setContent(richDraft)` set
 * that now-dead blob: string back onto the node — and because
 * PhotoMomentView's own restore effect (photo-moment-node.tsx) only
 * re-requests a fresh signed URL when `previewUrl` is ABSENT
 * (`if (previewUrl || !imagePath) return`), a present-but-dead value
 * silently defeated that already-correct fallback. `imagePath` (the
 * durable, already-uploaded Storage path) was never the problem — it
 * survived the round-trip correctly the whole time.
 *
 * This function is the fix: it strips `previewUrl` from every
 * photoMoment node, keeping only the durable `imagePath`. Applied both
 * when WRITING a draft (so a fresh autosave never persists a browser-
 * session-only value going forward — the locked rule: "a saved TEMPA
 * draft must never depend on a browser-session URL") and when READING
 * one back (so a draft already saved before this fix, which still has
 * the stale value sitting in localStorage, self-heals the moment it's
 * loaded, rather than staying permanently broken). Once `previewUrl` is
 * genuinely absent, PhotoMomentView's existing effect does exactly what
 * it was always designed to do: request a fresh signed URL from the
 * durable path. Nothing about photoMoment's own node/schema changed —
 * only which attrs are allowed to leave/enter persistence.
 */
export function stripTransientPhotoPreviews(doc: LetterDocJSON): LetterDocJSON {
  return {
    ...doc,
    content: (doc.content ?? []).map((paragraph) => ({
      ...paragraph,
      content: (paragraph.content ?? []).map((node) =>
        node.type === 'photoMoment'
          ? { type: 'photoMoment' as const, attrs: { imagePath: node.attrs.imagePath, previewUrl: null } }
          : node
      ),
    })),
  }
}

/**
 * Pre-migration audit correction (2026-09-14), Part 2 — NEW POSTCARDS
 * ARE NOT MOMENTS: write_letter/reply_to_letter no longer accept a
 * 'postcard'-type entry in `p_moments` at all (only 'photo' now — see
 * the 2026-09-14 migration). A draft saved BEFORE that checkpoint may
 * still have an old inline `postcardMoment` node sitting in localStorage
 * (postcard-moment-node.tsx, deliberately kept registered for exactly
 * this restore case) — sending it unchanged would now be rejected
 * server-side with "Unknown Moment type." This function finds the
 * FIRST such node in a restored doc (a well-formed legacy draft never
 * had more than one — "never multiple Postcards" was already the rule
 * before this checkpoint too), so the composer can migrate it into the
 * new separate LetterPostcardDraft on restore, gracefully, with no
 * member action required. Returns null when there is none.
 */
export function extractLegacyPostcardMoment(doc: LetterDocJSON): { postcardKey: string } | null {
  for (const paragraph of doc.content ?? []) {
    for (const node of paragraph.content ?? []) {
      if (node.type === 'postcardMoment') return { postcardKey: node.attrs.postcardKey }
    }
  }
  return null
}

/**
 * The other half of the migration above: removes every `postcardMoment`
 * node from a doc, leaving every paragraph's text/hardBreak/photoMoment
 * content completely untouched. Applied to a restored draft immediately
 * after its (sole, by construction) postcardMoment has been read via
 * extractLegacyPostcardMoment — the editor document itself must never
 * carry one again once it's been migrated into the separate letter-level
 * draft, or Send would try to submit it twice (once via the new
 * p_postcard payload, once via the now-rejected p_moments entry).
 */
export function stripPostcardMoments(doc: LetterDocJSON): LetterDocJSON {
  return {
    ...doc,
    content: (doc.content ?? []).map((paragraph) => ({
      ...paragraph,
      content: (paragraph.content ?? []).filter((node) => node.type !== 'postcardMoment'),
    })),
  }
}

export function docToMomentDrafts(doc: LetterDocJSON): MomentDraft[] {
  const paragraphs = doc.content ?? []
  const drafts: MomentDraft[] = []

  paragraphs.forEach((paragraph, position) => {
    for (const node of paragraph.content ?? []) {
      if (node.type === 'photoMoment') {
        drafts.push({ position, type: 'photo', imagePath: node.attrs.imagePath })
      }
      if (node.type === 'postcardMoment') {
        drafts.push({ position, type: 'postcard', postcardKey: node.attrs.postcardKey })
      }
    }
  })

  return drafts
}

/**
 * Live-repair checkpoint (2026-09-08), Part F — the collapsed position
 * every RAW paragraph index actually lands on once docToPlainBody's
 * output passes through splitParagraphs (`.trim()` then
 * `split(/\n\s*\n/)`, mirrored server-side by write_letter/
 * reply_to_letter's own `regexp_split_to_array(body, '\n\s*\n')`) — the
 * array LetterBody actually indexes a Moment's `position` against.
 *
 * A text-empty paragraph (no real content once trimmed — Moments
 * contribute no text of their own) never survives as its own element:
 * an INTERIOR empty paragraph is absorbed into the blank-line run
 * between its neighbors (a run of N empty paragraphs between two real
 * ones collapses to exactly one split boundary, however many newlines
 * it's made of), and a LEADING or TRAILING empty paragraph is removed
 * outright by splitParagraphs' own whole-string `.trim()`. Both
 * docToMomentDrafts (the real send path) and the previous checkpoint's
 * docToPreviewMoments computed `position` from the RAW paragraph index
 * with no awareness of this collapse — harmless for the overwhelmingly
 * common case (a Moment's own paragraph always has real text, since the
 * composer's ⊕ only ever offers itself on an already-completed,
 * non-empty paragraph — see completedParagraphs, lib/moments.ts), but
 * wrong the moment an EARLIER paragraph anywhere in the document is
 * empty (e.g. an intentional blank line for spacing), which silently
 * shifts every later Moment's true rendered position down by one for
 * each such paragraph — a real, demonstrable class of "Moment renders
 * on the wrong paragraph, or not at all" that has nothing to do with
 * photo signing.
 *
 * This is intentionally scoped to Preview's own adapter only —
 * docToMomentDrafts, docToPlainBody, and splitParagraphs (and its SQL
 * mirror) are all left exactly as they are; fixing the collapse there
 * would require a matching SQL change, which this checkpoint forbids,
 * and risks the real send/read path. Making Preview predict the
 * collapse instead is safe, additive, and never touches storage.
 *
 * Every raw index is guaranteed a valid, in-range result: a paragraph
 * that survives collapse maps to its own position among the survivors;
 * one that doesn't (empty, interior or edge) maps to the nearest
 * following survivor, or the nearest preceding one if it's the last
 * paragraph(s), or 0 if the whole document is empty. A Moment can never
 * be silently dropped for landing "out of range" — Part F's explicit
 * requirement — even in the edge case where a Moment's own paragraph
 * has since had all its text deleted.
 */
function paragraphCollapsedPositions(paragraphs: ParagraphNodeJSON[]): number[] {
  const survivingRawIndices: number[] = []
  paragraphs.forEach((paragraph, rawIndex) => {
    if (paragraphPlainText(paragraph).trim().length > 0) survivingRawIndices.push(rawIndex)
  })

  if (survivingRawIndices.length === 0) return paragraphs.map(() => 0)

  return paragraphs.map((_, rawIndex) => {
    const ownSlot = survivingRawIndices.indexOf(rawIndex)
    if (ownSlot !== -1) return ownSlot

    const nextSlot = survivingRawIndices.findIndex((survivorIndex) => survivorIndex > rawIndex)
    if (nextSlot !== -1) return nextSlot

    return survivingRawIndices.length - 1
  })
}

/** One attached Moment as it actually sits in the LIVE editor document —
 * durable identity only (`imagePath`/`postcardKey`), plus whatever
 * `previewUrl` the live node currently happens to carry (present for a
 * just-added, current-session photo; `null` for anything restored from
 * a saved draft — see stripTransientPhotoPreviews). Never itself a
 * final `Moment` — no photo here has necessarily been resolved to a
 * usable display URL yet. `position` is already collapse-aware (see
 * paragraphCollapsedPositions above). */
export type DraftMomentDescriptor =
  | { id: string; position: number; type: 'photo'; imagePath: string; previewUrl: string | null }
  | { id: string; position: number; type: 'postcard'; postcardKey: string }

/**
 * Pure, synchronous: the live editor document's own Moments, positioned
 * exactly where LetterBody will actually look for them. Deliberately
 * NOT the same as docToMomentDrafts (that one feeds the RPC — durable
 * fields only, raw non-collapse-aware position, since it's validated
 * against the SAME raw-vs-collapsed reality server-side... this one
 * feeds an on-screen Preview of a document that hasn't been sent yet).
 * Carries no resolved `imageUrl` at all — see resolveDraftPreviewMoments
 * below, which turns these into real `Moment[]`.
 */
export function docToDraftMomentDescriptors(doc: LetterDocJSON): DraftMomentDescriptor[] {
  const paragraphs = doc.content ?? []
  const positions = paragraphCollapsedPositions(paragraphs)
  const descriptors: DraftMomentDescriptor[] = []

  paragraphs.forEach((paragraph, rawIndex) => {
    const position = positions[rawIndex]
    ;(paragraph.content ?? []).forEach((node, nodeIndex) => {
      if (node.type === 'photoMoment') {
        descriptors.push({
          id: `preview-photo-${rawIndex}-${nodeIndex}`,
          position,
          type: 'photo',
          imagePath: node.attrs.imagePath,
          previewUrl: node.attrs.previewUrl ?? null,
        })
      }
      if (node.type === 'postcardMoment') {
        descriptors.push({
          id: `preview-postcard-${rawIndex}-${nodeIndex}`,
          position,
          type: 'postcard',
          postcardKey: node.attrs.postcardKey,
        })
      }
    })
  })

  return descriptors
}

/**
 * A deliberately calm, always-loadable inline SVG — a real, valid image
 * (never a sentinel string, never null) substituted as a Photo Moment's
 * `imageUrl` when resolveLetterPhotoUrl fails even after the editor's
 * own retry. Renders through the EXISTING, unmodified PhotoMomentToken/
 * `<img>` path with zero changes to LetterBody — Part H's explicit
 * requirement ("do not render a raw browser broken-image glyph," never
 * "extend LetterBody's Moment type to add a new render branch"). Muted
 * gray, no alarming color — restrained, matching a Moment that is still
 * genuinely attached and will still send, just not previewable right now.
 */
export const UNAVAILABLE_PHOTO_DATA_URI =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
      '<rect width="80" height="80" fill="#d4d4d4"/>' +
      '<path d="M24 52 L34 40 L42 48 L52 34 L60 52 Z" fill="#a3a3a3"/>' +
      '<circle cx="30" cy="30" r="5" fill="#a3a3a3"/>' +
      '</svg>'
  )

/**
 * Draft-preview checkpoint (2026-09-08) — turns the pure descriptors
 * above into the real `Moment[]` LetterBody renders, resolving every
 * Photo's durable `imagePath` into a usable display URL through the ONE
 * canonical resolver (`resolvePhotoUrl` — always
 * resolveLetterPhotoUrl from lib/draft-photo-url.ts in production; a
 * caller injects a fake here in tests specifically so this async logic
 * is directly testable, never proven only by source-text inspection).
 *
 * Two cases per photo, matching the live-repair report exactly:
 *  - Case 1 (just added this session): `previewUrl` is already a live,
 *    valid reference — used directly, no network call at all.
 *  - Case 2 (restored from a saved draft): `previewUrl` is null by
 *    design (see stripTransientPhotoPreviews) — resolved fresh from
 *    `imagePath` via the injected resolver.
 * Preview therefore never depends on `previewUrl` being present, unlike
 * the previous checkpoint's docToPreviewMoments.
 *
 * All photos resolve in parallel via Promise.all — one photo failing to
 * resolve never blocks or drops any other Moment (Part J-J); a failure
 * substitutes UNAVAILABLE_PHOTO_DATA_URI rather than null, so Preview
 * never silently discards the Moment or its paragraph position (Part
 * H). Postcards need no resolution at all and pass straight through.
 */
export async function resolveDraftPreviewMoments(
  descriptors: DraftMomentDescriptor[],
  resolvePhotoUrl: (imagePath: string) => Promise<{ url: string | null; error: string | null }>
): Promise<Moment[]> {
  return Promise.all(
    descriptors.map(async (descriptor): Promise<Moment> => {
      if (descriptor.type === 'postcard') {
        return {
          id: descriptor.id,
          position: descriptor.position,
          type: 'postcard',
          imageUrl: null,
          postcardKey: descriptor.postcardKey,
        }
      }

      if (descriptor.previewUrl) {
        return {
          id: descriptor.id,
          position: descriptor.position,
          type: 'photo',
          imageUrl: descriptor.previewUrl,
          postcardKey: null,
        }
      }

      const { url } = await resolvePhotoUrl(descriptor.imagePath)
      return {
        id: descriptor.id,
        position: descriptor.position,
        type: 'photo',
        imageUrl: url ?? UNAVAILABLE_PHOTO_DATA_URI,
        postcardKey: null,
      }
    })
  )
}

/**
 * True once there's real writing or at least one attached photo —
 * mirrors the old composer's hasContent check, now against the
 * document tree instead of a flat paragraphs array.
 *
 * Checks each text node's own RAW `.text` directly, never
 * `docToPlainBody`'s ENCODED output — send-button regression audit
 * (2026-09-05) found that checking the encoded string is fooled by the
 * encoding's own artifacts: a bold/italic run's `**`/`_` delimiters
 * (and the rich-body marker docToPlainBody prepends once any mark is
 * used) are always non-whitespace characters, so a paragraph
 * containing ONLY a bold mark wrapped around whitespace — real content
 * a member never actually typed — would incorrectly read as non-empty
 * once trimmed. Reading the raw text directly is immune to this by
 * construction: it never sees delimiters or the marker at all, only
 * what the member actually typed.
 */
export function letterDocHasContent(doc: LetterDocJSON): boolean {
  const paragraphs = doc.content ?? []
  const hasRealText = paragraphs.some((paragraph) =>
    (paragraph.content ?? []).some((node) => node.type === 'text' && node.text.trim().length > 0)
  )
  return hasRealText || docToMomentDrafts(doc).length > 0
}

/**
 * Pure: whether a letter composer's Send action should be enabled,
 * given its current editor content plus the composer's own submission/
 * length state. Delegates entirely to letterDocHasContent for "is
 * there real content" — a text node's bold/italic marks never change
 * that answer on their own (a paragraph containing only an empty bold
 * run still has no actual text, per docToPlainBody's own trim check),
 * and any non-whitespace Unicode (including emoji, which is just a
 * character like any other) already counts exactly as it did before
 * this helper existed — no new minimum-content rule is introduced
 * here.
 *
 * Exists so a composer has exactly ONE function deciding "can this be
 * sent," used identically for the button's disabled state and the
 * submit handler's own guard — never two independently-maintained
 * booleans that can drift apart.
 */
export function canSendLetter(doc: LetterDocJSON, options: { aboveMax: boolean; submitting: boolean }): boolean {
  return letterDocHasContent(doc) && !options.aboveMax && !options.submitting
}

/**
 * Seeds the editor from a plain-text draft saved under the OLD (pre-
 * rich-editor) draft format — one paragraph per blank-line-separated
 * region, no Moments (that format never stored any). Only used as a
 * one-time fallback when no new-format draft exists yet, so a letter
 * already in progress when this shipped isn't silently lost.
 */
export function plainBodyToLetterDoc(body: string): LetterDocJSON {
  const trimmed = body.trim()
  if (trimmed.length === 0) return EMPTY_LETTER_DOC

  const paragraphs = trimmed.split(/\n\s*\n/).map((text) => text.trim())
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: text.length > 0 ? [{ type: 'text', text }] : undefined,
    })),
  }
}

/**
 * The counterpart to plainBodyToLetterDoc for a body that MAY contain
 * this app's own bold/italic markup (docToPlainBody's own encoding) —
 * used to restore the first-contact-reply draft (lib/letter-draft.ts,
 * still a plain string; only the string it now sometimes contains has
 * changed) back into an editable, correctly-marked document.
 *
 * Checks stripRichBodyMarker FIRST, once, against the whole body: a
 * draft written before this feature existed (or one that simply has
 * no formatting) carries no marker and is delegated straight to
 * plainBodyToLetterDoc — guaranteeing it can never be misread as
 * containing marks no matter what characters it happens to contain.
 * Only a marker-carrying body (guaranteed to have come from this
 * app's own encoder) proceeds to per-paragraph, per-line mark
 * decoding via parseFormattedText.
 */
export function markupBodyToLetterDoc(body: string): LetterDocJSON {
  const { isRich, body: stripped } = stripRichBodyMarker(body)
  if (!isRich) return plainBodyToLetterDoc(stripped)

  const trimmed = stripped.trim()
  if (trimmed.length === 0) return EMPTY_LETTER_DOC

  const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim())
  return {
    type: 'doc',
    content: paragraphs.map((paragraphText) => {
      if (paragraphText.length === 0) return { type: 'paragraph' }

      const lines = paragraphText.split('\n')
      const content: InlineNodeJSON[] = []

      lines.forEach((line, i) => {
        if (i > 0) content.push({ type: 'hardBreak' })
        for (const segment of parseFormattedText(line)) {
          if (segment.text.length === 0) continue
          const marks: MarkJSON[] = []
          if (segment.bold) marks.push({ type: 'bold' })
          if (segment.italic) marks.push({ type: 'italic' })
          content.push(marks.length > 0 ? { type: 'text', text: segment.text, marks } : { type: 'text', text: segment.text })
        }
      })

      return { type: 'paragraph', content: content.length > 0 ? content : undefined }
    }),
  }
}

/**
 * The Dispatch-editing counterpart to markupBodyToLetterDoc — reused
 * completely unchanged for every bit of text/mark/hardBreak
 * reconstruction (this is deliberately NOT a second implementation of
 * that logic); the only thing this adds is reattaching each still-image
 * Moment as the last inline node of its paragraph, matching where the
 * composer always places one (insertPhotoMomentAtParagraphEnd) and
 * matching docToMomentDrafts' own position indexing. Needed only for
 * editing (Board usability checkpoint, 2026-09-09): nothing in this
 * codebase previously needed to load existing writing back into an
 * editor, since letters are append-only.
 */
export function dispatchBodyToDoc(
  body: string,
  moments: { position: number; imagePath: string; previewUrl: string | null }[] = []
): LetterDocJSON {
  const doc = markupBodyToLetterDoc(body)
  if (moments.length === 0) return doc

  const momentByPosition = new Map(moments.map((m) => [m.position, m]))

  return {
    ...doc,
    content: (doc.content ?? []).map((paragraph, index) => {
      const moment = momentByPosition.get(index)
      if (!moment) return paragraph
      return {
        ...paragraph,
        content: [
          ...(paragraph.content ?? []),
          { type: 'photoMoment', attrs: { imagePath: moment.imagePath, previewUrl: moment.previewUrl } },
        ],
      }
    }),
  }
}
