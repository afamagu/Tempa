/**
 * Premium Announcement Publishing checkpoint. Codebase-conventions
 * audit performed first: letters/dispatches store plain `text` with a
 * hand-rolled bold/italic markup encoding specifically to avoid ever
 * rendering arbitrary rich content (see lib/letter-editor-doc.ts's own
 * header comment) — but that scheme has no representation for
 * headings, bullet lists, or links, all of which Announcements
 * explicitly require. Per this checkpoint's own instruction ("a
 * TipTap-style structured JSON document model is acceptable if no
 * existing solution is present"), this is a CLOSED, hand-typed JSON
 * shape — never arbitrary HTML — mirroring lib/letter-editor-doc.ts's
 * own `LetterDocJSON` pattern exactly, restricted to precisely the
 * TipTap extensions the Announcement editor configures (Document,
 * Paragraph, Text, HardBreak, History, Bold, Italic, Heading(level 2
 * only — "restrained subheadings"), BulletList, ListItem, Link).
 *
 * The read side (app/announcement-body.tsx) builds React elements
 * directly from this closed type — never dangerouslySetInnerHTML — so
 * there is no HTML-injection surface even from a malformed document.
 * `announcements.body` remains a derived plain-text fallback, computed
 * HERE, client-side, before every write (docToPlainText) — the server
 * never needs to parse or trust the rich structure to keep it in sync,
 * matching how docToPlainBody already works for letters.
 */

export type AnnouncementMarkJSON = { type: 'bold' } | { type: 'italic' } | { type: 'link'; attrs: { href: string } }
export type AnnouncementTextNodeJSON = { type: 'text'; text: string; marks?: AnnouncementMarkJSON[] }
export type AnnouncementHardBreakNodeJSON = { type: 'hardBreak' }
export type AnnouncementInlineNodeJSON = AnnouncementTextNodeJSON | AnnouncementHardBreakNodeJSON

export type AnnouncementParagraphNodeJSON = { type: 'paragraph'; content?: AnnouncementInlineNodeJSON[] }
export type AnnouncementHeadingNodeJSON = {
  type: 'heading'
  attrs: { level: 2 }
  content?: AnnouncementInlineNodeJSON[]
}
export type AnnouncementListItemNodeJSON = { type: 'listItem'; content?: AnnouncementParagraphNodeJSON[] }
export type AnnouncementBulletListNodeJSON = { type: 'bulletList'; content?: AnnouncementListItemNodeJSON[] }

export type AnnouncementBlockNodeJSON =
  | AnnouncementParagraphNodeJSON
  | AnnouncementHeadingNodeJSON
  | AnnouncementBulletListNodeJSON

export type AnnouncementDocJSON = { type: 'doc'; content?: AnnouncementBlockNodeJSON[] }

export const EMPTY_ANNOUNCEMENT_DOC: AnnouncementDocJSON = { type: 'doc', content: [{ type: 'paragraph' }] }

function inlineText(node: AnnouncementInlineNodeJSON): string {
  if (node.type === 'hardBreak') return '\n'
  return node.text
}

/** Pure: every doc → plain-text derivation Announcements need goes
 * through this — the `body` column fallback, and the "is this doc
 * actually empty" check below. Paragraphs/headings are joined by a
 * blank line; a bullet list's items are joined by single newlines with
 * a leading "- ". Never throws on a malformed/partial doc — missing
 * `content` arrays are simply treated as empty. */
export function docToPlainText(doc: AnnouncementDocJSON): string {
  const blocks = doc.content ?? []
  return blocks
    .map((block) => {
      if (block.type === 'bulletList') {
        return (block.content ?? [])
          .map((item) => {
            const text = (item.content ?? [])
              .map((p) => (p.content ?? []).map(inlineText).join(''))
              .join('\n')
            return `- ${text}`
          })
          .join('\n')
      }
      return (block.content ?? []).map(inlineText).join('')
    })
    .join('\n\n')
    .trim()
}

/** Pure: whether a document has any real content at all — used to
 * decide whether the "Save Draft"/"Publish" controls should be enabled,
 * mirroring lib/letter-editor-doc.ts's letterDocHasContent. */
export function announcementDocHasContent(doc: AnnouncementDocJSON | null | undefined): boolean {
  if (!doc) return false
  return docToPlainText(doc).length > 0
}
