import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const flutterwave = readFileSync(path.join(process.cwd(), 'lib/payments/flutterwave.ts'), 'utf8')
const action = readFileSync(path.join(process.cwd(), 'app/you/credits/actions.ts'), 'utf8')
const webhook = readFileSync(path.join(process.cwd(), 'app/api/payments/flutterwave/webhook/route.ts'), 'utf8')
const diagnostic = readFileSync(path.join(process.cwd(), 'app/api/admin/commerce/flutterwave-test/route.ts'), 'utf8')

describe('Flutterwave v3 reconnect diagnostics', () => {
  it('does not require the webhook hash to initialise checkout or verify transactions', () => {
    expect(action).toContain('flutterwaveApiConfig()')
    expect(action).not.toContain('flutterwaveWebhookConfig()')
    expect(flutterwave).toContain('export function flutterwaveApiConfig')
  })

  it('requires the webhook hash only for webhook verification', () => {
    expect(webhook).toContain('flutterwaveWebhookConfig()')
    expect(flutterwave).toContain('FLUTTERWAVE_WEBHOOK_HASH')
    expect(flutterwave).toContain('webhookSignatureValid')
  })

  it('accepts only v3 TEST secret keys in this checkpoint', () => {
    expect(flutterwave).toContain("secretKey.startsWith('FLWSECK_TEST-')")
  })

  it('has an admin-only read-only API connection probe', () => {
    expect(diagnostic).toContain('isCommerceAdmin')
    expect(diagnostic).toContain('testFlutterwaveConnection')
    expect(diagnostic).toContain("mode: 'v3_test'")
    expect(diagnostic).not.toContain('FLWSECK_TEST-')
  })

  it('probes the documented v3 transactions endpoint without creating a charge', () => {
    expect(flutterwave).toContain('${API}/transactions?from=')
    const probe = flutterwave.slice(flutterwave.indexOf('export async function testFlutterwaveConnection'))
    expect(probe).not.toContain("method: 'POST'")
  })
})
