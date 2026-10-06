import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isCommerceAdmin } from '@/lib/admin-commerce'
import {
  flutterwaveApiConfig,
  flutterwaveWebhookConfig,
  testFlutterwaveConnection,
} from '@/lib/payments/flutterwave'

/**
 * Admin-only, read-only Flutterwave connectivity diagnostic.
 * Never returns or logs secret values. It performs one authenticated GET
 * against Flutterwave v3 and reports only coarse configuration/connectivity.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  }

  if (!(await isCommerceAdmin(supabase))) {
    return NextResponse.json({ error: 'not_authorized' }, { status: 403 })
  }

  const api = flutterwaveApiConfig()
  const webhook = flutterwaveWebhookConfig()
  const connection = await testFlutterwaveConnection()

  return NextResponse.json(
    {
      mode: 'v3_test',
      api_secret_configured: api.ok,
      webhook_hash_configured: webhook.ok,
      connection: connection.status,
    },
    {
      status: connection.ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}
