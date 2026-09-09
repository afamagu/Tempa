import { redirect } from 'next/navigation'

// See app/minds/open-letters/page.tsx's own comment.
export default function LegacyOpenLettersWriteRedirect() {
  redirect('/board/write')
}
