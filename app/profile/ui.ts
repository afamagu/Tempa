// Tempa's shared visual-system tokens. Interface chrome (this file's
// defaults) stays on the Geist sans set in app/layout.tsx; the
// prose*/context*/closure* helpers below opt into the Newsreader serif
// for human voice — Questions, published answers, letters, pseudonyms.
//
// Semantic type scale (design ranges, not exact pixel mandates):
//   page title            28–34px  → proseHeadingClass
//   section title         18–21px  → sectionTitleClass
//   reading/letter/answer body  18–20px  → proseBodyClass
//   contextual Question   17–20px  → contextQuestionClass
//   meaningful system/closure text  16–17px  → closureTextClass
//   UI/control text       15–16px  → buttons/inputs below
//   metadata only         13–14px  → helperTextClass / sectionLabelClass
//
// Principle: the Question provides context, the person's answer is the
// content — contextQuestionClass is deliberately smaller and quieter
// (muted color) than proseBodyClass, never the reverse.

export const inputClass =
  'w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2.5 text-[15px] outline-none transition-colors placeholder:text-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/25'

// A small uppercase kicker/eyebrow — metadata tier, sits above a heading
// or names a compact list ("THE QUESTION", "From Utopia").
export const sectionLabelClass =
  'text-[13px] font-medium uppercase tracking-wider text-muted'

// A real heading for a grouped section (e.g. Letters' "Awaiting your
// reply") — distinct from the tiny eyebrow above.
export const sectionTitleClass = 'text-lg sm:text-xl font-medium text-foreground'

export const helperTextClass = 'text-[13px] text-muted'

export const fieldLabelClass = 'block text-[15px] font-medium text-foreground'

export const primaryButtonClass =
  'inline-flex items-center justify-center rounded-md bg-accent text-accent-foreground px-4 py-3 text-[15px] font-medium transition-colors hover:bg-accent/90 disabled:opacity-50'

export const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-md border border-foreground/15 px-4 py-2.5 text-[15px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]'

// Release Polish Pass — the fourth rung of the button hierarchy
// (primary / secondary / tertiary / destructive): no border, no fill,
// quieter than secondaryButtonClass. For a reversible, low-stakes
// action that shouldn't visually compete with — or be mistaken for —
// a genuinely destructive one (e.g. removing an unsent Postcard draft,
// which the sender can simply re-attach).
export const tertiaryButtonClass =
  'inline-flex items-center justify-center rounded-md px-4 py-2.5 text-[15px] font-medium text-foreground/60 transition-colors hover:bg-foreground/[.05] hover:text-foreground'

// A quiet text action — for a link-weight action that shouldn't compete
// visually with a bordered or filled button (e.g. "Read the complete
// answer").
export const quietLinkClass =
  'inline-block text-[15px] text-foreground/70 underline decoration-foreground/30 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/60'

export function pillClass(selected: boolean) {
  return [
    'rounded-full border px-3.5 py-2 text-[15px] transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25',
    selected
      ? 'border-accent bg-accent/10 font-medium text-foreground'
      : 'border-foreground/15 text-foreground hover:border-foreground/30',
  ].join(' ')
}

export function cardClass(selected: boolean) {
  return [
    'w-full text-left rounded-md border px-3.5 py-3 transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25',
    selected
      ? 'border-accent bg-accent/[.06]'
      : 'border-foreground/15 hover:border-foreground/30',
  ].join(' ')
}

// Human-voice type scale (Newsreader serif). A small, deliberate set so
// Questions/answers/letters draw from the same few sizes everywhere
// rather than each screen inventing its own arbitrary heading size.

// Page title — 28–34px. The one true hero size; used sparingly.
export const proseHeadingClass =
  'font-serif text-[28px] sm:text-[34px] font-medium leading-tight tracking-tight text-foreground'

export const proseSubheadingClass =
  'font-serif text-xl sm:text-2xl font-medium leading-snug text-foreground'

