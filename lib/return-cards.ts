import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostcardBaseContent, PostcardRevealLineAlignment } from './moments'
import { getActivePostcards, type PostcardCatalogEntry } from './postcards'

export type ReturnCardVersion = {
  title: string
  location: string
  collection: string
  postmarkText: string
  footerText: string
  frontImagePath: string
  motionSrc: string | null
  durationSeconds: number | null
  revealLineAlignment: string | null
}

export type ReturnCard = {
  id: string
  correspondenceId: string
  sourceLetterId: string
  senderId: string
  recipientId: string
  postcardKey: string
  message: string | null
  senderPseudonymSnapshot: string
  sentAt: string
  version: ReturnCardVersion
}

type ReturnCardRow = {
  id: string
  correspondence_id: string
  source_letter_id: string
  sender_id: string
  recipient_id: string
  message: string | null
  sender_pseudonym_snapshot: string
  sent_at: string
  postcard_versions: {
    postcard_key: string
    title: string
    location: string
    collection: string
    postmark_text: string
    footer_text: string
    front_image_path: string
    motion_src: string | null
    duration_seconds: number | null
    reveal_line_alignment: string | null
  } | null
}

export function mapReturnCardRows(rows: ReturnCardRow[]): ReturnCard[] {
  return rows
    .filter(
      (row): row is ReturnCardRow & { postcard_versions: NonNullable<ReturnCardRow['postcard_versions']> } =>
        row.postcard_versions !== null
    )
    .map((row) => ({
      id: row.id,
      correspondenceId: row.correspondence_id,
      sourceLetterId: row.source_letter_id,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      postcardKey: row.postcard_versions.postcard_key,
      message: row.message,
      senderPseudonymSnapshot: row.sender_pseudonym_snapshot,
      sentAt: row.sent_at,
      version: {
        title: row.postcard_versions.title,
        location: row.postcard_versions.location,
        collection: row.postcard_versions.collection,
        postmarkText: row.postcard_versions.postmark_text,
        footerText: row.postcard_versions.footer_text,
        frontImagePath: row.postcard_versions.front_image_path,
        motionSrc: row.postcard_versions.motion_src,
        durationSeconds: row.postcard_versions.duration_seconds,
        revealLineAlignment: row.postcard_versions.reveal_line_alignment,
      },
    }))
}

export function returnCardVersionToBaseContent(version: ReturnCardVersion): PostcardBaseContent {
  return {
    title: version.title,
    location: version.location,
    collection: version.collection,
    frontImagePath: version.frontImagePath,
    postmarkText: version.postmarkText,
    footerText: version.footerText,
    revealLineAlignment: (version.revealLineAlignment as PostcardRevealLineAlignment | null) ?? undefined,
    living: version.motionSrc
      ? {
          motionSrc: version.motionSrc,
          durationSeconds: version.durationSeconds ?? undefined,
        }
      : undefined,
  }
}

export async function isReturnCardAvailable(
  supabase: SupabaseClient,
  sourceLetterId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('return_card_available', {
    p_source_letter_id: sourceLetterId,
  })

  // Forward-deployment safe: the app can land before the migration without
  // showing a broken action. The database remains authoritative once live.
  if (error) {
    if (error.code !== 'PGRST202' && error.code !== '42883') {
      console.error('[return-cards] return_card_available failed', {
        code: error.code,
        message: error.message,
      })
    }
    return false
  }

  return data === true
}

export async function sendReturnCard(
  supabase: SupabaseClient,
  input: { sourceLetterId: string; postcardKey: string; message: string | null }
): Promise<{ id: string | null; error: { message: string; code?: string } | null }> {
  const { data, error } = await supabase.rpc('send_return_card', {
    p_source_letter_id: input.sourceLetterId,
    p_postcard_key: input.postcardKey,
    p_message: input.message,
  })

  if (error) return { id: null, error: { message: error.message, code: error.code } }
  return { id: typeof data === 'string' ? data : null, error: null }
}

/**
 * Return Cards are a relationship bridge, not a premium send surface.
 * Start from the canonical active Postcard catalogue, then keep only cards
 * whose commerce product is currently published and Complimentary. This is
 * display filtering only; send_return_card repeats the same rule server-side.
 */
export async function getReturnCardPostcards(
  supabase: SupabaseClient
): Promise<PostcardCatalogEntry[]> {
  const [postcards, { data: productRows, error }] = await Promise.all([
    getActivePostcards(supabase),
    supabase
      .from('commerce_products')
      .select('postcard_key, publish_at, unpublish_at')
      .eq('product_type', 'postcard')
      .eq('is_complimentary', true)
      .eq('lifecycle_state', 'published'),
  ])

  if (error) {
    console.error('[return-cards] complimentary catalogue read failed', {
      code: error.code,
      message: error.message,
    })
    return []
  }

  const now = Date.now()
  const keys = new Set(
    (productRows ?? [])
      .filter((row) => {
        const starts = row.publish_at ? new Date(row.publish_at).getTime() <= now : true
        const ends = row.unpublish_at ? new Date(row.unpublish_at).getTime() > now : true
        return starts && ends
      })
      .map((row) => row.postcard_key)
      .filter((key): key is string => typeof key === 'string')
  )

  return postcards.filter((postcard) => keys.has(postcard.key))
}

export async function getReturnCardsForCorrespondences(
  supabase: SupabaseClient,
  correspondenceIds: string[]
): Promise<ReturnCard[]> {
  if (correspondenceIds.length === 0) return []

  const { data, error } = await supabase
    .from('return_cards')
    .select(
      'id, correspondence_id, source_letter_id, sender_id, recipient_id, message, sender_pseudonym_snapshot, sent_at, postcard_versions(postcard_key, title, location, collection, postmark_text, footer_text, front_image_path, motion_src, duration_seconds, reveal_line_alignment)'
    )
    .in('correspondence_id', correspondenceIds)
    .order('sent_at', { ascending: false })

  if (error) {
    // Forward-deployment safe for app-before-migration ordering.
    if (error.code !== '42P01' && error.code !== 'PGRST205') {
      console.error('[return-cards] history read failed', {
        code: error.code,
        message: error.message,
      })
    }
    return []
  }

  return mapReturnCardRows((data ?? []) as unknown as ReturnCardRow[])
}
