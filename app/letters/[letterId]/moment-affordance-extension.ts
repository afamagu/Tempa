import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Pure: whether a previously-computed DecorationSet can be returned
 * AS-IS (same object reference) rather than rebuilt. Decorations here
 * are a function purely of (document identity, which paragraph is
 * "active") — nothing about WHERE inside the active paragraph the
 * caret sits changes which widgets render or their tier. `doc` is a
 * ProseMirror persistent/immutable structure: reference-equal doc
 * means every position in it is provably unchanged, so caching on the
 * (doc, activeIndex) pair is exact, never approximate. Split out as
 * its own function specifically so this decision is unit-testable
 * without mounting a live ProseMirror EditorView.
 */
export function canReuseMomentDecorations(
  previous: { doc: unknown; activeIndex: number } | null,
  doc: unknown,
  activeIndex: number
): boolean {
  return previous !== null && previous.doc === doc && previous.activeIndex === activeIndex
}

export type MomentAffordanceOptions = {
  /** False while photo attachment isn't currently allowed at all (see
   * canSendPhoto in moments-composer.tsx) — the affordance simply never
   * renders rather than opening onto a dead end. */
  enabled: boolean
  onRequestPhoto: (paragraphIndex: number) => void
}

/**
 * Draws the quiet `⊕` after every paragraph the writer has already
 * finished (i.e. followed by a further paragraph — never the one still
 * being typed), as a ProseMirror WIDGET DECORATION: a purely visual
 * annotation, not part of the document/content at all. That's what
 * makes it safe to "ignore" — there is nothing to escape or dismiss,
 * because it was never real content the writer could accidentally type
 * over or that could end up in `p_body`.
 *
 * Visual restraint: the paragraph immediately before the one currently
 * being written gets a normal-weight `⊕`; every earlier finished
 * paragraph gets a visually subdued one. Both are real, always-present
 * DOM buttons (never a hover-reveal), so touch users have the exact
 * same access as a mouse user — restraint here is about opacity/weight,
 * never about hiding the control until hover.
 */
export const MomentAffordancePluginKey = new PluginKey('momentAffordance')

const RECENT_CLASSNAME =
  'inline-flex h-5 w-5 items-center justify-center rounded-full border border-foreground/25 align-middle text-[13px] text-foreground/70 mx-1'
const SUBDUED_CLASSNAME =
  'inline-flex h-5 w-5 items-center justify-center rounded-full border border-foreground/10 align-middle text-[13px] text-foreground/25 mx-1'

export const MomentAffordance = Extension.create<MomentAffordanceOptions>({
  name: 'momentAffordance',

  addOptions() {
    return {
      enabled: false,
      onRequestPhoto: () => {},
    }
  },

  addProseMirrorPlugins() {
    const extensionOptions = this.options

    // Keyed by the paragraph's own ProseMirror NODE OBJECT, not its
    // position/index — ProseMirror preserves node identity for any
    // subtree a transaction didn't actually touch, so a paragraph the
    // writer isn't currently editing keeps the exact same node
    // reference across a purely selection-driven update (e.g. the two
    // clicks of a double-click, or moving the cursor between
    // paragraphs). Reusing the cached element for that reference is
    // what lets ProseMirror's own decoration diffing recognize the
    // widget as UNCHANGED and skip touching its DOM at all.
    //
    // Recreating a brand-new `document.createElement('button')` on
    // every call — which is what this used to do, since `decorations`
    // depends on `state.selection` and therefore re-runs on every
    // transaction, not only document edits — meant every click (and
    // every keystroke) replaced every finished-paragraph widget's DOM
    // node. That churn, landing between the two clicks of a
    // double-click, is exactly what defeats a browser's native
    // double-click-to-select-word detection: the element under the
    // cursor is no longer the same element by the time the second
    // click lands. A WeakMap here (not plugin state) is correct and
    // sufficient — it's scoped to this one plugin instance, needs no
    // explicit cleanup, and naturally drops an entry once its
    // paragraph node is no longer reachable from any state.
    const widgetCache = new WeakMap<
      ProseMirrorNode,
      { tier: 'recent' | 'subdued'; element: HTMLButtonElement }
    >()

    // The other half of the double-click fix: even with cached widget
    // ELEMENTS, this plugin was still rebuilding an entirely NEW
    // DecorationSet on every transaction (decorations() depends on
    // state.selection, so it re-runs on every caret move too) —
    // handing ProseMirror's view a fresh object graph to diff on every
    // click, not only every keystroke. See canReuseMomentDecorations'
    // own doc comment for why (doc, activeIndex) is an exact cache key
    // here: returning the literal SAME DecorationSet instance is what
    // lets the view skip decoration diffing entirely for a selection-
    // only transaction that stays within one paragraph — exactly the
    // two clicks of a double-click landing inside already-finished
    // writing.
    let lastComputed: { doc: ProseMirrorNode; activeIndex: number; decorationSet: DecorationSet } | null = null

    return [
      new Plugin({
        key: MomentAffordancePluginKey,
        props: {
          decorations(state) {
            if (!extensionOptions.enabled) return DecorationSet.empty

            const { doc, selection } = state
            const activeIndex = doc.resolve(selection.from).index(0)

            if (canReuseMomentDecorations(lastComputed, doc, activeIndex)) {
              return lastComputed!.decorationSet
            }

            const decorations: Decoration[] = []

            let index = 0
            doc.forEach((node, offset) => {
              if (node.type.name !== 'paragraph') return
              const thisIndex = index
              index += 1

              if (thisIndex >= activeIndex) return // not finished yet

              let hasPhoto = false
              node.forEach((child) => {
                if (child.type.name === 'photoMoment') hasPhoto = true
              })
              if (hasPhoto) return

              const pos = offset + node.nodeSize - 1
              const distance = activeIndex - thisIndex
              const tier: 'recent' | 'subdued' = distance === 1 ? 'recent' : 'subdued'

              const cached = widgetCache.get(node)
              let element: HTMLButtonElement

              if (cached && cached.tier === tier) {
                element = cached.element
              } else {
                element = document.createElement('button')
                element.type = 'button'
                element.textContent = '⊕'
                element.setAttribute('aria-label', 'Add a photo to this paragraph')
                element.className = tier === 'recent' ? RECENT_CLASSNAME : SUBDUED_CLASSNAME
                // A single, stable listener attached once at creation —
                // it reads the paragraph's CURRENT index from the
                // element's own dataset (refreshed below on every pass)
                // rather than closing over `thisIndex` directly, since
                // this same element/listener can go on to represent a
                // paragraph whose index later shifts (an earlier
                // paragraph inserted/removed above it) while its own
                // node reference — and therefore this cache entry —
                // stays the same.
                element.addEventListener('click', (event) => {
                  event.preventDefault()
                  extensionOptions.onRequestPhoto(Number(element.dataset.paragraphIndex))
                })
                widgetCache.set(node, { tier, element })
              }

              element.dataset.paragraphIndex = String(thisIndex)
              decorations.push(Decoration.widget(pos, element, { side: 1 }))
            })

            const decorationSet = DecorationSet.create(doc, decorations)
            lastComputed = { doc, activeIndex, decorationSet }
            return decorationSet
          },
        },
      }),
    ]
  },
})
