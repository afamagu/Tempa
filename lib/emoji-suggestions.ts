import type { EditorState } from '@tiptap/pm/state'

export const EMOJI_SUGGESTIONS: Record<string, readonly { emoji: string; name: string }[]> = {
  lol: [{ emoji: '😂', name: 'Face with tears of joy' }, { emoji: '🤣', name: 'Rolling on the floor laughing' }, { emoji: '😄', name: 'Grinning face' }],
  haha: [{ emoji: '😂', name: 'Face with tears of joy' }, { emoji: '😆', name: 'Laughing face' }],
  happy: [{ emoji: '😊', name: 'Smiling face' }, { emoji: '😄', name: 'Grinning face' }],
  smile: [{ emoji: '🙂', name: 'Slightly smiling face' }, { emoji: '😊', name: 'Smiling face' }],
  love: [{ emoji: '❤️', name: 'Red heart' }, { emoji: '🥰', name: 'Smiling face with hearts' }],
  thanks: [{ emoji: '🙏', name: 'Folded hands' }, { emoji: '😊', name: 'Smiling face' }],
  sad: [{ emoji: '😔', name: 'Pensive face' }, { emoji: '😢', name: 'Crying face' }],
  wow: [{ emoji: '😮', name: 'Surprised face' }, { emoji: '🤩', name: 'Star-struck face' }],
}

/** Only the whole word immediately behind an empty text selection. */
export function emojiSuggestionAt(state: EditorState) {
  const { $from, empty } = state.selection
  if (!empty || !$from.parent.isTextblock) return null
  const offset = $from.parentOffset
  const start = Math.max(0, offset - 32)
  const before = $from.parent.textBetween(start, offset, '\n', '\ufffc')
  const after = $from.parent.textBetween(offset, Math.min(offset + 1, $from.parent.content.size), '\n', '\ufffc')
  if (/\p{L}|\p{N}|_/u.test(after)) return null
  const match = /(?:^|[\s([{])((?:lol|haha|happy|smile|love|thanks|sad|wow))([.!?,]?\s?)$/i.exec(before)
  if (!match) return null
  const word = match[1]
  const to = $from.pos - match[2].length
  return { word, from: to - word.length, to, choices: EMOJI_SUGGESTIONS[word.toLowerCase()] }
}
