import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common'
import { PropertyFilePurpose, PropertyFileStatus, PropertyOccupancy, PropertyStatus, UserRole } from '@prisma/client'
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
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(prisma))
  const storage = { signUpload: jest.fn().mockResolvedValue('https://storage.example/upload'), download: jest.fn(), move: jest.fn(), signedDownload: jest.fn(), remove: jest.fn() }
  return { service: new PropertiesService(prisma as never, storage as never), prisma, storage }
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
    await expect(service.completeUpload(property.id, 'file-id', owner)).resolves.toEqual(property)
    expect(storage.move).toHaveBeenCalledWith('pending/key', 'properties/property-id/file-id')
    expect(prisma.propertyFile.updateMany).toHaveBeenCalledWith({ where: { propertyId: property.id, purpose: PropertyFilePurpose.PHOTO, status: PropertyFileStatus.READY }, data: { isCover: false } })
    expect(prisma.propertyFile.update).toHaveBeenCalledWith({ where: { id: 'file-id' }, data: { objectKey: 'properties/property-id/file-id', status: PropertyFileStatus.READY, completedAt: expect.any(Date) } })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('returns an already-ready file without downloading or moving it again', async () => {
    const { service, prisma, storage } = setup()
    prisma.propertyFile.findFirst.mockResolvedValue({ id: 'file-id', propertyId: property.id, status: PropertyFileStatus.READY })
    await expect(service.completeUpload(property.id, 'file-id', owner)).resolves.toEqual(property)
    expect(storage.download).not.toHaveBeenCalled()
    expect(storage.move).not.toHaveBeenCalled()
  })
})
