import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { InspectionConsent, InspectionEvidenceStatus, InspectionStatus, PropertyOccupancy, PropertyStatus, UserRole, UserStatus } from '@prisma/client'
import { InspectionsService } from './inspections.service'

const owner = { sub: 'owner', email: 'owner@example.com', role: UserRole.OWNER }
const manager = { sub: 'manager', email: 'manager@example.com', role: UserRole.PROPERTY_MANAGER }
const inspector = { sub: 'inspector', email: 'inspector@example.com', role: UserRole.INSPECTOR }
const admin = { sub: 'admin', email: 'admin@example.com', role: UserRole.ADMIN }
const record = {
  id: 'visit', propertyId: 'home', inspectorId: inspector.sub, status: InspectionStatus.SCHEDULED,
  purpose: 'Routine visit', summary: 'Inspect the property condition', scheduledAt: new Date('2030-01-01'),
  completedAt: null, createdAt: new Date(), updatedAt: new Date(),
  accessConfirmedAt: new Date(), accessContact: 'Caretaker', occupantAuthorised: false, accessNote: null,
  property: { id: 'home', name: 'Home', address: '1 Main Street', city: 'Lagos', state: 'Lagos', ownerId: owner.sub, managerId: manager.sub, occupancyStatus: PropertyOccupancy.VACANT, inspectionConsent: InspectionConsent.GRANTED, inspectionConsentAt: new Date(), owner: { email: owner.email } },
  inspector: { id: inspector.sub, email: inspector.email, profile: null },
  report: { id: 'report', submittedAt: new Date(), overview: 'The property condition is good.', recommendations: ['Keep it clean'], findings: [] },
  evidence: [{ id: 'evidence', originalName: 'photo.png', type: 'PHOTO', caption: 'Front', completedAt: new Date(), createdAt: new Date(), contentType: 'image/png', sizeBytes: 20 }],
}

function setup() {
  const prisma = {
    inspection: { findUnique: jest.fn().mockResolvedValue(record), findMany: jest.fn().mockResolvedValue([record]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(record), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    property: { findUnique: jest.fn().mockResolvedValue({ status: PropertyStatus.APPROVED, managerId: manager.sub, inspectionConsent: InspectionConsent.GRANTED }) },
    managerTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: { findUnique: jest.fn().mockResolvedValue({ role: UserRole.INSPECTOR, status: UserStatus.ACTIVE }), findMany: jest.fn().mockResolvedValue([]) },
    inspectionEvidence: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'evidence' }), findFirst: jest.fn(), delete: jest.fn(), update: jest.fn() },
    auditEvent: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(prisma))
  const storage = { signUpload: jest.fn().mockResolvedValue('https://storage.example/upload'), download: jest.fn(), move: jest.fn(), signedDownload: jest.fn(), remove: jest.fn() }
  const notifier = { inspectionScheduled: jest.fn(), inspectionRescheduled: jest.fn(), inspectionCancelled: jest.fn(), inspectionProgress: jest.fn(), inspectionReportReady: jest.fn(), inspectionAccessConfirmed: jest.fn() }
  return { service: new InspectionsService(prisma as never, storage as never, notifier as never), prisma, storage, notifier }
}

