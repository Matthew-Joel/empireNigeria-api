import { InspectionConsent, InspectionStatus, PropertyStatus } from '@prisma/client'
import { inspectionReadiness } from './inspection-readiness'

// Monday 26 October 2026, 09:00 in Lagos.
const ready = new Date('2026-10-26T08:00:00Z')
const base = { status: PropertyStatus.INSPECTION_PENDING, inspectionConsent: InspectionConsent.NOT_RECORDED, inspectionConsentAt: null, inspectionConsentRequestedAt: null, inspectionReadyAt: ready }
const at = (iso: string) => new Date(iso)

describe('inspectionReadiness', () => {
  it('says nothing about properties that are not waiting for inspection', () => {
    for (const status of [PropertyStatus.DRAFT, PropertyStatus.SUBMITTED, PropertyStatus.UNDER_REVIEW, PropertyStatus.APPROVED, PropertyStatus.CHANGES_REQUESTED]) {
      expect(inspectionReadiness({ ...base, status }, null)).toBeNull()
    }
  })

  it('asks operations to request consent within one business day', () => {
    const result = inspectionReadiness(base, null, at('2026-10-26T12:00:00Z'))
    expect(result?.stage).toBe('AWAITING_OWNER_CONSENT')
    expect(result?.nextAction).toMatchObject({ party: 'OPERATIONS', dueAt: at('2026-10-27T08:00:00Z'), overdue: false })
    expect(inspectionReadiness(base, null, at('2026-10-28T08:00:00Z'))?.nextAction.overdue).toBe(true)
  })

  it('times the follow-up from the first request, two business days later', () => {
    const requested = { ...base, inspectionConsentRequestedAt: at('2026-10-29T10:00:00Z') }
    const result = inspectionReadiness(requested, null, at('2026-10-30T10:00:00Z'))
    expect(result?.nextAction.label).toMatch(/Follow up/)
    // Thursday plus two working days skips the weekend.
    expect(result?.nextAction.dueAt).toEqual(at('2026-11-02T10:00:00Z'))
    expect(result?.nextAction.overdue).toBe(false)
  })

  it('treats a request to talk first as awaiting consent, owned by operations', () => {
    const discuss = { ...base, inspectionConsent: InspectionConsent.DISCUSSION_REQUESTED, inspectionConsentAt: at('2026-10-27T10:00:00Z') }
    const result = inspectionReadiness(discuss, null, at('2026-10-27T11:00:00Z'))
    expect(result?.stage).toBe('AWAITING_OWNER_CONSENT')
    expect(result?.nextAction).toMatchObject({ party: 'OPERATIONS', dueAt: at('2026-10-28T10:00:00Z') })
  })

  it('leaves the due date empty rather than guessing when the ready time was never stamped', () => {
    const result = inspectionReadiness({ ...base, inspectionReadyAt: null }, null)
    expect(result?.nextAction).toMatchObject({ dueAt: null, overdue: false })
  })

  it('is ready to schedule once consent is granted, due a business day after the later of consent and readiness', () => {
    const granted = { ...base, inspectionConsent: InspectionConsent.GRANTED, inspectionConsentAt: at('2026-10-27T10:00:00Z') }
    const result = inspectionReadiness(granted, null, at('2026-10-27T11:00:00Z'))
    expect(result?.stage).toBe('READY_TO_SCHEDULE')
    expect(result?.nextAction.dueAt).toEqual(at('2026-10-28T10:00:00Z'))
    // Consent given at sign-up, before the property was ready, counts from readiness.
    const early = { ...granted, inspectionConsentAt: at('2026-10-20T10:00:00Z') }
    expect(inspectionReadiness(early, null, at('2026-10-27T11:00:00Z'))?.nextAction.dueAt).toEqual(at('2026-10-27T08:00:00Z'))
  })

  it('waits for access once a visit is booked, and flags it only after the visit time passes', () => {
    const granted = { ...base, inspectionConsent: InspectionConsent.GRANTED, inspectionConsentAt: at('2026-10-27T10:00:00Z') }
    const visit = { status: InspectionStatus.SCHEDULED, scheduledAt: at('2026-11-03T09:00:00Z'), accessConfirmedAt: null }
    const before = inspectionReadiness(granted, visit, at('2026-11-02T09:00:00Z'))
    expect(before?.stage).toBe('AWAITING_ACCESS_CONFIRMATION')
    expect(before?.nextAction).toMatchObject({ party: 'OPERATIONS', dueAt: visit.scheduledAt, overdue: false })
    expect(inspectionReadiness(granted, visit, at('2026-11-03T10:00:00Z'))?.nextAction.overdue).toBe(true)
  })

  it('hands over to the inspector with three business days to visit, then 24 hours to report', () => {
    const granted = { ...base, inspectionConsent: InspectionConsent.GRANTED, inspectionConsentAt: at('2026-10-27T10:00:00Z') }
    const booked = { status: InspectionStatus.SCHEDULED, scheduledAt: at('2026-10-29T09:00:00Z'), accessConfirmedAt: at('2026-10-28T09:00:00Z') }
    const waiting = inspectionReadiness(granted, booked, at('2026-10-29T08:00:00Z'))
    expect(waiting?.stage).toBe('READY_FOR_VISIT')
    expect(waiting?.nextAction).toMatchObject({ party: 'INSPECTOR', label: 'Carry out the inspection', dueAt: at('2026-11-03T09:00:00Z') })
    const started = inspectionReadiness(granted, { ...booked, status: InspectionStatus.IN_PROGRESS }, at('2026-10-29T10:00:00Z'))
    expect(started?.nextAction.label).toBe('Finish the visit')
    const done = inspectionReadiness(granted, { ...booked, status: InspectionStatus.COMPLETED, completedAt: at('2026-10-29T12:00:00Z') }, at('2026-10-30T13:00:00Z'))
    expect(done?.nextAction).toMatchObject({ party: 'INSPECTOR', label: 'Submit the inspection report', dueAt: at('2026-10-30T12:00:00Z'), overdue: true })
  })
})
