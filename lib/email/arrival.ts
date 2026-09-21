/** A letter arrival contains no letter body, Moment, or Postcard content. */
export type ArrivalEmailInput = {
  letterId: string
  firstContact: boolean
  senderPseudonym?: string | null
  /** Coarse country code from an allowed sender profile, not a precise location. */
  senderCountryCode?: string | null
  /** Public HTTPS origin for Tempa, e.g. https://jointempa.com. */
  siteOrigin: string
  /** Optional public HTTPS origin where the compressed email art is hosted. */
  artOrigin?: string | null
}

export type RenderedArrivalEmail = {
  subject: string
  html: string
  text: string
}

// The numbered, location-labelled email assets remain discoverable in the
// source collection. More than one design can exist for a country; the
// selection here is deliberately explicit and can evolve with the catalogue.
export const ORIGIN_ARRIVAL_ART: Readonly<Record<string, string>> = {
  MA: '01-essaouira-morocco.jpg', TH: '02-bangkok-thailand.jpg',
  US: '03-new-york-usa.jpg', BR: '04-rio-brazil.jpg',
  IN: '05-varanasi-india.jpg', DE: '06-heidelberg-germany.jpg',
  PL: '07-krakow-poland.jpg', RU: '08-st-petersburg-russia.jpg',
  FR: '09-paris-france.jpg', AR: '10-buenos-aires-argentina.jpg',
  CA: '11-quebec-city-canada.jpg', ES: '12-seville-spain.jpg',
  TW: '13-jiufen-taiwan.jpg', TR: '14-istanbul-turkiye.jpg',
  PK: '15-lahore-pakistan.jpg', ID: '16-yogyakarta-indonesia.jpg',
  BD: '17-dhaka-bangladesh.jpg', PH: '18-vigan-philippines.jpg',
  GB: '19-london-uk.jpg', IT: '20-venice-italy.jpg',
  NL: '21-amsterdam-netherlands.jpg', PT: '22-lisbon-portugal.jpg',
  MX: '23-oaxaca-mexico.jpg', CO: '24-cartagena-colombia.jpg',
  AU: '25-sydney-australia.jpg', JP: '26-kyoto-japan.jpg',
  KR: '27-seoul-south-korea.jpg', VN: '28-hoi-an-vietnam.jpg',
  CN: '29-suzhou-china.jpg', MY: '30-george-town-malaysia.jpg',
  SG: '31-singapore.jpg', ZA: '32-cape-town-south-africa.jpg',
  IR: '33-isfahan-iran.jpg', AE: '34-dubai-uae.jpg',
  NG: '35-lagos-nigeria.jpg',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

function publicOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('An HTTPS site origin is required.')
  }
  return url.origin
}

function letterPath(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('A valid letter ID is required.')
  }
  return `/letters/${id}`
}

/** The recipient is selected by the delivery worker, never by a template input. */
export function renderArrivalEmail(input: ArrivalEmailInput): RenderedArrivalEmail {
  const href = `${publicOrigin(input.siteOrigin)}${letterPath(input.letterId)}`
  // Subjects are email headers: remove all control characters (including
  // CR/LF) rather than trusting public pseudonyms to be header-safe.
  const name = input.senderPseudonym?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 80)
  const establishedName = !input.firstContact && name ? name : null
  const subject = establishedName ? `A letter from ${establishedName} has arrived` : 'A letter has arrived for you'
  const headline = 'A letter has arrived for you.'
  const detail = input.firstContact
    ? 'Someone has written to you. Their letter has arrived.'
    : establishedName
      ? `A letter from ${establishedName} has arrived.`
      : 'A letter has arrived in your Letterbox.'

  const countryCode = input.senderCountryCode?.toUpperCase()
  const asset = countryCode && /^[A-Z]{2}$/.test(countryCode) ? ORIGIN_ARRIVAL_ART[countryCode] : undefined
  const imageUrl = input.artOrigin && asset
    ? `${publicOrigin(input.artOrigin)}/${encodeURIComponent(asset)}`
    : null

  // Email clients often block external images. Text and the action sit on
  // their own paper-coloured HTML table so they are never baked into art.
  const art = imageUrl
    ? `<tr><td style="padding:0"><img src="${escapeHtml(imageUrl)}" alt="" width="600" style="display:block;width:100%;height:auto;border:0" /></td></tr>`
    : ''

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f7f3eb;color:#192e40"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f7f3eb"><tr><td align="center" style="padding:24px 12px"><table role="presentation" cellpadding="0" cellspacing="0" width="600" style="width:100%;max-width:600px;background:#fffcf6;border:1px solid #e3ddd1"><tr><td style="padding:26px 30px 22px;font:600 19px Georgia,serif;letter-spacing:0.12em">TEMPA</td></tr>${art}<tr><td style="padding:30px 30px 8px"><h1 style="font:normal 32px/1.2 Georgia,serif;color:#192e40;margin:0">${escapeHtml(headline)}</h1></td></tr><tr><td style="padding:10px 30px 20px;font:16px/1.55 Arial,sans-serif;color:#333b40">${escapeHtml(detail)}</td></tr><tr><td style="padding:0 30px 36px"><a href="${escapeHtml(href)}" style="display:inline-block;background:#192e40;color:#fff;text-decoration:none;border-radius:4px;padding:15px 22px;font:600 15px Arial,sans-serif">Open your letter</a></td></tr><tr><td style="border-top:1px solid #e3ddd1;padding:19px 30px 25px;font:12px/1.5 Arial,sans-serif;color:#585e61">Good letters take time.<br><a href="${escapeHtml(publicOrigin(input.siteOrigin))}" style="color:#585e61">Tempa</a></td></tr></table></td></tr></table></body></html>`
  const text = `TEMPA\n\n${headline}\n\n${detail}\n\nOpen your letter: ${href}\n\nTempa — Good letters take time.`
  return { subject, html, text }
}