describe('InspectionsService', () => {
  it('scopes each role to its property or assignment', async () => {
    const { service, prisma } = setup()
    await service.list(owner)
    expect(prisma.inspection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { property: { is: { ownerId: owner.sub } } } }))
    await service.list(manager)
    expect(prisma.inspection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { property: { is: { managerId: manager.sub } } } }))
    await service.list(inspector)
    expect(prisma.inspection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { inspectorId: inspector.sub } }))
    await expect(service.get('visit', { ...owner, sub: 'stranger' })).rejects.toBeInstanceOf(NotFoundException)
  })

  it('keeps report and evidence private until submission', async () => {
    const { service, prisma } = setup()
    const before = await service.get('visit', owner)
    expect(before.report).toBeNull()
    expect(before.evidence).toEqual([])
    prisma.inspection.findUnique.mockResolvedValue({ ...record, status: InspectionStatus.REPORT_READY })
    const after = await service.get('visit', owner)
    expect(after.report?.id).toBe('report')
    expect(after.evidence).toHaveLength(1)
  })

  it('notifies after scheduling, and not when an active inspection already exists', async () => {
    const dto = { propertyId: 'home', inspectorId: 'inspector', purpose: 'Routine', summary: 'Inspect the home', scheduledAt: '2030-01-01T00:00:00Z' }
    const { service, prisma, notifier } = setup()
    prisma.inspection.findFirst.mockResolvedValue({ id: 'existing' })
    await expect(service.schedule(dto, admin)).rejects.toBeInstanceOf(ConflictException)
    expect(notifier.inspectionScheduled).not.toHaveBeenCalled()
    prisma.inspection.findFirst.mockResolvedValue(null)
    await service.schedule(dto, admin)
    expect(notifier.inspectionScheduled).toHaveBeenCalledWith('visit', admin.sub)
  })

  it('notifies about a submitted report only once it is stored', async () => {
    const { service, prisma, notifier } = setup()
    const dto = { overview: 'The property condition is good.', recommendations: ['Keep it clean'], findings: [] }
    prisma.inspection.findUnique.mockResolvedValue({ ...record, status: InspectionStatus.COMPLETED })
    prisma.inspection.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.submitReport('visit', dto, inspector)).rejects.toBeInstanceOf(ConflictException)
    expect(notifier.inspectionReportReady).not.toHaveBeenCalled()
  })

  it('will not schedule until the owner has consented', async () => {
    const dto = { propertyId: 'home', inspectorId: 'inspector', purpose: 'Routine', summary: 'Inspect the home', scheduledAt: '2030-01-01T00:00:00Z' }
    const { service, prisma, notifier } = setup()
    for (const inspectionConsent of [InspectionConsent.NOT_RECORDED, InspectionConsent.DISCUSSION_REQUESTED]) {
      prisma.property.findUnique.mockResolvedValue({ status: PropertyStatus.INSPECTION_PENDING, managerId: manager.sub, inspectionConsent })
      await expect(service.schedule(dto, admin)).rejects.toBeInstanceOf(ConflictException)
      await expect(service.schedule(dto, manager)).rejects.toBeInstanceOf(ConflictException)
    }
    expect(prisma.inspection.create).not.toHaveBeenCalled()
    expect(notifier.inspectionScheduled).not.toHaveBeenCalled()
  })

  it('lets only the assigned manager, or an admin, schedule and closes the coordination task', async () => {
    const dto = { propertyId: 'home', inspectorId: 'inspector', purpose: 'Routine', summary: 'Inspect the home', scheduledAt: '2030-01-01T00:00:00Z' }
    const { service, prisma } = setup()
    await expect(service.schedule(dto, { ...manager, sub: 'other-manager' })).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.schedule(dto, owner)).rejects.toThrow()
    await service.schedule(dto, manager)
    expect(prisma.managerTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ propertyId: 'home', kind: 'INSPECTION_COORDINATION' }) }))
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'INSPECTION_SCHEDULED', summary: 'Property manager scheduled an inspection' }) })
  })

  it('confirms access, and insists the occupant authorised an occupied property', async () => {
    const { service, prisma, notifier } = setup()
    prisma.inspection.findUnique.mockResolvedValue({ ...record, accessConfirmedAt: null, property: { ...record.property, occupancyStatus: PropertyOccupancy.OCCUPIED } })
    await expect(service.confirmAccess('visit', { contact: 'Tenant Ada', occupantAuthorised: false }, manager)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.inspection.updateMany).not.toHaveBeenCalled()
    await service.confirmAccess('visit', { contact: 'Tenant Ada', occupantAuthorised: true, note: 'Weekday mornings' }, manager)
    expect(prisma.inspection.updateMany).toHaveBeenCalledWith({ where: { id: 'visit', status: InspectionStatus.SCHEDULED }, data: expect.objectContaining({ accessContact: 'Tenant Ada', occupantAuthorised: true, accessConfirmedById: manager.sub }) })
    expect(notifier.inspectionAccessConfirmed).toHaveBeenCalledWith('visit', manager.sub)
    await expect(service.confirmAccess('visit', { contact: 'Ada', occupantAuthorised: true }, owner)).rejects.toThrow()
    prisma.inspection.findUnique.mockResolvedValue({ ...record, status: InspectionStatus.IN_PROGRESS })
    await expect(service.confirmAccess('visit', { contact: 'Ada', occupantAuthorised: true }, admin)).rejects.toBeInstanceOf(ConflictException)
  })

  it('stops the inspector starting before access is confirmed', async () => {
    const { service, prisma, notifier } = setup()
    prisma.inspection.findUnique.mockResolvedValue({ ...record, accessConfirmedAt: null })
    await expect(service.start('visit', inspector)).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.inspection.updateMany).not.toHaveBeenCalled()
    prisma.inspection.findUnique.mockResolvedValue(record)
    await service.start('visit', inspector)
    expect(notifier.inspectionProgress).toHaveBeenCalledWith('visit', 'started', inspector.sub)
  })

  it('clears access when the date moves, but not when only the inspector changes', async () => {
    const { service, prisma } = setup()
    await service.reschedule('visit', { scheduledAt: '2031-02-02T00:00:00Z' }, manager)
    expect(prisma.inspection.update).toHaveBeenLastCalledWith({ where: { id: 'visit' }, data: expect.objectContaining({ accessConfirmedAt: null, occupantAuthorised: false, accessContact: null }) })
    await service.reschedule('visit', { inspectorId: 'inspector', scheduledAt: record.scheduledAt.toISOString() }, admin)
    const data = prisma.inspection.update.mock.calls.at(-1)?.[0].data
    expect(data).not.toHaveProperty('accessConfirmedAt')
  })

  it('shows the visit and report due dates and the consent and access state', async () => {
    const { service, prisma } = setup()
    const scheduled = await service.get('visit', manager)
    expect(scheduled.consent.status).toBe(InspectionConsent.GRANTED)
    expect(scheduled.access.contact).toBe('Caretaker')
    expect(scheduled.visitDueAt).toBeInstanceOf(Date)
    expect(scheduled.reportDueAt).toBeNull()
    const finished = new Date('2030-01-02T10:00:00Z')
    prisma.inspection.findUnique.mockResolvedValue({ ...record, status: InspectionStatus.COMPLETED, completedAt: finished })
    const completed = await service.get('visit', manager)
    expect(completed.visitDueAt).toBeNull()
    expect(completed.reportDueAt).toEqual(new Date('2030-01-03T10:00:00Z'))
  })

  it('lists active inspectors for staff to choose from', async () => {
    const { service, prisma } = setup()
    await service.inspectors()
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: UserRole.INSPECTOR, status: UserStatus.ACTIVE } }))
  })

  it('prevents duplicate active inspections and invalid status transitions', async () => {
    const { service, prisma } = setup()
    prisma.inspection.findFirst.mockResolvedValue({ id: 'existing' })
    await expect(service.schedule({ propertyId: 'home', inspectorId: 'inspector', purpose: 'Routine', summary: 'Inspect the home', scheduledAt: '2030-01-01T00:00:00Z' }, admin)).rejects.toBeInstanceOf(ConflictException)
    prisma.inspection.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.completeVisit('visit', inspector)).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects unsupported evidence types before issuing storage access', async () => {
    const { service, prisma, storage } = setup()
    prisma.inspection.findUnique.mockResolvedValue({ ...record, status: InspectionStatus.IN_PROGRESS })
    await expect(service.startEvidence('visit', { type: 'PHOTO', fileName: 'bad.svg', caption: 'Bad image', contentType: 'image/svg+xml', sizeBytes: 100 } as never, inspector)).rejects.toBeInstanceOf(BadRequestException)
    expect(storage.signUpload).not.toHaveBeenCalled()
    expect(prisma.inspectionEvidence.create).not.toHaveBeenCalled()
  })

  it('allows the owner to retrieve evidence only after a report is ready', async () => {
    const { service, prisma, storage } = setup()
    await expect(service.evidenceUrl('visit', 'evidence', owner)).rejects.toBeInstanceOf(NotFoundException)
    prisma.inspection.findUnique.mockResolvedValue({ ...record, status: InspectionStatus.REPORT_READY })
    prisma.inspectionEvidence.findFirst.mockResolvedValue({ id: 'evidence', status: InspectionEvidenceStatus.READY, objectKey: 'inspections/visit/evidence', type: 'PHOTO' })
    storage.signedDownload.mockResolvedValue('https://storage.example/photo')
    await service.evidenceUrl('visit', 'evidence', owner)
    expect(storage.signedDownload).toHaveBeenCalledWith('inspections/visit/evidence', false)
  })

  it('does not complete pending evidence after the inspection report has been submitted', async () => {
    const { service, prisma, storage } = setup()
    prisma.inspection.findUnique.mockResolvedValue({ ...record, status: InspectionStatus.REPORT_READY })
    prisma.inspectionEvidence.findFirst.mockResolvedValue({ id: 'evidence', status: InspectionEvidenceStatus.PENDING, uploaderId: inspector.sub })
    await expect(service.completeEvidence('visit', 'evidence', inspector)).rejects.toThrow(ConflictException)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    expect(storage.download).not.toHaveBeenCalled()
    expect(prisma.inspectionEvidence.update).not.toHaveBeenCalled()
  })

  it('does not publish evidence or an audit event when bytes disagree with the declared type', async () => {
    const { service, prisma, storage } = setup()
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    prisma.inspection.findUnique.mockResolvedValue({ ...record, status: InspectionStatus.IN_PROGRESS })
    prisma.inspectionEvidence.findFirst.mockResolvedValue({ id: 'evidence', status: InspectionEvidenceStatus.PENDING, uploaderId: inspector.sub, createdAt: new Date(), contentType: 'application/pdf', sizeBytes: png.length, objectKey: 'pending/inspection/evidence' })
    storage.download.mockResolvedValue(png)
    await expect(service.completeEvidence('visit', 'evidence', inspector)).rejects.toThrow(BadRequestException)
    expect(storage.move).not.toHaveBeenCalled()
    expect(prisma.inspectionEvidence.update).not.toHaveBeenCalled()
    expect(prisma.auditEvent.create).not.toHaveBeenCalled()
  })

  it('publishes valid evidence and its audit event for the assigned inspector', async () => {
    const { service, prisma, storage } = setup()
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    prisma.inspection.findUnique.mockResolvedValue({ ...record, status: InspectionStatus.IN_PROGRESS })
    prisma.inspectionEvidence.findFirst.mockResolvedValue({ id: 'evidence', status: InspectionEvidenceStatus.PENDING, uploaderId: inspector.sub, createdAt: new Date(), contentType: 'image/png', sizeBytes: png.length, objectKey: 'pending/inspection/evidence' })
    storage.download.mockResolvedValue(png)
    await service.completeEvidence('visit', 'evidence', inspector)
    expect(storage.move).toHaveBeenCalledWith('pending/inspection/evidence', 'inspections/visit/evidence')
    expect(prisma.inspectionEvidence.update).toHaveBeenCalledWith({ where: { id: 'evidence' }, data: { objectKey: 'inspections/visit/evidence', status: InspectionEvidenceStatus.READY, completedAt: expect.any(Date) } })
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: inspector.sub, action: 'INSPECTION_EVIDENCE_ADDED', entityId: 'visit' }) }))
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })
})
