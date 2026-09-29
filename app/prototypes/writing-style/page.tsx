import { notFound } from 'next/navigation'
import WritingStyleSpecimen from './specimen'

// Development-only typography lab for the Writing Style system — never a
// production feature. Not linked anywhere, not auth-gated, touches no
// data; 404s outside `next dev`.
export default function WritingStyleSpecimenPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <WritingStyleSpecimen />
}
