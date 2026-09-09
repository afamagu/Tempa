// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'

type JSONNode = { type: string; text?: string; content?: JSONNode[]; marks?: { type: string }[] }

function collectNodeTypes(node: JSONNode, into: Set<string>) {
  into.add(node.type)
  for (const child of node.content ?? []) collectNodeTypes(child, into)
}

function collectMarkTypes(node: JSONNode, into: string[]) {
  for (const mark of node.marks ?? []) into.push(mark.type)
  for (const child of node.content ?? []) collectMarkTypes(child, into)
}

/**
 * The composer's actual schema — Document/Paragraph/Text/HardBreak only,
 * no PhotoMoment needed here since paste-normalization is about text
 * formatting, not the photo node. Building content via `setContent(html)`
 * exercises the exact same DOMParser-against-schema mechanism a real
 * paste event goes through (ProseMirror's own paste handling is that
 * same parse step, just triggered by a clipboard event instead of a
 * direct call) — this is a faithful test of the actual guarantee, not a
 * simulation of clipboard event plumbing jsdom can't reliably provide.
 */
function createHeadlessLetterEditor() {
  return new Editor({
    extensions: [Document, Paragraph, Text, HardBreak],
  })
}

describe('pasted rich content normalizes to Tempa plain paragraph structure', () => {
  it('has no bold/italic/heading/list node or mark types in its schema at all', () => {
    const editor = createHeadlessLetterEditor()
    expect(editor.schema.marks.bold).toBeUndefined()
    expect(editor.schema.marks.italic).toBeUndefined()
    expect(editor.schema.nodes.heading).toBeUndefined()
    expect(editor.schema.nodes.bulletList).toBeUndefined()
    editor.destroy()
  })

  it('drops headings, bold/italic marks, and lists when rich HTML is set as content', () => {
    const editor = createHeadlessLetterEditor()

    editor.commands.setContent(
      '<h1>A Big Heading</h1>' +
        '<p>Some <b>bold</b> and <i>italic</i> text.</p>' +
        '<ul><li>one</li><li>two</li></ul>'
    )

    const json = editor.getJSON() as JSONNode

    const nodeTypes = new Set<string>()
    collectNodeTypes(json, nodeTypes)
    // Only what this schema actually defines can appear — no heading,
    // no list, no list item, because none of those node types exist to
    // parse into.
    expect(nodeTypes).toEqual(new Set(['doc', 'paragraph', 'text']))

    const markTypes: string[] = []
    collectMarkTypes(json, markTypes)
    expect(markTypes).toEqual([])

    editor.destroy()
  })

  it('preserves the actual words even once their formatting is stripped', () => {
    const editor = createHeadlessLetterEditor()
    editor.commands.setContent('<h2>Dear friend</h2><p>I have <strong>so much</strong> to tell you.</p>')

    const text = editor.getText()
    expect(text).toContain('Dear friend')
    expect(text).toContain('I have so much to tell you.')

    editor.destroy()
  })
})
