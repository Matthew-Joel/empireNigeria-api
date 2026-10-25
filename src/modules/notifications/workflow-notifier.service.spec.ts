import { ConfigService } from '@nestjs/config'
import { MaintenanceStatus, PropertyStatus, UserRole } from '@prisma/client'
import { WorkflowNotifier } from './workflow-notifier.service'

const owner = { id: 'owner', email: 'owner@example.com', role: UserRole.OWNER }
const manager = { id: 'manager', email: 'manager@example.com', role: UserRole.PROPERTY_MANAGER }
const admin = { id: 'admin', email: 'admin@example.com', role: UserRole.ADMIN }
const otherAdmin = { id: 'admin2', email: 'admin2@example.com', role: UserRole.ADMIN }
const contractor = { id: 'contractor', email: 'contractor@example.com', role: UserRole.CONTRACTOR }
const inspector = { id: 'inspector', email: 'inspector@example.com', role: UserRole.INSPECTOR }

const property = { id: 'home', name: 'Palm <Court>', address: '1 Main Street', city: 'Lagos', state: 'Lagos', status: PropertyStatus.APPROVED, reviewNote: 'Add <b>photos</b>', owner, manager }

function setup() {
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue([admin, otherAdmin]), findUnique: jest.fn() },
    property: { findUnique: jest.fn().mockResolvedValue(property) },
    inspection: { findUnique: jest.fn() },
    maintenanceRequest: { findUnique: jest.fn() },
  }
  const notifications = { sendEmail: jest.fn().mockResolvedValue({ sent: true }) }
  const notifier = new WorkflowNotifier(prisma as never, notifications as never, new ConfigService({ APP_URL: 'https://app.example.com/' }))
  return { notifier, prisma, notifications }
}

const sentTo = (notifications: { sendEmail: jest.Mock }) => notifications.sendEmail.mock.calls.map(([input]) => input.to)