// Reading surface — 18–20px, generous line height, full ink. The actual
// content: a published answer, a letter, a reply.
export const proseBodyClass =
  'font-serif text-[19px] sm:text-xl leading-relaxed text-foreground'

// A narrower, quieter measure for an excerpt/preview of someone's
// writing — comfortable reading width, secondary emphasis.
export const proseMutedClass =
  'font-serif max-w-[38ch] text-base leading-relaxed text-muted'

// Contextual Question — 17–20px, muted, deliberately smaller than
// proseBodyClass. The Question orients the reader; it must never
// outweigh the person's own writing sitting beneath it.
export const contextQuestionClass =
  'font-serif text-[17px] sm:text-lg leading-snug text-muted'

// Meaningful system/closure text — 15–16px, SANS. Locked platform rule:
// anything Tempa says (including reporting a member's own closure-
// reason choice back to them) is system voice, never letter prose —
// closure information must read as a distinct system statement, not as
// though the correspondence continued. Real reading size regardless
// (not helperTextClass's 13px, since this is meaningful content, not
// throwaway metadata) — the distinction from a letter is typography and
// surface, not smallness. This token used to be font-serif, which is
// exactly what made a closed-letter screen read like another letter;
// fixed as part of the system-vs-human-writing grammar checkpoint.
export const closureTextClass = 'text-[15px] sm:text-base leading-relaxed text-foreground/85'

// ============================================================
// SYSTEM VOICE — Tempa speaking directly to the member: onboarding,
// guides, permissions, settings, notices, filters, controls, empty
// states. Sans (Geist) throughout, tighter and more compact than the
// prose* family above — a member should be able to tell at a glance
// "this is Tempa talking" versus "this is someone's letter." Never use
// proseHeadingClass/proseBodyClass/contextQuestionClass/closureTextClass
// for system copy; never use these for correspondence content.
// ============================================================

// A quiet product signature shown when Tempa is explicitly introducing
// or explaining a feature (e.g. "⊕ Moments") — a small identity marker,
// never a giant logo.
export const systemMarkerClass =
  'inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent'

// A full system-voice screen's own heading (walkthrough step, permission
// prompt, orientation screen) — bold and compact. Deliberately smaller
// and tighter than proseHeadingClass's letter-scale hero size.
export const systemHeadingClass =
  'text-[22px] sm:text-2xl font-semibold leading-snug tracking-tight text-foreground'

// System body copy beneath a system heading — explanation/instruction
// text, tighter line-height and smaller than correspondence prose.
export const systemBodyClass = 'text-[15px] leading-relaxed text-foreground/85'

// Metadata / utility voice — dates, counts, state labels, filter
// labels, Moment indicators. Aliased to helperTextClass rather than
// redefined, so every metadata-tier call site shares one literal token
// even though some predate this name.
export const metadataTextClass = helperTextClass

export const dividerClass = 'border-foreground/10'

export const focusRingClass =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background'

// A compact icon-only control. Always pair with aria-label (and, on
// pointer-capable devices, the Tooltip primitive) — this class alone
// only styles hit area and hover/focus feedback, never labels the
// control.
export const iconButtonClass =
  `inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-foreground/[.06] hover:text-foreground ${focusRingClass}`

export const compactSecondaryButtonClass =
  'inline-flex items-center justify-center rounded-md border border-foreground/15 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]'

export const destructiveButtonClass =
  'inline-flex items-center justify-center rounded-md border border-red-600/30 px-4 py-2.5 text-[15px] font-medium text-red-700 transition-colors hover:bg-red-600/[.06]'

// Correspondence-row states (Letters). Every state pairs a background
// cue with a weight/typography cue elsewhere in the row — never color
// alone, so unread/selected remain legible without relying on hue.
export const rowHoverClass = 'hover:bg-foreground/[.03]'
export const rowSelectedClass = 'bg-accent/[.07]'
export const rowUnreadBgClass = 'bg-accent/[.045]'
