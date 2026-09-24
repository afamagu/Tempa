// Safety 2, Checkpoint 7 — human-readable labels for the Needs
// Attention workspace. Purely a DISPLAY layer: the underlying reason
// code is always preserved and shown alongside its label (see this
// checkpoint's own instruction), never replaced by it. Deliberately
// neutral, factual wording throughout — no "scammer"/"guilty"/"fraud"
// vocabulary anywhere, matching the calm, non-accusatory tone every
// other Safety-facing surface in this app already uses.

export const REASON_CODE_LABELS: Record<string, string> = {
  DIRECT_MONEY_REQUEST: 'Money request',
  LOAN_OR_BILL_REQUEST: 'Loan/bill request',
  PAYMENT_DETAILS: 'Payment details shared',
  CRYPTO_SOLICITATION: 'Crypto solicitation',
  INVESTMENT_SOLICITATION: 'Investment pitch',
  GIFT_CARD_REQUEST: 'Gift card request',
  EMERGENCY_MONEY_REQUEST: 'Emergency money request',
  MONEY_INTERMEDIARY_REQUEST: 'Asked to receive/forward money',
  PERSONAL_CONTACT_SHARING: 'Shared personal contact details',
  OFF_PLATFORM_ESCALATION: 'Off-platform contact',
  SUSPICIOUS_LINK: 'Suspicious link',
  PHISHING_SIGNAL: 'Phishing pattern',
  IMAGE_TEXT_FINANCIAL_SIGNAL: 'Financial signal (image)',
  IMAGE_TEXT_PAYMENT_DETAILS: 'Payment details (image)',
  MASS_FIRST_CONTACT: 'High first-contact volume',
  NEAR_DUPLICATE_OUTREACH: 'Repeated identical outreach',
  HIGH_CONTACT_VELOCITY: 'High contact velocity',
  REPEATED_SOLICITATION: 'Repeated solicitation pattern',
  REPORT_SPIKE: 'Report spike',
  BLOCK_SPIKE: 'Block spike',
  ACCOUNT_VELOCITY: 'New-account velocity',
}

export function reasonCodeLabel(code: string): string {
  return REASON_CODE_LABELS[code] ?? code
}

export const CASE_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  reviewing: 'Reviewing',
  no_action: 'No action',
  resolved: 'Resolved',
  // Checkpoint 8 — the three reachable graduated-intervention outcomes,
  // plus the structurally-valid-but-unreachable 'warned' (kept only so
  // an existing historical row, if one ever appears, still renders a
  // real label instead of a raw enum value).
  restricted: 'Restricted',
  suspended: 'Suspended',
  banned: 'Banned',
  warned: 'Warned',
}

export function caseStatusLabel(status: string): string {
  return CASE_STATUS_LABELS[status] ?? status
}

// Muted, non-alarmist styling — deliberately no red/alarm color for any
// band, matching "avoid red-alert theatrics" / "do not make risk band
// look like a criminal verdict." Every band uses the same neutral
// palette the rest of /admin already uses for informational text.
export const RISK_BAND_LABELS: Record<string, string> = {
  none: 'None',
  weak: 'Weak',
  meaningful: 'Meaningful',
  high: 'High',
  severe: 'Severe',
}

export function riskBandLabel(band: string): string {
  return RISK_BAND_LABELS[band] ?? band
}

export const SURFACE_LABELS: Record<string, string> = {
  first_letter: 'First letter',
  reply: 'Letter reply',
  write_anytime: 'Letter',
  dispatch_publish: 'Dispatch',
  dispatch_update: 'Dispatch edit',
  question_answer: 'Question answer',
  dispatch_reply: 'Dispatch reply',
  behavior_mass_first_contact: 'Behavior: first-contact volume',
  behavior_near_duplicate_outreach: 'Behavior: repeated outreach',
  behavior_high_contact_velocity: 'Behavior: contact velocity',
  behavior_repeated_solicitation: 'Behavior: repeated solicitation',
  behavior_report_spike: 'Behavior: report spike',
  behavior_block_spike: 'Behavior: block spike',
  behavior_account_velocity: 'Behavior: account velocity',
}

export function surfaceLabel(surface: string): string {
  return SURFACE_LABELS[surface] ?? surface
}
