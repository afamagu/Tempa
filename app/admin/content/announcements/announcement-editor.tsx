'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Heading from '@tiptap/extension-heading'
import BulletList from '@tiptap/extension-bullet-list'
import ListItem from '@tiptap/extension-list-item'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { iconButtonClass } from '@/app/profile/ui'
import type { AnnouncementDocJSON } from '@/lib/announcement-editor-doc'
import { EMPTY_ANNOUNCEMENT_DOC } from '@/lib/announcement-editor-doc'
import { isAnnouncementHrefSafe } from '@/lib/announcement-link-safety'

/**
 * TEMPA's constrained Announcement rich-text editor. Deliberately a
 * SMALL, closed set of TipTap extensions — paragraphs, one restrained
 * heading level, bullet lists, bold/italic, links. No font picker, no
 * arbitrary sizes/colors/alignment, no raw HTML editing: TEMPA owns
 * the typography, the Admin controls only semantic structure (Section
 * B1). Mirrors app/letters/writing-toolbar.tsx's exact chained-command
 * pattern (`editor.chain().focus()....run()`), which preserves the
 * current selection across a toolbar click.
 */
function toggleButtonClass(active: boolean) {
  return `${iconButtonClass} ${active ? 'bg-foreground/[.08] text-foreground' : ''}`
}

export default function AnnouncementEditor({
  content,
  onChange,
}: {
  content: AnnouncementDocJSON
  onChange: (doc: AnnouncementDocJSON) => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      History,
      Bold,
      Italic,
      Heading.configure({ levels: [2] }),
      BulletList,
      ListItem,
      // Final Correction round, item 2B: TipTap's own default protocol
      // allowlist (http/https/ftp/ftps/mailto/tel/callto/sms/cid/xmpp,
      // plus any bare host with no scheme at all) is deliberately
      // overridden — isAllowedUri replaces it entirely with TEMPA's own
      // narrower policy (lib/announcement-link-safety.ts): absolute
      // https:// or an internal /relative URL, nothing else. This is
      // the editor-side layer only; the database (announcement_href_
      // is_safe) is the real enforcement boundary, and the renderer
      // checks again defensively.
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: [],
        isAllowedUri: (url) => isAnnouncementHrefSafe(url),
      }),
      Placeholder.configure({ placeholder: 'Write the announcement…' }),
    ],
    content: content ?? EMPTY_ANNOUNCEMENT_DOC,
    editorProps: {
      attributes: {
        class:
          'min-h-40 w-full rounded-md border border-foreground/15 bg-transparent px-4 py-3 font-serif text-[15px] leading-relaxed outline-none transition-colors focus:border-accent [&_p]:my-0 [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-medium',
      },
    },
    onUpdate({ editor: current }) {
      onChange(current.getJSON() as AnnouncementDocJSON)
    },
  })

  function setLink() {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href as string | undefined
    // A plain prompt, deliberately — this is the one control that
    // needs a URL from the admin, and a full modal would be more
    // machinery than a single-field input warrants here (Section B6:
    // "do not create decorative complexity for its own sake").
    const url = window.prompt('Link URL', previousUrl ?? 'https://')
    if (url === null) return
    const trimmed = url.trim()
    if (trimmed === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    if (!isAnnouncementHrefSafe(trimmed)) {
      window.alert('Links must be a full https:// address, or an internal link starting with /.')
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 border-b border-foreground/10 pb-2">
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleBold().run()}
          disabled={!editor}
          aria-label="Bold"
          aria-pressed={editor?.isActive('bold') ?? false}
          className={toggleButtonClass(editor?.isActive('bold') ?? false)}
        >
          B
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          disabled={!editor}
          aria-label="Italic"
          aria-pressed={editor?.isActive('italic') ?? false}
          className={toggleButtonClass(editor?.isActive('italic') ?? false)}
        >
          <span className="italic">I</span>
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          disabled={!editor}
          aria-label="Heading"
          aria-pressed={editor?.isActive('heading', { level: 2 }) ?? false}
          className={toggleButtonClass(editor?.isActive('heading', { level: 2 }) ?? false)}
        >
          H
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          disabled={!editor}
          aria-label="Bullet list"
          aria-pressed={editor?.isActive('bulletList') ?? false}
          className={toggleButtonClass(editor?.isActive('bulletList') ?? false)}
        >
          •—
        </button>
        <button
          type="button"
          onClick={setLink}
          disabled={!editor}
          aria-label="Link"
          aria-pressed={editor?.isActive('link') ?? false}
          className={toggleButtonClass(editor?.isActive('link') ?? false)}
        >
          🔗
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
