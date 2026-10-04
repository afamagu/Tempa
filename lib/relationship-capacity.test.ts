import { describe, expect, it, vi } from 'vitest'
import {
  establishmentCapacityMessage,
  firstContactCapacityMessage,
  getRelationshipCapacity,
  relationshipCapacityFailure,
} from './relationship-capacity'

describe('relationship capacity error mapping', () => {
  it('recognizes fixed server detail codes without exposing arbitrary database text', () => {
    expect(
      relationshipCapacityFailure({
        message: 'You are already at your correspondence capacity.',
        details: 'RELATIONSHIP_CAPACITY_REACHED',
      })
    ).toBe('RELATIONSHIP_CAPACITY_REACHED')

    expect(
      relationshipCapacityFailure({
        details: 'OUTGOING_FIRST_CONTACT_LIMIT_REACHED',
      })
    ).toBe('OUTGOING_FIRST_CONTACT_LIMIT_REACHED')

    expect(
      relationshipCapacityFailure({
        hint: 'RECIPIENT_FIRST_CONTACT_LIMIT_REACHED',
      })
    ).toBe('RECIPIENT_FIRST_CONTACT_LIMIT_REACHED')

    expect(relationshipCapacityFailure({ message: 'some unrelated database failure' })).toBeNull()
  })

  it('gives distinct first-contact messages for sender capacity, sender pending limit, and recipient pending limit', () => {
    expect(
      firstContactCapacityMessage({ details: 'RELATIONSHIP_CAPACITY_REACHED' }, 'Maya')
    ).toContain('correspondence circle is full')

    expect(
      firstContactCapacityMessage({ details: 'OUTGOING_FIRST_CONTACT_LIMIT_REACHED' }, 'Maya')
    ).toContain('two first letters waiting for replies')

    expect(
      firstContactCapacityMessage({ details: 'RECIPIENT_FIRST_CONTACT_LIMIT_REACHED' }, 'Maya')
    ).toBe('Maya already has two new letters waiting for a response. Try again when they have room for another.')
  })

  it('uses a separate establishment message and does not misclassify unrelated errors', () => {
    expect(establishmentCapacityMessage({ details: 'RELATIONSHIP_CAPACITY_REACHED' })).toContain(
      'keep this letter and reply when a place opens'
    )
    expect(establishmentCapacityMessage({ details: 'OUTGOING_FIRST_CONTACT_LIMIT_REACHED' })).toBeNull()
    expect(establishmentCapacityMessage({ message: 'network issue' })).toBeNull()
  })
})

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
