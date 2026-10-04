import { describe, expect, it } from 'vitest'
import { retainedMentions, mentionPublicationRpc } from './public-mentions'
const mia = { userId: 'mia', pseudonym: 'Mia' }
describe('selected mention identities', () => {
  it('retains only explicitly selected, still-present people, once per identity', () => {
    expect(retainedMentions('Hi @Mia. And @Mia again.', [mia, mia])).toEqual([mia])
    expect(retainedMentions('Hi @Mia.', [])).toEqual([])
    expect(retainedMentions('Removed', [mia])).toEqual([])
  })
  it('does not match name prefixes or email-like text', () => {
    expect(retainedMentions('@Miami hello@example@Mia', [mia])).toEqual([])
    expect(retainedMentions('**@Mia**', [mia])).toEqual([mia])
  })
  it('sends the original Safety/body arguments through the atomic wrapper', () => {
    const args = { p_body: '@Mia', p_safety_evaluation_id: 'approved' }
    expect(mentionPublicationRpc('publish_dispatch', args, [mia])).toEqual(['publish_with_mentions', {
      p_operation: 'publish_dispatch', p_arguments: args, p_mentions: [mia],
    }])
  })
  it('preserves existing callers and removes deleted selections', () => {
    expect(mentionPublicationRpc('publish_dispatch', { p_body: 'plain' })).toEqual(['publish_dispatch', { p_body: 'plain' }])
    expect(mentionPublicationRpc('publish_dispatch', { p_body: 'plain' }, [mia])[1].p_mentions).toEqual([])
  })
})

import { executeMentionPublication } from './public-mentions'
import { vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
afterEach(() => vi.unstubAllGlobals())
it('wakes email only after successful selected-mention publication and preserves the result on network failure', async () => {
 vi.stubGlobal('window', {})
 const fetcher = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetcher)
 const result = { data: { id: 'saved' }, error: null }; const rpc = vi.fn().mockResolvedValue(result)
 const client = { rpc } as unknown as SupabaseClient
 expect(await executeMentionPublication(client, mentionPublicationRpc('publish_dispatch', { p_body: '@Mia' }, [mia]))).toBe(result)
 expect(fetcher).toHaveBeenCalledTimes(1)
 rpc.mockResolvedValue({ data: null, error: { message: 'Safety rejected' } })
 await executeMentionPublication(client, mentionPublicationRpc('publish_dispatch', { p_body: '@Mia' }, [mia]))
 expect(fetcher).toHaveBeenCalledTimes(1)
 rpc.mockResolvedValue(result)
 await executeMentionPublication(client, mentionPublicationRpc('publish_dispatch', { p_body: 'No mention' }, []))
 expect(fetcher).toHaveBeenCalledTimes(1)
})
