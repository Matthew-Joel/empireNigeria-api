import { ConflictException, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common'
import { InspectionConsent, InspectionStatus, PropertyFilePurpose, PropertyFileStatus, PropertyOccupancy, PropertyStatus, UserRole } from '@prisma/client'
import { PropertiesService } from './properties.service'

const owner = { sub: 'owner-id', email: 'owner@example.com', role: UserRole.OWNER }
const manager = { sub: 'manager-id', email: 'manager@example.com', role: UserRole.PROPERTY_MANAGER }
const stranger = { sub: 'other-id', email: 'other@example.com', role: UserRole.OWNER }
const property = { id: 'property-id', ownerId: owner.sub, managerId: manager.sub, status: PropertyStatus.SUBMITTED, files: [] }

function setup() {
  const prisma = {
    property: { findUnique: jest.fn().mockResolvedValue(property), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn() },
    propertyFile: { count: jest.fn().mockResolvedValue(0), create: jest.fn(), findFirst: jest.fn(), delete: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    auditEvent: { create: jest.fn() },
    managerTask: { updateMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'task' }) },
    user: { findUnique: jest.fn().mockResolvedValue({ role: UserRole.PROPERTY_MANAGER, status: 'ACTIVE' }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(prisma))
  const storage = { signUpload: jest.fn().mockResolvedValue('https://storage.example/upload'), download: jest.fn(), move: jest.fn(), signedDownload: jest.fn(), remove: jest.fn() }
  const notifier = { propertySubmitted: jest.fn(), propertyReviewed: jest.fn(), propertyManagerAssigned: jest.fn(), inspectionCoordinationNeeded: jest.fn(), inspectionConsentRecorded: jest.fn(), inspectionConsentRequested: jest.fn() }
  return { service: new PropertiesService(prisma as never, storage as never, notifier as never), prisma, storage, notifier }
}

describe('PropertiesService', () => {
  it('signs a document for inline viewing only when explicitly requested', async () => {
    const { service, prisma, storage } = setup()
    prisma.propertyFile.findFirst.mockResolvedValue({ objectKey: 'properties/property-id/document', purpose: PropertyFilePurpose.DOCUMENT })
    storage.signedDownload.mockResolvedValue('https://storage.example/document')
    await service.fileUrl(property.id, 'file-id', owner, 'false')
    expect(storage.signedDownload).toHaveBeenCalledWith('properties/property-id/document', false)
    await expect(service.fileUrl(property.id, 'file-id', owner, 'invalid')).rejects.toBeInstanceOf(BadRequestException)
  })
  it('only allows valid admin review transitions', async () => {
    const admin = { sub: 'admin-id', email: 'admin@example.com', role: UserRole.ADMIN }
    const { service, prisma } = setup()
    prisma.property.update.mockResolvedValue({ ...property, status: PropertyStatus.UNDER_REVIEW })
    Object.assign(prisma, { auditEvent: { create: jest.fn() } })
    await expect(service.review(property.id, { status: PropertyStatus.APPROVED } as never, admin)).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.review(property.id, { status: PropertyStatus.UNDER_REVIEW } as never, admin)).resolves.toBeDefined()
    prisma.property.findUnique.mockResolvedValue({ ...property, status: PropertyStatus.APPROVED })
    await expect(service.review(property.id, { status: PropertyStatus.UNDER_REVIEW } as never, admin)).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.review(property.id, { status: PropertyStatus.CHANGES_REQUESTED } as never, admin)).resolves.toBeDefined()
  })

  it('notifies after a successful review but not after a rejected transition', async () => {
    const admin = { sub: 'admin-id', email: 'admin@example.com', role: UserRole.ADMIN }
    const { service, prisma, notifier } = setup()
    prisma.property.update.mockResolvedValue({ ...property, status: PropertyStatus.UNDER_REVIEW })
    await expect(service.review(property.id, { status: PropertyStatus.APPROVED } as never, admin)).rejects.toBeInstanceOf(BadRequestException)
    expect(notifier.propertyReviewed).not.toHaveBeenCalled()
    await service.review(property.id, { status: PropertyStatus.UNDER_REVIEW } as never, admin)
    expect(notifier.propertyReviewed).toHaveBeenCalledWith(property.id, admin.sub)
  })

  describe('inspection consent', () => {
    const admin = { sub: 'admin-id', email: 'admin@example.com', role: UserRole.ADMIN }
    const pending = { ...property, status: PropertyStatus.INSPECTION_PENDING, inspectionConsent: InspectionConsent.NOT_RECORDED, inspectionConsentRequestedAt: null, inspections: [] }

    function consentSetup(record: object = pending) {
      const made = setup()
      made.prisma.property.findUnique.mockResolvedValue(record)
      made.prisma.property.update.mockImplementation(async ({ data }: { data: object }) => ({ ...record, ...data }))
      return made
    }

    it('lets the owner answer without a note and tells staff', async () => {
      const { service, prisma, notifier } = consentSetup()
      const result = await service.recordInspectionConsent(property.id, { response: InspectionConsent.GRANTED }, owner)
      expect(prisma.property.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ inspectionConsent: InspectionConsent.GRANTED, inspectionConsentNote: null }) }))
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'PROPERTY_INSPECTION_CONSENT_RECORDED' }) })
      expect(notifier.inspectionConsentRecorded).toHaveBeenCalledWith(property.id, owner.sub)
      expect(result.inspectionReadiness?.stage).toBe('READY_TO_SCHEDULE')
    })

    it('does nothing when the same answer is recorded again', async () => {
      const { service, prisma, notifier } = consentSetup({ ...pending, inspectionConsent: InspectionConsent.GRANTED })
      await service.recordInspectionConsent(property.id, { response: InspectionConsent.GRANTED }, owner)
      expect(prisma.property.update).not.toHaveBeenCalled()
      expect(notifier.inspectionConsentRecorded).not.toHaveBeenCalled()
    })

    it('needs a note when staff record the answer, and only for properties they can see', async () => {
      const { service, prisma } = consentSetup()
      await expect(service.recordInspectionConsent(property.id, { response: InspectionConsent.GRANTED }, manager)).rejects.toBeInstanceOf(BadRequestException)
      await expect(service.recordInspectionConsent(property.id, { response: InspectionConsent.GRANTED, note: 'too short' }, admin)).rejects.toBeInstanceOf(BadRequestException)
      await expect(service.recordInspectionConsent(property.id, { response: InspectionConsent.GRANTED, note: 'Owner agreed by phone on Monday' }, { ...manager, sub: 'another-manager' })).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.property.update).not.toHaveBeenCalled()
      await service.recordInspectionConsent(property.id, { response: InspectionConsent.GRANTED, note: 'Owner agreed by phone on Monday' }, manager)
      expect(prisma.property.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ inspectionConsentNote: 'Owner agreed by phone on Monday' }) }))
    })

    it('refuses to withdraw consent while a visit is scheduled', async () => {
      const { service, prisma } = consentSetup({ ...pending, inspectionConsent: InspectionConsent.GRANTED, inspections: [{ id: 'visit', status: InspectionStatus.SCHEDULED }] })
      await expect(service.recordInspectionConsent(property.id, { response: InspectionConsent.DISCUSSION_REQUESTED }, owner)).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.property.update).not.toHaveBeenCalled()
    })

    it('lets staff request consent, stamping only the first request, and nobody else', async () => {
      const { service, prisma, notifier } = consentSetup()
      await expect(service.requestInspectionConsent(property.id, owner)).rejects.toBeInstanceOf(ForbiddenException)
      await service.requestInspectionConsent(property.id, manager)
      expect(prisma.property.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { inspectionConsentRequestedAt: expect.any(Date) } }))
      expect(notifier.inspectionConsentRequested).toHaveBeenCalledWith(property.id, manager.sub)
      const again = consentSetup({ ...pending, inspectionConsentRequestedAt: new Date('2026-10-26') })
      await again.service.requestInspectionConsent(property.id, admin)
      expect(again.prisma.property.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: {} }))
    })

    it('will not request consent too early or after it was given', async () => {
      await expect(consentSetup({ ...pending, status: PropertyStatus.SUBMITTED }).service.requestInspectionConsent(property.id, admin)).rejects.toBeInstanceOf(BadRequestException)
      await expect(consentSetup({ ...pending, inspectionConsent: InspectionConsent.GRANTED }).service.requestInspectionConsent(property.id, admin)).rejects.toBeInstanceOf(ConflictException)
    })

    it('stores consent given in the sign-up form and keeps review status when it changes later', async () => {
      const made = setup()
      const draft = { name: 'Home', type: 'Apartment', description: 'Description of the home', address: '12 Main Street', city: 'Lagos', state: 'Lagos', country: 'Nigeria', occupancyStatus: PropertyOccupancy.VACANT }
      await made.service.create({ ...draft, inspectionConsent: InspectionConsent.GRANTED } as never, owner)
      expect(made.prisma.property.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ inspectionConsent: InspectionConsent.GRANTED, inspectionConsentById: owner.sub }) }))

      const same = { ...property, ...draft, tenantName: null, tenantPhone: null, tenancyStart: null, ownershipProofRequired: true, inspectionConsent: InspectionConsent.NOT_RECORDED, inspections: [] }
      const later = consentSetup(same)
      await later.service.update(property.id, { ...draft, inspectionConsent: InspectionConsent.GRANTED } as never, owner)
      const data = later.prisma.property.update.mock.calls[0][0].data
      expect(data).toMatchObject({ inspectionConsent: InspectionConsent.GRANTED })
      expect(data).not.toHaveProperty('status')
      await expect(later.service.update(property.id, { ...draft, inspectionConsent: InspectionConsent.DISCUSSION_REQUESTED } as never, admin)).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('stamps readiness and raises one coordination task when a property moves to inspection pending', async () => {
      const { service, prisma, notifier } = consentSetup({ ...pending, status: PropertyStatus.UNDER_REVIEW, ownershipProofRequired: false })
      await service.review(property.id, { status: PropertyStatus.INSPECTION_PENDING } as never, admin)
      expect(prisma.property.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ inspectionReadyAt: expect.any(Date) }) }))
      expect(prisma.managerTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ propertyId: property.id, managerId: manager.sub, kind: 'INSPECTION_COORDINATION', dueAt: expect.any(Date) }) })
      expect(notifier.inspectionCoordinationNeeded).toHaveBeenCalledWith(property.id, admin.sub)
    })

    it('does not raise a second task, and moves an open one to a newly assigned manager', async () => {
      const { service, prisma, notifier } = consentSetup({ ...pending })
      prisma.managerTask.findFirst.mockResolvedValue({ id: 'open-task' })
      await service.assignManager(property.id, { managerId: manager.sub }, admin)
      expect(prisma.managerTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { managerId: manager.sub } }))
      expect(prisma.managerTask.create).not.toHaveBeenCalled()
      expect(notifier.inspectionCoordinationNeeded).toHaveBeenCalled()
    })

    it('raises no task when the property has no manager', async () => {
      const { service, prisma } = consentSetup({ ...pending, status: PropertyStatus.UNDER_REVIEW, managerId: null, ownershipProofRequired: false })
      await service.review(property.id, { status: PropertyStatus.INSPECTION_PENDING } as never, admin)
      expect(prisma.managerTask.create).not.toHaveBeenCalled()
    })
  })

  it('scopes the list to the owner or assigned manager', async () => {
    const { service, prisma } = setup()
    await service.list(owner)
    expect(prisma.property.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: owner.sub } }))
    await service.list(manager)
    expect(prisma.property.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { managerId: manager.sub, status: { not: PropertyStatus.DRAFT } } }))
  })

  it('hides another owner property and prevents manager editing', async () => {
    const { service } = setup()
    await expect(service.get(property.id, stranger)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.update(property.id, {} as never, manager)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('creates a property owned by the caller and ignores supplied ownership', async () => {
    const { service, prisma } = setup()
    const draft = { name: 'Home', type: 'Apartment', description: 'Description of the home', address: '12 Main Street', city: 'Lagos', state: 'Lagos', country: 'Nigeria', occupancyStatus: PropertyOccupancy.VACANT, ownerId: stranger.sub }
    await service.create(draft as never, owner)
    expect(prisma.property.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerId: owner.sub }) }))
  })

  it('issues a signed upload only for an accessible property', async () => {
    const { service, prisma, storage } = setup()
    prisma.propertyFile.create.mockResolvedValue({ id: 'file-id' })
    await expect(service.startUpload(property.id, { purpose: PropertyFilePurpose.PHOTO, fileName: 'home.png', contentType: 'image/png', sizeBytes: 20 }, stranger)).rejects.toBeInstanceOf(NotFoundException)
    await service.startUpload(property.id, { purpose: PropertyFilePurpose.PHOTO, fileName: 'home.png', contentType: 'image/png', sizeBytes: 20 }, owner)
    expect(storage.signUpload).toHaveBeenCalledTimes(1)
  })

  it('rejects mismatched uploaded bytes before publishing a file', async () => {
    const { service, prisma, storage } = setup()
    prisma.propertyFile.findFirst.mockResolvedValue({ id: 'file-id', propertyId: property.id, uploaderId: owner.sub, status: PropertyFileStatus.PENDING, objectKey: 'pending/key', contentType: 'image/png', sizeBytes: 5, createdAt: new Date() })
    storage.download.mockResolvedValue(Buffer.from('hello'))
    await expect(service.completeUpload(property.id, 'file-id', owner)).rejects.toBeInstanceOf(BadRequestException)
    expect(storage.move).not.toHaveBeenCalled()
  })

  it('rechecks an expired pending upload after acquiring its row lock', async () => {
    const { service, prisma, storage } = setup()
    prisma.propertyFile.findFirst.mockResolvedValue({ id: 'file-id', propertyId: property.id, uploaderId: owner.sub, status: PropertyFileStatus.PENDING, createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) })
    await expect(service.completeUpload(property.id, 'file-id', owner)).rejects.toThrow('Upload expired')
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    expect(storage.download).not.toHaveBeenCalled()
  })

  it('publishes valid uploaded bytes and makes the new photo the cover', async () => {
    const { service, prisma, storage } = setup()
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    prisma.propertyFile.findFirst.mockResolvedValue({ id: 'file-id', propertyId: property.id, uploaderId: owner.sub, status: PropertyFileStatus.PENDING, objectKey: 'pending/key', contentType: 'image/png', sizeBytes: png.length, createdAt: new Date(), isCover: true })
    storage.download.mockResolvedValue(png)
    await expect(service.completeUpload(property.id, 'file-id', owner)).resolves.toEqual({ ...property, inspectionReadiness: null })
    expect(storage.move).toHaveBeenCalledWith('pending/key', 'properties/property-id/file-id')
    expect(prisma.propertyFile.updateMany).toHaveBeenCalledWith({ where: { propertyId: property.id, purpose: PropertyFilePurpose.PHOTO, status: PropertyFileStatus.READY }, data: { isCover: false } })
    expect(prisma.propertyFile.update).toHaveBeenCalledWith({ where: { id: 'file-id' }, data: { objectKey: 'properties/property-id/file-id', status: PropertyFileStatus.READY, completedAt: expect.any(Date) } })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('returns an already-ready file without downloading or moving it again', async () => {
    const { service, prisma, storage } = setup()
    prisma.propertyFile.findFirst.mockResolvedValue({ id: 'file-id', propertyId: property.id, status: PropertyFileStatus.READY })
    await expect(service.completeUpload(property.id, 'file-id', owner)).resolves.toEqual({ ...property, inspectionReadiness: null })
    expect(storage.download).not.toHaveBeenCalled()
    expect(storage.move).not.toHaveBeenCalled()
  })
})
