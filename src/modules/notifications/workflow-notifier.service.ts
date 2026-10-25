import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MaintenanceStatus, PropertyStatus, UserRole, UserStatus } from '@prisma/client'
import { PrismaService } from '../../database/prisma.service'
import { cleanLine, EmailContent, renderEmail } from './email-templates'
import { NotificationsService } from './notifications.service'

interface Person { id: string; email: string; role: UserRole }

// Each role lands on a different part of the frontend, so a link carries one path per role.
type RolePaths = Partial<Record<UserRole, string>>
type Message = Omit<EmailContent, 'cta'> & { cta?: { label: string; paths: RolePaths } }

const personSelect = { id: true, email: true, role: true } as const
const propertyInclude = { owner: { select: personSelect }, manager: { select: personSelect } } as const

const propertyPaths = (id: string): RolePaths => ({
  [UserRole.OWNER]: `/properties/${id}`,
  [UserRole.PROPERTY_MANAGER]: `/operations/property-manager/portfolio/${id}`,
  [UserRole.ADMIN]: `/admin/properties/${id}`,
})
const inspectionPaths = (id: string): RolePaths => ({
  [UserRole.OWNER]: `/inspections/${id}`,
  [UserRole.PROPERTY_MANAGER]: `/inspections/${id}`,
  [UserRole.INSPECTOR]: `/operations/inspector/assignments/${id}`,
  [UserRole.ADMIN]: '/admin/inspections',
})
const reportPaths = (id: string): RolePaths => ({ ...inspectionPaths(id), [UserRole.OWNER]: `/inspections/${id}/report`, [UserRole.PROPERTY_MANAGER]: `/inspections/${id}/report` })
const maintenancePaths = (id: string): RolePaths => ({
  [UserRole.OWNER]: `/maintenance/${id}`,
  [UserRole.PROPERTY_MANAGER]: `/maintenance/${id}`,
  [UserRole.CONTRACTOR]: `/operations/contractor/jobs/${id}`,
  [UserRole.ADMIN]: '/admin/maintenance',
})

