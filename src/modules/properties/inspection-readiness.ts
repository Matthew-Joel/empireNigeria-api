import { InspectionConsent, InspectionStatus, PropertyStatus } from '@prisma/client'
import { addBusinessDays } from '../../common/business-days'

export type InspectionStage = 'AWAITING_OWNER_CONSENT' | 'READY_TO_SCHEDULE' | 'AWAITING_ACCESS_CONFIRMATION' | 'READY_FOR_VISIT'
export type ActionParty = 'OPERATIONS' | 'INSPECTOR'

export interface NextAction { label: string; party: ActionParty; dueAt: Date | null; overdue: boolean }
export interface InspectionReadiness { stage: InspectionStage; nextAction: NextAction }

interface ReadinessProperty {
  status: PropertyStatus
  inspectionConsent: InspectionConsent
  inspectionConsentAt: Date | null
  inspectionConsentRequestedAt: Date | null
  inspectionReadyAt: Date | null
}

interface ReadinessInspection {
  status: InspectionStatus
  scheduledAt: Date
  completedAt?: Date | null
  accessConfirmedAt: Date | null
}

const REPORT_HOURS = 24

const latest = (...dates: Array<Date | null | undefined>) => {
  const known = dates.filter((date): date is Date => Boolean(date))
  return known.length ? new Date(Math.max(...known.map((date) => date.getTime()))) : null
}

// Where a property that is waiting for inspection stands, and who must act next.
// While the owner has not consented the property is "awaiting owner consent",
// not an overdue inspection. Only the follow-up that Operations owes is timed.
export function inspectionReadiness(property: ReadinessProperty, openInspection: ReadinessInspection | null | undefined, now = new Date()): InspectionReadiness | null {
  if (property.status !== PropertyStatus.INSPECTION_PENDING) return null
  const action = (label: string, party: ActionParty, dueAt: Date | null): NextAction => ({ label, party, dueAt, overdue: dueAt ? dueAt.getTime() < now.getTime() : false })
  const businessDaysAfter = (from: Date | null, days: number) => (from ? addBusinessDays(from, days) : null)

  if (property.inspectionConsent !== InspectionConsent.GRANTED) {
    if (property.inspectionConsent === InspectionConsent.DISCUSSION_REQUESTED) {
      return { stage: 'AWAITING_OWNER_CONSENT', nextAction: action('Discuss the inspection arrangements with the owner', 'OPERATIONS', businessDaysAfter(latest(property.inspectionConsentAt, property.inspectionConsentRequestedAt, property.inspectionReadyAt), 1)) }
    }
    if (!property.inspectionConsentRequestedAt) {
      return { stage: 'AWAITING_OWNER_CONSENT', nextAction: action('Request the owner’s consent to inspect', 'OPERATIONS', businessDaysAfter(property.inspectionReadyAt, 1)) }
    }
    return { stage: 'AWAITING_OWNER_CONSENT', nextAction: action('Follow up on the owner’s consent', 'OPERATIONS', businessDaysAfter(property.inspectionConsentRequestedAt, 2)) }
  }

  if (!openInspection) {
    return { stage: 'READY_TO_SCHEDULE', nextAction: action('Schedule the inspection and assign an inspector', 'OPERATIONS', businessDaysAfter(latest(property.inspectionConsentAt, property.inspectionReadyAt), 1)) }
  }

  if (openInspection.status === InspectionStatus.SCHEDULED && !openInspection.accessConfirmedAt) {
    // Access has to be settled before the visit itself.
    return { stage: 'AWAITING_ACCESS_CONFIRMATION', nextAction: action('Confirm access to the property', 'OPERATIONS', openInspection.scheduledAt) }
  }

  if (openInspection.status === InspectionStatus.COMPLETED) {
    const reportDue = openInspection.completedAt ? new Date(openInspection.completedAt.getTime() + REPORT_HOURS * 60 * 60 * 1000) : null
    return { stage: 'READY_FOR_VISIT', nextAction: action('Submit the inspection report', 'INSPECTOR', reportDue) }
  }

  return { stage: 'READY_FOR_VISIT', nextAction: action(openInspection.status === InspectionStatus.IN_PROGRESS ? 'Finish the visit' : 'Carry out the inspection', 'INSPECTOR', addBusinessDays(openInspection.scheduledAt, 3)) }
}