describe('WorkflowNotifier', () => {
  it('emails each active admin separately and skips the actor', async () => {
    const { notifier, notifications } = setup()
    await notifier.propertySubmitted('home', 'admin')
    expect(sentTo(notifications)).toEqual(['admin2@example.com'])
    expect(notifications.sendEmail.mock.calls[0][0].html).toContain('https://app.example.com/admin/properties/home')
  })

  it('escapes reviewer text and tells the owner the outcome', async () => {
    const { notifier, notifications } = setup()
    await notifier.propertyReviewed('home', 'admin')
    const [owner_, manager_] = notifications.sendEmail.mock.calls.map(([input]) => input)
    expect(owner_.to).toBe('owner@example.com')
    expect(owner_.subject).toBe('Property approved: Palm <Court>')
    expect(owner_.html).toContain('Add &lt;b&gt;photos&lt;/b&gt;')
    expect(owner_.html).not.toContain('<b>photos</b>')
    expect(owner_.html).toContain('https://app.example.com/properties/home')
    // The manager is told only about approval, and gets the manager route.
    expect(manager_.to).toBe('manager@example.com')
    expect(manager_.html).toContain('/operations/property-manager/portfolio/home')
  })

  it('does not email for statuses that are too minor', async () => {
    const { notifier, prisma, notifications } = setup()
    prisma.property.findUnique.mockResolvedValue({ ...property, status: PropertyStatus.UNDER_REVIEW })
    await notifier.propertyReviewed('home', 'admin')
    expect(notifications.sendEmail).not.toHaveBeenCalled()
  })

  it('does not email the manager when changes are requested', async () => {
    const { notifier, prisma, notifications } = setup()
    prisma.property.findUnique.mockResolvedValue({ ...property, status: PropertyStatus.CHANGES_REQUESTED })
    await notifier.propertyReviewed('home', 'admin')
    expect(sentTo(notifications)).toEqual(['owner@example.com'])
  })

  it('links the inspector and the owner to their own screens', async () => {
    const { notifier, prisma, notifications } = setup()
    prisma.inspection.findUnique.mockResolvedValue({ id: 'visit', purpose: 'Routine', scheduledAt: new Date('2030-01-01T10:00:00Z'), inspectorId: inspector.id, inspector, property })
    await notifier.inspectionScheduled('visit', 'admin')
    const html = Object.fromEntries(notifications.sendEmail.mock.calls.map(([input]) => [input.to, input.html]))
    expect(html['inspector@example.com']).toContain('/operations/inspector/assignments/visit')
    expect(html['owner@example.com']).toContain('/inspections/visit"')
  })

  it('tells the previous inspector when a visit is reassigned', async () => {
    const { notifier, prisma, notifications } = setup()
    prisma.inspection.findUnique.mockResolvedValue({ id: 'visit', purpose: 'Routine', scheduledAt: new Date('2030-01-01T10:00:00Z'), inspectorId: inspector.id, inspector, property })
    prisma.user.findUnique.mockResolvedValue({ id: 'old', email: 'old@example.com', role: UserRole.INSPECTOR })
    await notifier.inspectionRescheduled('visit', 'old', 'admin')
    expect(sentTo(notifications)).toContain('old@example.com')
  })

  it('asks the owner to authorize a submitted quote', async () => {
    const { notifier, prisma, notifications } = setup()
    prisma.maintenanceRequest.findUnique.mockResolvedValue({
      id: 'job', issue: 'Leaking roof', priority: 'HIGH', status: MaintenanceStatus.PENDING_APPROVAL, assignmentNote: null, property, contractor,
      quotes: [{ amountNgn: 250000, expectedDurationDays: 3, scope: 'Replace <roof> sheets', decisionNote: null }],
    })
    await notifier.maintenanceQuoteSubmitted('job', 'contractor')
    const [first] = notifications.sendEmail.mock.calls.map(([input]) => input)
    expect(first.to).toBe('owner@example.com')
    expect(first.subject).toContain('awaiting your approval')
    expect(first.html).toContain('NGN 250,000')
    expect(first.html).toContain('Replace &lt;roof&gt; sheets')
    expect(first.html).toContain('/maintenance/job')
    expect(sentTo(notifications)).toEqual(expect.arrayContaining(['admin@example.com', 'manager@example.com']))
  })

  it('tells the contractor when the owner rejects a quote', async () => {
    const { notifier, prisma, notifications } = setup()
    prisma.maintenanceRequest.findUnique.mockResolvedValue({
      id: 'job', issue: 'Leaking roof', priority: 'HIGH', status: MaintenanceStatus.QUOTE_REJECTED, assignmentNote: null, property, contractor,
      quotes: [{ amountNgn: 250000, expectedDurationDays: 3, scope: 'Replace roof sheets', decisionNote: 'Too expensive' }],
    })
    await notifier.maintenanceQuoteDecided('job', 'owner')
    const toContractor = notifications.sendEmail.mock.calls.map(([input]) => input).find((input) => input.to === 'contractor@example.com')
    expect(toContractor.subject).toBe('Quote rejected: Leaking roof')
    expect(toContractor.html).toContain('Too expensive')
    expect(toContractor.html).toContain('/operations/contractor/jobs/job')
  })

  it('never throws when delivery or lookup fails, and keeps emailing the rest', async () => {
    const { notifier, prisma, notifications } = setup()
    notifications.sendEmail.mockRejectedValueOnce(new Error('resend down'))
    await expect(notifier.propertySubmitted('home')).resolves.toBeUndefined()
    expect(notifications.sendEmail).toHaveBeenCalledTimes(2)
    prisma.property.findUnique.mockRejectedValue(new Error('db down'))
    await expect(notifier.propertyReviewed('home')).resolves.toBeUndefined()
  })

  it('strips line breaks from subjects', async () => {
    const { notifier, prisma, notifications } = setup()
    prisma.property.findUnique.mockResolvedValue({ ...property, name: 'Evil\r\nBcc: x@example.com' })
    await notifier.propertySubmitted('home')
    expect(notifications.sendEmail.mock.calls[0][0].subject).not.toMatch(/[\r\n]/)
  })
})
