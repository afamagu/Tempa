// Tempa Safety Pattern Library — PERSONAL CONTACT / OFF-PLATFORM sharing.
//
// This is deliberately a DIFFERENT policy from financial solicitation.
// Sharing a phone number, an email address, a home address, or an
// invitation to continue on WhatsApp/Telegram/Instagram is NOT a rule
// violation and never a strike: plenty of genuine pen pals eventually
// choose to do it. The point of detecting it is a private-letter
// PRIVACY REMINDER — the sender gets a gentle heads-up before sending
// (they can still send), and the recipient sees a short, non-
// accusatory note attached to the delivered letter before deciding what
// they want to share. It may also serve as one weak, supplementary
// signal alongside genuinely suspicious behavior, but it never counts
// toward the financial-solicitation restriction on its own.
//
// Conservative by design: a passing mention ("I don't really like
// WhatsApp.") never fires; physical addresses need both a street-
// address shape AND an explicit "this is where I live / send it here"
// cue, so "I walked down 42 Baker Street yesterday" stays silent.

import { toDisplayText, toCanonicalText } from '../normalize'

export type ContactKind = 'phone' | 'email' | 'handle_or_platform' | 'address' | 'contact_request'

export type ContactFindings = { kinds: ContactKind[] }

const EMAIL = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i
/** "name at gmail dot com" written out to dodge filters. */
const EMAIL_SPELLED = /\b[a-z0-9._-]{3,}\s*(?:\(at\)|\[at\]|\bat\b)\s*[a-z0-9-]{3,}\s*(?:\(dot\)|\[dot\]|\bdot\b)\s*(?:com|net|org|co|io|uk|edu)\b/i

const PHONE_CANDIDATE = /(?:\+\d[\d\s().-]{7,}\d|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b0\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b|\b\d{10,13}\b)/
const PHONE_CONTEXT = /\b(?:phone|number|mobile|cell|call|text|whatsapp|telegram|signal|viber|reach me|contact)\b/i

const PLATFORMS =
  '(?:whats ?app|whatsap|telegram|signal|instagram|insta|snap ?chat|snap|facebook|messenger|kik|we ?chat|viber|discord|skype|tiktok|line app|imo|google hangouts|hangouts|gmail|email|e-mail|text|sms|dm|dms|phone)'

const INVITE_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:message|msg|text|write|contact|reach|add|find|follow|dm|ping|chat with|talk to|hit)\s+(?:me|us)\s+(?:on|at|via|through|in)\s+${PLATFORMS}\b`, 'i'),
  new RegExp(String.raw`\b(?:add|find|follow)\s+me\b.{0,15}\b${PLATFORMS}\b`, 'i'),
  new RegExp(String.raw`\b(?:let'?s|lets|we (?:can|could|should)|shall we|why don'?t we|can we|could we|i(?:'d| would) love to|i want to|i(?:'d| would) prefer to)\s+(?:move|switch|continue|talk|chat|write|keep (?:talking|chatting|writing)|take (?:this|it))\b.{0,25}\b(?:to|on|over|via|through|elsewhere|off)\b.{0,20}(?:${PLATFORMS}|elsewhere|off tempa|off this site|off the site|outside)`, 'i'),
  new RegExp(String.raw`\bmy\s+(?:${PLATFORMS}|handle|username|user name|id|number|phone number|email|e-mail|contact)\s+(?:is|:)`, 'i'),
  new RegExp(String.raw`\b(?:email|e-mail|whatsapp|call|text|phone|message)\s+me\s+(?:at|on)\b`, 'i'),
  new RegExp(String.raw`\bi(?:'m| am)\s+(?:on|@)\s+${PLATFORMS}\b.{0,20}\b(?:as|@|username|handle)\b`, 'i'),
]

const REQUEST_PATTERNS: RegExp[] = [
  /\b(?:send|give|share|tell|text|dm|drop|pass)\s+me\s+your\s+(?:(?:phone|mobile|cell|whatsapp|telegram|contact|personal|private|email|e-mail|home|street|mailing|postal)\s+)*(?:number|email|e-mail|address|contact|details|handle|username|id)\b/i,
  /\b(?:what(?:'s| is)|can i (?:have|get)|could i (?:have|get)|may i (?:have|get)|do you have)\s+(?:your|a)\s+(?:(?:phone|mobile|cell|whatsapp|telegram|contact|personal|private|email|e-mail|home|street|mailing|postal)\s+)*(?:number|email|e-mail|address|whatsapp|telegram|instagram|snapchat|contact)\b/i,
  /\b(?:i(?:'d| would) (?:love|like) (?:to (?:have|get)|your))\s+(?:your\s+)?(?:phone )?(?:number|email|address)\b/i,
  /\b(?:what(?:'s| is)) your (?:whats ?app|telegram|instagram|snap ?chat|insta)\b/i,
]

const ADDRESS_SHAPE =
  /\b\d{1,5}[a-z]?\s+(?:[a-z0-9.'-]+\s+){1,4}(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|court|ct|way|place|pl|close|crescent|terrace|square|highway|hwy)\b\.?/i
const ADDRESS_CUE =
  /\b(?:my|our|home|mailing|postal|street|residential)\s+address\b|\bi live (?:at|on)\b|\bwe live (?:at|on)\b|\bsend (?:it|mail|letters?|post|me (?:a )?(?:letter|parcel|package|gift)) to\b|\bcome (?:to|and see me at|visit me at)\b|\bfind me at\b|\bstaying at\b|\bmy (?:flat|apartment|house|home) is (?:at|on)\b|\bpostal code\b|\bzip ?code\b/i

export function detectContactSharing(rawText: string): ContactFindings {
  const display = toDisplayText(rawText)
  const canonical = toCanonicalText(rawText)
  const kinds = new Set<ContactKind>()

  if (EMAIL.test(display) || EMAIL_SPELLED.test(display)) kinds.add('email')

  const phone = PHONE_CANDIDATE.exec(display)
  if (phone) {
    const digits = phone[0].replace(/\D/g, '').length
    const before = display.slice(Math.max(0, phone.index - 40), phone.index)
    if (digits >= 8 && (phone[0].startsWith('+') || PHONE_CONTEXT.test(before) || /[\s().-]/.test(phone[0].trim()))) {
      kinds.add('phone')
    }
  }

  if (INVITE_PATTERNS.some((p) => p.test(display) || p.test(canonical))) kinds.add('handle_or_platform')
  if (REQUEST_PATTERNS.some((p) => p.test(display))) kinds.add('contact_request')

  if (ADDRESS_SHAPE.test(display) && ADDRESS_CUE.test(display)) kinds.add('address')

  return { kinds: Array.from(kinds) }
}
