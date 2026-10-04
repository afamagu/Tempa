import { describe, expect, it, vi } from 'vitest'
import { getRelationshipCapacity } from './relationship-capacity'

describe('getRelationshipCapacity', () => {
  it('maps the canonical RPC row without recomputing any capacity rules client-side', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          active_limit: 5,
          established_count: 3,
          outgoing_pending_count: 1,
          incoming_pending_count: 2,
          committed_count: 4,
          available_slots: 1,
          outgoing_pending_limit: 2,
          incoming_pending_limit: 2,
          can_start_first_contact: true,
          can_receive_first_contact: false,
          grandfathered: false,
        },
      ],
      error: null,
    })

    const result = await getRelationshipCapacity({ rpc } as never)

    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('get_relationship_capacity')
    expect(result).toEqual({
      activeLimit: 5,
      establishedCount: 3,
      outgoingPendingCount: 1,
      incomingPendingCount: 2,
      committedCount: 4,
      availableSlots: 1,
      outgoingPendingLimit: 2,
      incomingPendingLimit: 2,
      canStartFirstContact: true,
      canReceiveFirstContact: false,
      grandfathered: false,
    })
  })

  it('maps a grandfathered member without pretending capacity is available', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          active_limit: 5,
          established_count: 7,
          outgoing_pending_count: 0,
          incoming_pending_count: 0,
          committed_count: 7,
          available_slots: 0,
          outgoing_pending_limit: 2,
          incoming_pending_limit: 2,
          can_start_first_contact: false,
          can_receive_first_contact: true,
          grandfathered: true,
        },
      ],
      error: null,
    })

    await expect(getRelationshipCapacity({ rpc } as never)).resolves.toMatchObject({
      activeLimit: 5,
      establishedCount: 7,
      availableSlots: 0,
      canStartFirstContact: false,
      grandfathered: true,
    })
  })

  it('fails closed to null when the RPC cannot be read', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'missing RPC', code: '42883' },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(getRelationshipCapacity({ rpc } as never)).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      '[relationship-capacity] get_relationship_capacity failed',
      expect.objectContaining({ code: '42883' })
    )

    errorSpy.mockRestore()
  })
})
