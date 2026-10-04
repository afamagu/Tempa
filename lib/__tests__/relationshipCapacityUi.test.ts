import { describe, expect, it } from 'vitest'
import {
  correspondenceCapacitySummary,
  newCorrespondenceUnavailableMessage,
  type RelationshipCapacity,
} from '@/lib/relationship-capacity'

function capacity(overrides: Partial<RelationshipCapacity> = {}): RelationshipCapacity {
  return {
    activeLimit: 5,
    establishedCount: 2,
    outgoingPendingCount: 0,
    incomingPendingCount: 0,
    committedCount: 2,
    availableSlots: 3,
    outgoingPendingLimit: 2,
    incomingPendingLimit: 2,
    canStartFirstContact: true,
    canReceiveFirstContact: true,
    grandfathered: false,
    ...overrides,
  }
}

describe('newCorrespondenceUnavailableMessage', () => {
  it('does not block the UI when capacity is available', () => {
    expect(newCorrespondenceUnavailableMessage(capacity())).toBeNull()
  })

  it('does not invent a client-side denial when the canonical capacity read failed', () => {
    expect(newCorrespondenceUnavailableMessage(null)).toBeNull()
  })

  it('explains a full correspondence circle without quota or slot language', () => {
    const message = newCorrespondenceUnavailableMessage(capacity({
      establishedCount: 5,
      committedCount: 5,
      availableSlots: 0,
      canStartFirstContact: false,
    }))

    expect(message).toBe(
      'Your correspondence circle is full for now. When a place opens, you can write to someone new.'
    )
    expect(message).not.toMatch(/slot|quota|score/i)
  })

  it('distinguishes the outgoing first-letter ceiling from a full circle', () => {
    const message = newCorrespondenceUnavailableMessage(capacity({
      outgoingPendingCount: 2,
      committedCount: 4,
      availableSlots: 1,
      canStartFirstContact: false,
    }))

    expect(message).toBe(
      'You already have two first letters waiting for replies. When one is answered or closes, you can write to someone new.'
    )
  })

  it('prefers the full-circle explanation when both constraints are reached', () => {
    const message = newCorrespondenceUnavailableMessage(capacity({
      establishedCount: 3,
      outgoingPendingCount: 2,
      committedCount: 5,
      availableSlots: 0,
      canStartFirstContact: false,
    }))

    expect(message).toContain('correspondence circle is full')
  })
})

describe('correspondenceCapacitySummary', () => {
  it('stays silent when canonical capacity cannot be read', () => {
    expect(correspondenceCapacitySummary(null)).toBeNull()
  })

  it('uses restrained human language for available capacity', () => {
    expect(correspondenceCapacitySummary(capacity({ availableSlots: 1 }))).toBe('Room for one more.')
    expect(correspondenceCapacitySummary(capacity({ availableSlots: 2 }))).toBe('Room for 2 more.')
  })

  it('shows a quiet full state without exposing internal quota vocabulary', () => {
    const summary = correspondenceCapacitySummary(capacity({
      establishedCount: 5,
      committedCount: 5,
      availableSlots: 0,
      canStartFirstContact: false,
    }))

    expect(summary).toBe('Your correspondence circle is full for now.')
    expect(summary).not.toMatch(/slot|quota|score/i)
  })

  it('preserves the pending-first-letter explanation when that is the actual constraint', () => {
    expect(correspondenceCapacitySummary(capacity({
      outgoingPendingCount: 2,
      committedCount: 4,
      availableSlots: 1,
      canStartFirstContact: false,
    }))).toContain('two first letters waiting for replies')
  })
})