// Sends workflow emails after a database change has committed. Delivery is
// best-effort: a failure is logged and never reaches the caller, so a mail
// outage cannot fail or roll back a status change.
@Injectable()
export class WorkflowNotifier {
  private readonly logger = new Logger(WorkflowNotifier.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  private url(path: string) {
    return `${(this.config.get<string>('APP_URL') ?? 'http://localhost:5173').replace(/\/+$/, '')}${path}`
  }

  private date(value: Date) {
    return value.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })
  }

  private naira(value: number) {
    return `NGN ${value.toLocaleString('en-NG')}`
  }

  private admins(): Promise<Person[]> {
    return this.prisma.user.findMany({ where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE }, select: personSelect })
  }

  // One email per recipient, so addresses are not shared and each link fits the recipient's role.
  // Duplicate recipients and the person who made the change are skipped.
  private async deliver(recipients: Array<Person | null | undefined>, subject: string, message: Message, actorId?: string) {
    const seen = new Set<string>()
    for (const person of recipients) {
      if (!person?.email || person.id === actorId || seen.has(person.email)) continue
      seen.add(person.email)
      const path = message.cta?.paths[person.role]
      const { html, text } = renderEmail({ ...message, cta: message.cta && path ? { label: message.cta.label, url: this.url(path) } : undefined })
      try {
        await this.notifications.sendEmail({ to: person.email, subject: cleanLine(subject), html, text })
      } catch (error) {
        // One bad address must not stop the remaining recipients.
        this.logger.warn(`Could not email ${person.role.toLowerCase()} about "${cleanLine(subject)}": ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private async run(event: string, work: () => Promise<void>) {
    // Test fixtures run against the real database, so they switch workflow mail off.
    if (this.config.get<string>('WORKFLOW_EMAILS_DISABLED') === 'true') return
    try {
      await work()
    } catch (error) {
      this.logger.warn(`Could not send ${event} email: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private property(id: string) {
    return this.prisma.property.findUnique({ where: { id }, include: propertyInclude })
  }

  private inspection(id: string) {
    return this.prisma.inspection.findUnique({
      where: { id },
      include: { property: { include: propertyInclude }, inspector: { select: personSelect }, report: { include: { findings: { select: { severity: true } } } } },
    })
  }

  private maintenance(id: string) {
    return this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: { property: { include: propertyInclude }, contractor: { select: personSelect }, quotes: { orderBy: { revision: 'desc' }, take: 1 } },
    })
  }

  // Properties

  propertySubmitted(propertyId: string, actorId?: string) {
    return this.run('property submitted', async () => {
      const property = await this.property(propertyId)
      if (!property) return
      await this.deliver(await this.admins(), `Property submitted for review: ${property.name}`, {
        heading: 'A property is waiting for review',
        intro: `${property.name} was submitted for administrator review.`,
        details: [['Property', property.name], ['Address', `${property.address}, ${property.city}, ${property.state}`], ['Owner', property.owner.email]],
        cta: { label: 'Review property', paths: propertyPaths(property.id) },
      }, actorId)
    })
  }

  propertyReviewed(propertyId: string, actorId?: string) {
    return this.run('property reviewed', async () => {
      const property = await this.property(propertyId)
      if (!property) return
      const wording: Partial<Record<PropertyStatus, { subject: string; heading: string; intro: string }>> = {
        [PropertyStatus.APPROVED]: { subject: 'approved', heading: 'Your property has been approved', intro: `${property.name} passed review and is now approved.` },
        [PropertyStatus.CHANGES_REQUESTED]: { subject: 'changes requested', heading: 'Changes are needed on your property', intro: `An administrator reviewed ${property.name} and asked for changes. Update the details and submit it again.` },
        [PropertyStatus.INSPECTION_PENDING]: { subject: 'inspection pending', heading: 'Your property is moving to inspection', intro: `${property.name} passed document review. An inspection will be scheduled next.` },
      }
      const copy = wording[property.status]
      // Other statuses, such as under review, are too minor to email.
      if (!copy) return
      const note: Array<[string, string]> = property.reviewNote ? [['Reviewer note', property.reviewNote]] : []
      // Managers only hear about approval, when the property becomes theirs to run.
      const recipients = property.status === PropertyStatus.APPROVED ? [property.owner, property.manager] : [property.owner]
      await this.deliver(recipients, `Property ${copy.subject}: ${property.name}`, {
        heading: copy.heading,
        intro: copy.intro,
        details: [['Property', property.name], ['Status', property.status.toLowerCase().replaceAll('_', ' ')], ...note],
        cta: { label: 'View property', paths: propertyPaths(property.id) },
      }, actorId)
    })
  }

  propertyManagerAssigned(propertyId: string, actorId?: string) {
    return this.run('property manager assigned', async () => {
      const property = await this.property(propertyId)
      if (!property?.manager) return
      await this.deliver([property.manager, property.owner], `Property manager assigned: ${property.name}`, {
        heading: 'A property manager was assigned',
        intro: `${property.manager.email} now manages ${property.name}.`,
        details: [['Property', property.name], ['Address', `${property.address}, ${property.city}, ${property.state}`]],
        cta: { label: 'View property', paths: propertyPaths(property.id) },
      }, actorId)
    })
  }

  // Inspections

  inspectionScheduled(inspectionId: string, actorId?: string) {
    return this.run('inspection scheduled', async () => {
      const visit = await this.inspection(inspectionId)
      if (!visit) return
      await this.deliver([visit.inspector, visit.property.owner, visit.property.manager], `Inspection scheduled: ${visit.property.name}`, {
        heading: 'An inspection has been scheduled',
        intro: `An inspection of ${visit.property.name} is scheduled for ${this.date(visit.scheduledAt)}.`,
        details: [['Property', visit.property.name], ['Address', `${visit.property.address}, ${visit.property.city}, ${visit.property.state}`], ['When', this.date(visit.scheduledAt)], ['Purpose', visit.purpose]],
        cta: { label: 'View inspection', paths: inspectionPaths(visit.id) },
      }, actorId)
    })
  }

  inspectionRescheduled(inspectionId: string, previousInspectorId?: string, actorId?: string) {
    return this.run('inspection rescheduled', async () => {
      const visit = await this.inspection(inspectionId)
      if (!visit) return
      await this.deliver([visit.inspector, visit.property.owner, visit.property.manager], `Inspection rescheduled: ${visit.property.name}`, {
        heading: 'An inspection was rescheduled',
        intro: `The inspection of ${visit.property.name} is now scheduled for ${this.date(visit.scheduledAt)}.`,
        details: [['Property', visit.property.name], ['When', this.date(visit.scheduledAt)], ['Purpose', visit.purpose]],
        cta: { label: 'View inspection', paths: inspectionPaths(visit.id) },
      }, actorId)
      if (previousInspectorId && previousInspectorId !== visit.inspectorId) {
        const previous = await this.prisma.user.findUnique({ where: { id: previousInspectorId }, select: personSelect })
        await this.deliver([previous], `Inspection reassigned: ${visit.property.name}`, {
          heading: 'You were removed from an inspection',
          intro: `The inspection of ${visit.property.name} was reassigned to another inspector. No action is needed from you.`,
        }, actorId)
      }
    })
  }

  inspectionCancelled(inspectionId: string, actorId?: string) {
    return this.run('inspection cancelled', async () => {
      const visit = await this.inspection(inspectionId)
      if (!visit) return
      await this.deliver([visit.inspector, visit.property.owner, visit.property.manager], `Inspection cancelled: ${visit.property.name}`, {
        heading: 'An inspection was cancelled',
        intro: `The inspection of ${visit.property.name} planned for ${this.date(visit.scheduledAt)} was cancelled.`,
        details: [['Property', visit.property.name], ['Purpose', visit.purpose]],
      }, actorId)
    })
  }

  inspectionProgress(inspectionId: string, stage: 'started' | 'visit completed', actorId?: string) {
    return this.run(`inspection ${stage}`, async () => {
      const visit = await this.inspection(inspectionId)
      if (!visit) return
      await this.deliver(await this.admins(), `Inspection ${stage}: ${visit.property.name}`, {
        heading: `Inspection ${stage}`,
        intro: stage === 'started' ? `The inspector started the visit to ${visit.property.name}.` : `The inspector finished the visit to ${visit.property.name}. A report should follow.`,
        details: [['Property', visit.property.name], ['Inspector', visit.inspector.email]],
        cta: { label: 'Open inspections', paths: inspectionPaths(visit.id) },
      }, actorId)
    })
  }

  inspectionReportReady(inspectionId: string, actorId?: string) {
    return this.run('inspection report ready', async () => {
      const visit = await this.inspection(inspectionId)
      if (!visit) return
      const findings = visit.report?.findings.length ?? 0
      const high = visit.report?.findings.filter((finding) => finding.severity === 'HIGH').length ?? 0
      await this.deliver([...(await this.admins()), visit.property.owner, visit.property.manager], `Inspection report ready: ${visit.property.name}`, {
        heading: 'An inspection report is ready',
        intro: `The inspector submitted the report for ${visit.property.name}.`,
        details: [['Property', visit.property.name], ['Findings', `${findings}${high ? ` (${high} high severity)` : ''}`]],
        cta: { label: 'Read the report', paths: reportPaths(visit.id) },
      }, actorId)
    })
  }

  // Maintenance

  maintenanceReported(requestId: string, actorId?: string) {
    return this.run('maintenance reported', async () => {
      const job = await this.maintenance(requestId)
      if (!job) return
      await this.deliver([...(await this.admins()), job.property.manager], `Maintenance reported: ${job.issue}`, {
        heading: 'A maintenance issue was reported',
        intro: `The owner reported an issue at ${job.property.name}.`,
        details: [['Issue', job.issue], ['Priority', job.priority.toLowerCase()], ['Property', job.property.name]],
        cta: { label: 'Open request', paths: maintenancePaths(job.id) },
      }, actorId)
    })
  }

  maintenanceAssigned(requestId: string, actorId?: string) {
    return this.run('maintenance assigned', async () => {
      const job = await this.maintenance(requestId)
      if (!job) return
      await this.deliver([job.contractor, job.property.owner], `Maintenance assigned: ${job.issue}`, {
        heading: 'A contractor was assigned',
        intro: `${job.contractor?.email ?? 'A contractor'} was assigned to the issue at ${job.property.name}. The contractor will send a quote for the owner to approve.`,
        details: [['Issue', job.issue], ['Property', job.property.name], ['Work brief', job.assignmentNote ?? '']],
        cta: { label: 'View request', paths: maintenancePaths(job.id) },
      }, actorId)
    })
  }

  maintenanceQuoteSubmitted(requestId: string, actorId?: string) {
    return this.run('maintenance quote submitted', async () => {
      const job = await this.maintenance(requestId)
      const quote = job?.quotes[0]
      if (!job || !quote) return
      const details: Array<[string, string]> = [
        ['Issue', job.issue], ['Property', job.property.name], ['Amount', this.naira(quote.amountNgn)],
        ['Duration', `${quote.expectedDurationDays} day${quote.expectedDurationDays === 1 ? '' : 's'}`], ['Scope', quote.scope],
      ]
      await this.deliver([job.property.owner], `Quote awaiting your approval: ${job.issue}`, {
        heading: 'A quote needs your approval',
        intro: `The contractor sent a quote for ${job.issue}. Work starts only after you approve it.`,
        details,
        cta: { label: 'Review quote', paths: maintenancePaths(job.id) },
      }, actorId)
      await this.deliver([...(await this.admins()), job.property.manager], `Quote submitted: ${job.issue}`, {
        heading: 'A contractor quote is awaiting owner approval',
        intro: `A quote for ${job.issue} at ${job.property.name} was sent to the owner.`,
        details,
        cta: { label: 'Open request', paths: maintenancePaths(job.id) },
      }, actorId)
    })
  }

  maintenanceQuoteDecided(requestId: string, actorId?: string) {
    return this.run('maintenance quote decided', async () => {
      const job = await this.maintenance(requestId)
      const quote = job?.quotes[0]
      if (!job || !quote) return
      const approved = job.status === MaintenanceStatus.APPROVED
      const note: Array<[string, string]> = quote.decisionNote ? [['Owner note', quote.decisionNote]] : []
      await this.deliver([job.contractor, ...(await this.admins()), job.property.manager], `Quote ${approved ? 'approved' : 'rejected'}: ${job.issue}`, {
        heading: approved ? 'The owner approved the quote' : 'The owner rejected the quote',
        intro: approved ? `Work on ${job.issue} at ${job.property.name} can now start.` : `The quote for ${job.issue} was rejected. The contractor can send a revised quote, or an administrator can reassign the job.`,
        details: [['Issue', job.issue], ['Property', job.property.name], ['Amount', this.naira(quote.amountNgn)], ...note],
        cta: { label: 'Open request', paths: maintenancePaths(job.id) },
      }, actorId)
    })
  }

  maintenanceStatusChanged(requestId: string, status: 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED', actorId?: string) {
    return this.run(`maintenance ${status.toLowerCase()}`, async () => {
      const job = await this.maintenance(requestId)
      if (!job) return
      const copy = {
        IN_PROGRESS: { subject: 'work started', heading: 'Work has started', intro: `The contractor started work on ${job.issue} at ${job.property.name}.` },
        COMPLETED: { subject: 'work completed', heading: 'Work is complete', intro: `The contractor finished ${job.issue} at ${job.property.name}. An administrator will review the evidence and close the request.` },
        CLOSED: { subject: 'request closed', heading: 'The request is closed', intro: `The maintenance request for ${job.issue} at ${job.property.name} is closed.` },
      }[status]
      const recipients = status === 'COMPLETED' ? [job.property.owner, ...(await this.admins())] : [job.property.owner]
      await this.deliver(recipients, `Maintenance ${copy.subject}: ${job.issue}`, {
        heading: copy.heading,
        intro: copy.intro,
        details: [['Issue', job.issue], ['Property', job.property.name]],
        cta: { label: 'View request', paths: maintenancePaths(job.id) },
      }, actorId)
    })
  }
}
