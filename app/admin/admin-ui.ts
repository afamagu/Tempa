// Admin Operations Refinement checkpoint — a dedicated admin-only type
// scale. /admin previously borrowed app/profile/ui.tsx's member-facing
// tokens (sectionTitleClass, helperTextClass, secondaryButtonClass,
// etc.), which is why its interface text ended up as small as the
// member reading surface's own metadata tier (11-13px) even for primary
// operational text. This file is intentionally SEPARATE from
// app/profile/ui.tsx — admin's type scale can move independently of the
// member-facing app, and this checkpoint must not touch member-facing
// typography at all. Member-facing tokens (sectionTitleClass,
// secondaryButtonClass, helperTextClass, etc.) are still imported
// directly from app/profile/ui.tsx where their existing size already
// meets the admin target (e.g. sectionTitleClass's 18/20px heading) —
// this file only adds what's undersized for an operational console.
//
// Target scale (Admin Operations Refinement):
//   primary body/interface text     ~16px  → adminBodyClass
//   table/list operational text     15-16px primary, 14px secondary
//   metadata/supporting text        14px floor (never casually below)
//   navigation                      15-16px, comfortable tap targets
//   headings                        larger than body — sectionTitleClass
//                                   (app/profile/ui.tsx, 18/20px) already
//                                   satisfies this once body moves to 16px

export const adminBodyClass = 'text-[16px] leading-relaxed text-foreground'

export const adminTableTextClass = 'text-[15px] text-foreground'

export const adminTableSecondaryClass = 'text-[14px] text-foreground/70'

export const adminMetadataClass = 'text-[14px] text-muted'

export const adminNavLinkClass = 'text-[15px] font-medium'

export const adminBadgeClass =
  'rounded-full bg-accent/10 px-2.5 py-1 text-[13px] font-medium text-accent'
