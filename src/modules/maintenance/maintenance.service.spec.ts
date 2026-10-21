import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { MaintenanceEvidenceKind, MaintenanceEvidenceStatus, MaintenanceQuoteStatus, MaintenanceStatus, PropertyStatus, UserRole, UserStatus } from '@prisma/client'
import { MaintenanceService } from './maintenance.service'

const owner = { sub: 'owner', email: 'owner@example.com', role: UserRole.OWNER }
const manager = { sub: 'manager', email: 'manager@example.com', role: UserRole.PROPERTY_MANAGER }
const contractor = { sub: 'contractor', email: 'contractor@example.com', role: UserRole.CONTRACTOR }
const admin = { sub: 'admin', email: 'admin@example.com', role: UserRole.ADMIN }
const record = {
  id: 'request', propertyId: 'property', contractorId: contractor.sub, issue: 'Leak', description: 'The kitchen pipe is leaking.',
  priority: 'HIGH', status: MaintenanceStatus.REPORTED, assignmentNote: null, reportedAt: new Date(), updatedAt: new Date(), completedAt: null, closedAt: null,
  property: { id: 'property', name: 'Home', address: '1 Street', city: 'Lagos', state: 'Lagos', ownerId: owner.sub, managerId: manager.sub, owner: { email: owner.email } },
  contractor: { id: contractor.sub, email: contractor.email, profile: null }, updates: [], evidence: [], quotes: [],
}

function setup() {
  const prisma = {
    maintenanceRequest: { findUnique: jest.fn().mockResolvedValue(record), findMany: jest.fn().mockResolvedValue([record]), create: jest.fn().mockResolvedValue(record), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    property: { findUnique: jest.fn().mockResolvedValue({ ownerId: owner.sub, status: PropertyStatus.SUBMITTED }) },
    user: { findUnique: jest.fn().mockResolvedValue({ role: UserRole.CONTRACTOR, status: UserStatus.ACTIVE }) },
    maintenanceUpdate: { create: jest.fn() },
    maintenanceQuote: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { create: jest.fn() },
    maintenanceEvidence: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'evidence' }), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(prisma))
  const storage = { signUpload: jest.fn().mockResolvedValue('https://storage.example/upload'), download: jest.fn(), move: jest.fn(), signedDownload: jest.fn(), remove: jest.fn() }
  return { service: new MaintenanceService(prisma as never, storage as never), prisma, storage }
}

