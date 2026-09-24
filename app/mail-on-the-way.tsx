import Image from 'next/image'

// Brand asset pass (2026-09-24) — replaces the plain stroke-icon
// MailInTransitIcon + SystemMessage(variant="quiet") presentation with
// the approved travelling-envelope asset in the "postal notice"
// treatment docs/tempa-build-guide.md has described as the intended
// final look since 2026-09-05 (terracotta envelope/motion mark,
// terracotta title, warm pale background, smaller muted supporting
// copy — never a generic app alert/toast).
//
// This component is PRESENTATION ONLY: every call site still computes
// its own existing "is mail currently in transit" condition (Home's
// hasIncomingMailInTransit, Letterbox Level 1's incomingMailInTransit-
// PersonIds, Letterbox Level 2's incomingMailInTransitPersonIds(...).has
// (otherId) — all lib/letters.ts, all reading the SAME incoming_mail_
// in_transit RPC, unchanged by this pass) and only renders this when
// that existing condition is already true.
//
// The heading and supporting sentence are ALWAYS live text, never part
// of the image — the image is decorative motion/envelope art only
// (public/brand/mail-on-the-way.png, alt="" / aria-hidden, so a screen
// reader announces the heading first, not "image"). Keeping the copy as
// real strings in code (not rasterized, not deeply hardcoded around
// English word length) is deliberate preparation for the upcoming
// translation pass — this task does not build that infrastructure.
export default function MailOnTheWay({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-clay/15 bg-clay/[.08] px-2.5 py-2 ${className}`}
    >
      <Image
        src="/brand/mail-on-the-way.png"
        alt=""
        aria-hidden="true"
        // Intended small on-page display size (not the full 2173x724
        // source resolution) — same ~3:1 aspect ratio, so next/image's
        // automatic optimization requests an appropriately small file
        // rather than the largest configured device size for what is
        // really only ever rendered as a ~20px-tall status icon. The
        // Tailwind height class below still controls the final rendered
        // size; width stays auto so the ratio above is what actually
        // keeps it from distorting. Sized to leave real estate for the
        // text in Letterbox's own narrowest 3-column card (~200px of
        // content width) without forcing an awkward mid-word wrap.
        width={72}
        height={24}
        className="h-5 w-auto shrink-0"
      />
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold leading-tight text-clay">Mail on the way</p>
        <p className="text-[11.5px] leading-tight text-foreground/55">A letter is travelling to you.</p>
      </div>
    </div>
  )
}
