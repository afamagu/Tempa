import { redirect } from 'next/navigation'

// "Open Letters" is superseded by Dispatches/The Board — see the Build
// Guide's Dispatches section. This stub exists only so a stale
// development link never simply 404s; it carries no UI or copy of its
// own.
export default function LegacyOpenLettersRedirect() {
  redirect('/board')
}