describe('MaintenanceService', () => {
  it('scopes each role to owned, managed, or assigned requests', async () => {
    const { service, prisma } = setup()
    await service.list(owner)
    expect(prisma.maintenanceRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { property: { is: { ownerId: owner.sub } } } }))
    await service.list(manager)
    expect(prisma.maintenanceRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { property: { is: { managerId: manager.sub } } } }))
    await service.list(contractor)
    expect(prisma.maintenanceRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { contractorId: contractor.sub } }))
    await expect(service.get('request', { ...owner, sub: 'stranger' })).rejects.toBeInstanceOf(NotFoundException)
  })

  it('allows only the property owner to create a request', async () => {
    const { service, prisma } = setup()
    const dto = { propertyId: 'property', issue: 'Leak', description: 'The kitchen pipe is leaking.', priority: 'HIGH' }
    await expect(service.create(dto as never, manager)).rejects.toBeInstanceOf(ForbiddenException)
    await service.create(dto as never, owner)
    expect(prisma.maintenanceRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ propertyId: 'property', priority: 'HIGH' }) }))
  })

  it('requires an active contractor for assignment', async () => {
    const { service, prisma } = setup()
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.CONTRACTOR, status: UserStatus.INVITED })
    await expect(service.assign('request', { contractorId: 'contractor', note: 'Please repair the kitchen pipe.' }, admin)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.maintenanceRequest.updateMany).not.toHaveBeenCalled()
  })

  it('rejects maintenance on an unfinished property draft before creating or auditing a request', async () => {
    const { service, prisma } = setup()
    prisma.property.findUnique.mockResolvedValue({ ownerId: owner.sub, status: PropertyStatus.DRAFT })
    await expect(service.create({ propertyId: 'property', issue: 'Leak', description: 'The kitchen pipe is leaking.', priority: 'HIGH' } as never, owner)).rejects.toThrow('Submit the property')
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.maintenanceRequest.create).not.toHaveBeenCalled()
    expect(prisma.auditEvent.create).not.toHaveBeenCalled()
  })

  it('rejects unauthorized or out-of-order progress', async () => {
    const { service, prisma } = setup()
    await expect(service.start('request', { note: 'I am starting the repair.' }, owner)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.progress('request', { note: 'I have inspected the pipe.' }, contractor)).rejects.toBeInstanceOf(ConflictException)
    prisma.maintenanceRequest.findUnique.mockResolvedValue({ ...record, status: MaintenanceStatus.IN_PROGRESS })
    await expect(service.complete('request', { note: 'The pipe repair is complete.' }, contractor)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.maintenanceEvidence.count).toHaveBeenCalledWith({ where: { requestId: 'request', status: MaintenanceEvidenceStatus.READY, kind: MaintenanceEvidenceKind.COMPLETION } })
  })

  it('requires owner approval before the assigned contractor can start', async () => {
    const { service, prisma } = setup()
    prisma.maintenanceRequest.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(service.start('request', { note: 'I am starting the repair.' }, contractor)).rejects.toBeInstanceOf(ConflictException)
    prisma.maintenanceRequest.findUnique.mockResolvedValue({ ...record, status: MaintenanceStatus.APPROVED })
    await service.start('request', { note: 'I am starting the repair.' }, contractor)
    expect(prisma.maintenanceRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: MaintenanceStatus.APPROVED, contractorId: contractor.sub }), data: expect.objectContaining({ status: MaintenanceStatus.IN_PROGRESS }) }))
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'MAINTENANCE_IN_PROGRESS' }) }))
  })

  it('lets only the assigned contractor quote and the owner decide the latest quote', async () => {
    const { service, prisma } = setup()
    const quoteDto = { amountNgn: 25000, scope: 'Replace the leaking kitchen pipe.', expectedDurationDays: 2, notes: 'Parts and labour are included.' }
    prisma.maintenanceRequest.findUnique.mockResolvedValue({ ...record, status: MaintenanceStatus.ASSIGNED })
    await expect(service.submitQuote('request', quoteDto, owner)).rejects.toBeInstanceOf(ForbiddenException)
    await service.submitQuote('request', quoteDto, contractor)
    expect(prisma.maintenanceQuote.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revision: 1, amountNgn: 25000, contractorId: contractor.sub }) }))
    const pending = { ...record, status: MaintenanceStatus.PENDING_APPROVAL, quotes: [{ id: 'quote-1', status: MaintenanceQuoteStatus.SUBMITTED }] }
    prisma.maintenanceRequest.findUnique.mockResolvedValue(pending)
    await expect(service.decideQuote('request', 'quote-1', { decision: 'REJECT', note: '' }, owner)).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.decideQuote('request', 'quote-1', { decision: 'APPROVE' }, contractor)).rejects.toBeInstanceOf(ForbiddenException)
    await service.decideQuote('request', 'quote-1', { decision: 'APPROVE' }, owner)
    expect(prisma.maintenanceQuote.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'quote-1', status: MaintenanceQuoteStatus.SUBMITTED }), data: expect.objectContaining({ status: MaintenanceQuoteStatus.APPROVED }) }))
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'MAINTENANCE_QUOTE_APPROVED' }) }))
  })

  it('rejects unsupported evidence before signing an upload', async () => {
    const { service, prisma, storage } = setup()
    prisma.maintenanceRequest.findUnique.mockResolvedValue({ ...record, status: MaintenanceStatus.IN_PROGRESS })
    await expect(service.startEvidence('request', { type: 'PHOTO', kind: 'WORK', fileName: 'bad.svg', caption: 'Bad image', contentType: 'image/svg+xml', sizeBytes: 100 } as never, contractor)).rejects.toBeInstanceOf(BadRequestException)
    expect(storage.signUpload).not.toHaveBeenCalled()
  })

  it('restricts evidence URLs to authorized request viewers', async () => {
    const { service, prisma, storage } = setup()
    await expect(service.evidenceUrl('request', 'evidence', { ...owner, sub: 'stranger' })).rejects.toBeInstanceOf(NotFoundException)
    prisma.maintenanceEvidence.findFirst.mockResolvedValue({ id: 'evidence', type: 'PHOTO', objectKey: 'maintenance/request/evidence' })
    storage.signedDownload.mockResolvedValue('https://storage.example/photo')
    await service.evidenceUrl('request', 'evidence', owner)
    expect(storage.signedDownload).toHaveBeenCalledWith('maintenance/request/evidence', false)
  })

  it('does not complete pending evidence after the maintenance request is closed', async () => {
    const { service, prisma, storage } = setup()
    prisma.maintenanceRequest.findUnique.mockResolvedValue({ ...record, status: MaintenanceStatus.CLOSED })
    prisma.maintenanceEvidence.findFirst.mockResolvedValue({ id: 'evidence', status: MaintenanceEvidenceStatus.PENDING, uploaderId: owner.sub, kind: MaintenanceEvidenceKind.ISSUE })
    await expect(service.completeEvidence('request', 'evidence', owner)).rejects.toThrow(ForbiddenException)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    expect(storage.download).not.toHaveBeenCalled()
    expect(prisma.maintenanceEvidence.update).not.toHaveBeenCalled()
  })

  it('does not publish evidence or an audit event when bytes disagree with the declared type', async () => {
    const { service, prisma, storage } = setup()
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    prisma.maintenanceRequest.findUnique.mockResolvedValue({ ...record, status: MaintenanceStatus.IN_PROGRESS })
    prisma.maintenanceEvidence.findFirst.mockResolvedValue({ id: 'evidence', status: MaintenanceEvidenceStatus.PENDING, uploaderId: contractor.sub, kind: MaintenanceEvidenceKind.WORK, createdAt: new Date(), contentType: 'application/pdf', sizeBytes: png.length, objectKey: 'pending/maintenance/evidence' })
    storage.download.mockResolvedValue(png)
    await expect(service.completeEvidence('request', 'evidence', contractor)).rejects.toThrow(BadRequestException)
    expect(storage.move).not.toHaveBeenCalled()
    expect(prisma.maintenanceEvidence.update).not.toHaveBeenCalled()
    expect(prisma.auditEvent.create).not.toHaveBeenCalled()
  })

  it('publishes valid work evidence and its audit event for the assigned contractor', async () => {
    const { service, prisma, storage } = setup()
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    prisma.maintenanceRequest.findUnique.mockResolvedValue({ ...record, status: MaintenanceStatus.IN_PROGRESS })
    prisma.maintenanceEvidence.findFirst.mockResolvedValue({ id: 'evidence', status: MaintenanceEvidenceStatus.PENDING, uploaderId: contractor.sub, kind: MaintenanceEvidenceKind.WORK, createdAt: new Date(), contentType: 'image/png', sizeBytes: png.length, objectKey: 'pending/maintenance/evidence' })
    storage.download.mockResolvedValue(png)
    await service.completeEvidence('request', 'evidence', contractor)
    expect(storage.move).toHaveBeenCalledWith('pending/maintenance/evidence', 'maintenance/request/evidence')
    expect(prisma.maintenanceEvidence.update).toHaveBeenCalledWith({ where: { id: 'evidence' }, data: { objectKey: 'maintenance/request/evidence', status: MaintenanceEvidenceStatus.READY, completedAt: expect.any(Date) } })
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: contractor.sub, action: 'MAINTENANCE_EVIDENCE_ADDED', entityId: 'request' }) }))
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })
})
