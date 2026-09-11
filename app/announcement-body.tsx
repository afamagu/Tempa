import type {
  AnnouncementDocJSON,
  AnnouncementInlineNodeJSON,
  AnnouncementBlockNodeJSON,
} from '@/lib/announcement-editor-doc'
import { isAnnouncementHrefSafe } from '@/lib/announcement-link-safety'

/**
 * The read-only renderer for a structured Announcement body — builds
 * React elements directly from the closed AnnouncementDocJSON type,
 * exactly like app/letters/formatted-text.tsx does for letters. NEVER
 * dangerouslySetInnerHTML: every node/mark type is matched explicitly
 * against a hardcoded React element, so there is no HTML-injection
 * surface even from a malformed or adversarial document — TEMPA owns
 * the typography, this component owns the rendering.
 *
 * Final Correction round, item 6 — DEFENSIVE, not merely trusting the
 * database validator (public.announcement_content_is_valid) to have
 * already rejected anything malformed: an unrecognized block type is
 * never coerced into a paragraph, and a link mark is never rendered
 * as a clickable anchor unless its href independently passes
 * isAnnouncementHrefSafe (the same policy the database and the editor
 * enforce — lib/announcement-link-safety.ts) — persisted data is
 * treated as untrusted here regardless of what should have already
 * been guaranteed upstream.
 */

function renderMarks(node: Extract<AnnouncementInlineNodeJSON, { type: 'text' }>, key: number) {
  let content: React.ReactNode = node.text
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') content = <strong>{content}</strong>
    else if (mark.type === 'italic') content = <em>{content}</em>
    else if (mark.type === 'link') {
      // Defensive re-check — an unsafe href is never rendered as a
      // clickable anchor, even though the database should already
      // guarantee this never happens. The text itself still renders,
      // just unlinked.
      if (isAnnouncementHrefSafe(mark.attrs.href)) {
        content = (
          <a
            href={mark.attrs.href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-current underline-offset-2"
          >
            {content}
          </a>
        )
      }
    }
    // Any other mark type is unrecognized and intentionally ignored —
    // content stays as plain text, never wrapped in anything unsafe.
  }
  return <span key={key}>{content}</span>
}

function renderInline(nodes: AnnouncementInlineNodeJSON[] | undefined) {
  return (nodes ?? []).map((node, i) => (node.type === 'hardBreak' ? <br key={i} /> : renderMarks(node, i)))
}

function renderBlock(block: AnnouncementBlockNodeJSON, key: number) {
  if (block.type === 'heading') {
    return (
      <h3 key={key} className="mt-4 font-serif text-lg font-medium text-foreground first:mt-0">
        {renderInline(block.content)}
      </h3>
    )
  }
  if (block.type === 'bulletList') {
    return (
      <ul key={key} className="mt-2 list-disc space-y-1 pl-5 first:mt-0">
        {(block.content ?? []).map((item, i) => (
          <li key={i} className="font-serif text-[15px] leading-relaxed text-foreground">
            {(item.content ?? []).map((p, j) => (
              <span key={j}>{renderInline(p.content)}</span>
            ))}
          </li>
        ))}
      </ul>
    )
  }
  if (block.type === 'paragraph') {
    return (
      <p key={key} className="mt-3 font-serif text-[15px] leading-relaxed text-foreground first:mt-0">
        {renderInline(block.content)}
      </p>
    )
  }
  // Defensive fallback (item 6): an unrecognized block type is never
  // blindly coerced into a paragraph — it renders nothing. The
  // database validator should make this unreachable in practice; this
  // is the last line of defense if it somehow isn't.
  return null
}

export default function AnnouncementBody({ doc }: { doc: AnnouncementDocJSON | null }) {
  if (!doc || !doc.content || doc.content.length === 0) return null
  return <div>{doc.content.map((block, i) => renderBlock(block, i))}</div>
}
