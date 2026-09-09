import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import type { AnyExtension } from '@tiptap/core'

/**
 * The one shared schema every letter composer builds on — first
 * contact (app/write/[recipientId]/first-letter-composer.tsx), the
 * first-contact reply (app/letters/[letterId]/first-contact-
 * response.tsx), and the ongoing Write Anytime composer (app/letters/
 * [letterId]/moments-composer.tsx) all use this SAME base rather than
 * three separate hand-rolled editors, so Bold/Italic/toolbar behavior
 * can never quietly drift between them. Deliberately minimal: no
 * heading/list/link/color/font mark or node exists here, so nothing
 * beyond bold/italic text and paragraphs can ever enter a letter
 * regardless of what a member pastes — ProseMirror simply has nowhere
 * to put anything else (see lib/letter-editor-doc.ts's own comment on
 * why storage stays plain text rather than HTML).
 *
 * Moments (PhotoMoment + MomentAffordance) are NOT part of this base —
 * only the Write Anytime composer adds those on top, since Letter 1
 * and Letter 2 stay text-only by product rule (see docs/tempa-build-
 * guide.md §10/§21) regardless of editor technology. Each composer
 * still adds its own Placeholder.configure({ placeholder: '…' }) on
 * top, since the prompt text differs per surface.
 */
export function baseWritingExtensions(): AnyExtension[] {
  return [Document, Paragraph, Text, HardBreak, History, Bold, Italic]
}
