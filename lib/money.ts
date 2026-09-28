// Fiat money is stored as integer ISO 4217 minor units (docs/commerce-
// architecture.md). Only currencies listed here can be checked out: an
// unknown currency has no known exponent, so it fails closed rather than
// guessing (a wrong exponent would charge 100× too much or too little).
// Client-safe: no secrets, no I/O.

export const CURRENCY_EXPONENT: Readonly<Record<string, number>> = {
  USD: 2, EUR: 2, GBP: 2, CAD: 2,
  NGN: 2, GHS: 2, KES: 2, ZAR: 2, TZS: 2, EGP: 2, MAD: 2, ZMW: 2, MWK: 2,
  UGX: 0, RWF: 0, XOF: 0, XAF: 0,
}

export function currencyExponent(currency: string): number | null {
  const e = CURRENCY_EXPONENT[currency]
  return typeof e === 'number' ? e : null
}

/** Minor units → the provider's major-unit decimal string ("7500.00"). */
export function minorToMajorString(amountMinor: number, currency: string): string | null {
  const e = currencyExponent(currency)
  if (e === null || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null
  const s = String(amountMinor).padStart(e + 1, '0')
  return e === 0 ? s : `${s.slice(0, -e)}.${s.slice(-e)}`
}

/** A provider-reported major amount → exact minor units, or null if it is
 * not a whole number of minor units (never rounds a mismatch into a match). */
export function majorToMinor(amount: unknown, currency: string): number | null {
  const e = currencyExponent(currency)
  const value = typeof amount === 'string' ? Number(amount) : amount
  if (e === null || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const scaled = value * 10 ** e
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 && Number.isSafeInteger(rounded) ? rounded : null
}

export function formatMoney(amountMinor: number, currency: string, locale?: string): string {
  const e = currencyExponent(currency) ?? 2
  const value = amountMinor / 10 ** e
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: e, maximumFractionDigits: e }).format(value)
  } catch {
    return `${currency} ${value.toFixed(e)}`
  }
}
