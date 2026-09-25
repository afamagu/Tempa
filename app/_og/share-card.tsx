import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BRAND_ACCENT, BRAND_BACKGROUND, BRAND_FOREGROUND, BRAND_MUTED } from '@/lib/site'

// The ONE Tempa share-card renderer (1200×630) used by the root default
// share image and every /d/[shareToken] Dispatch preview. Local assets
// only — the approved Tempa emblem (public/icons, generated from
// public/brand/tempa-emblem.png) and Newsreader, the serif Tempa already
// uses (assets/fonts, SIL OFL). Nothing is fetched remotely.

export const SHARE_CARD_SIZE = { width: 1200, height: 630 }
export const SHARE_CARD_CONTENT_TYPE = 'image/png'

let assets: Promise<{ font: Buffer; emblem: string }> | null = null
function loadAssets() {
  assets ??= Promise.all([
    readFile(join(process.cwd(), 'assets/fonts/Newsreader.ttf')),
    readFile(join(process.cwd(), 'public/icons/icon-192.png')),
  ]).then(([font, emblem]) => ({ font, emblem: `data:image/png;base64,${emblem.toString('base64')}` }))
  return assets
}

/** Dispatch titles are at most 140 characters; scale type so any title fits. */
export function shareCardTitleSize(title: string): number {
  const n = title.length
  if (n <= 32) return 76
  if (n <= 60) return 64
  if (n <= 95) return 54
  return 46
}

export async function renderShareCard({
  title,
  contextLine,
  sponsored = false,
}: {
  title: string
  /** e.g. "A Dispatch from Tempa" / "Sponsored · Acme" / "A Dispatch shared on Tempa". */
  contextLine: string
  /** Shows a quiet "Sponsored" disclosure pill ahead of the context line. */
  sponsored?: boolean
}) {
  const { font, emblem } = await loadAssets()
  const safeTitle = title.length > 140 ? `${title.slice(0, 139)}…` : title

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: BRAND_BACKGROUND,
          padding: '64px 80px',
          fontFamily: 'Newsreader',
          color: BRAND_FOREGROUND,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse (Satori) renders plain img */}
          <img src={emblem} width={64} height={64} alt="" style={{ borderRadius: 14 }} />
          <div style={{ display: 'flex', fontSize: 40, letterSpacing: 0.5 }}>Tempa</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 26, maxWidth: 1000 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 28, color: BRAND_MUTED }}>
            {sponsored && (
              <div
                style={{
                  display: 'flex',
                  border: `2px solid ${BRAND_MUTED}`,
                  borderRadius: 999,
                  padding: '4px 16px',
                  fontSize: 20,
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                }}
              >
                Sponsored
              </div>
            )}
            <div style={{ display: 'flex' }}>{contextLine}</div>
          </div>
          <div style={{ display: 'flex', fontSize: shareCardTitleSize(safeTitle), lineHeight: 1.12, letterSpacing: -0.5 }}>
            {safeTitle}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 24, color: BRAND_MUTED }}>
          <div style={{ display: 'flex', width: 56, height: 3, background: BRAND_ACCENT }} />
          <div style={{ display: 'flex' }}>jointempa.com</div>
        </div>
      </div>
    ),
    {
      ...SHARE_CARD_SIZE,
      fonts: [{ name: 'Newsreader', data: font, style: 'normal', weight: 400 }],
    }
  )
}
