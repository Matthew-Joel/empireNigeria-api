import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { OwnershipDocumentType, PropertyFilePurpose, PropertyFileStatus, PropertyOccupancy, PropertyStatus, UserRole } from '@prisma/client'
import { validate } from 'class-validator'
import { PropertiesService } from './properties.service'
import { StartPropertyUploadDto } from './dto/property.dto'

const owner = { sub: 'owner-id', email: 'owner@example.com', role: UserRole.OWNER }
const admin = { sub: 'admin-id', email: 'admin@example.com', role: UserRole.ADMIN }
const manager = { sub: 'manager-id', email: 'manager@example.com', role: UserRole.PROPERTY_MANAGER }
const stranger = { sub: 'other-id', email: 'other@example.com', role: UserRole.OWNER }
const draft = { name: 'Test home', type: 'Apartment', description: 'A complete property description', address: '12 Main Street', city: 'Lagos', state: 'Lagos', country: 'Nigeria', occupancyStatus: PropertyOccupancy.VACANT }
const proof = { id: 'proof-id', purpose: PropertyFilePurpose.DOCUMENT, ownershipDocumentType: OwnershipDocumentType.DEED_OF_ASSIGNMENT }

function setup(status: PropertyStatus = PropertyStatus.DRAFT, files: unknown[] = [], ownershipProofRequired = true) {
  const record = { id: 'property-id', ownerId: owner.sub, managerId: manager.sub, status, files, ownershipProofRequired }
  const prisma = {
    property: {
      findUnique: jest.fn().mockImplementation(async () => record), findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async ({ data }) => ({ ...record, ...data })),
      update: jest.fn().mockImplementation(async ({ data }) => Object.assign(record, data)),
    },
    propertyFile: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'proof-id' }), findFirst: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    auditEvent: { create: jest.fn() }, $queryRaw: jest.fn().mockResolvedValue([]), $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(prisma))
  const storage = { signUpload: jest.fn().mockResolvedValue('https://storage.example/upload'), download: jest.fn(), move: jest.fn(), signedDownload: jest.fn(), remove: jest.fn() }
  return { service: new PropertiesService(prisma as never, storage as never), prisma, storage, record }
}

describe('Required property ownership evidence', () => {
  it('always creates a draft with server-owned proof requirements', async () => {
    const { service, prisma } = setup()
    await service.create({ ...draft, ownershipProofRequired: false, status: PropertyStatus.APPROVED } as never, owner)
    expect(prisma.property.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: PropertyStatus.DRAFT, ownershipProofRequired: true, ownerId: owner.sub }) }))
  })

  it.each([{ files: [] }, { files: [{ ...proof, ownershipDocumentType: null }] }, { files: [{ ...proof, purpose: PropertyFilePurpose.PHOTO }] }])('rejects final submission without qualifying completed proof: %j', async ({ files }) => {
    const { service, prisma } = setup(PropertyStatus.DRAFT, files)
    await expect(service.submit('property-id', owner)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.property.update).not.toHaveBeenCalled()
    expect(prisma.auditEvent.create).not.toHaveBeenCalled()
  })

  it('requires READY files in the property query, excluding pending uploads', async () => {
    const { service, prisma } = setup()
    await expect(service.submit('property-id', owner)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.property.findUnique).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ files: expect.objectContaining({ where: { status: PropertyFileStatus.READY } }) }) }))
  })

  it('submits completed proof once and safely repeats a lost submission response', async () => {
    const { service, prisma, record } = setup(PropertyStatus.DRAFT, [proof])
    await service.submit(record.id, owner)
    await service.submit(record.id, owner)
    expect(record.status).toBe(PropertyStatus.SUBMITTED)
    expect(prisma.property.update).toHaveBeenCalledTimes(1)
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('does not rewind an administrator review when final submission is retried', async () => {
    const { service, prisma } = setup(PropertyStatus.UNDER_REVIEW, [proof])
    expect(await service.submit('property-id', owner)).toEqual(expect.objectContaining({ status: PropertyStatus.UNDER_REVIEW }))
    expect(prisma.property.update).not.toHaveBeenCalled()
  })

  it('hides drafts from assigned managers and unrelated owners', async () => {
    const { service } = setup()
    await expect(service.get('property-id', manager)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.submit('property-id', stranger)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('prevents managers from submitting a property they can otherwise read', async () => {
    const { service } = setup(PropertyStatus.CHANGES_REQUESTED, [proof])
    await expect(service.submit('property-id', manager)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('keeps proof-required edits as drafts instead of silently resubmitting', async () => {
    const { service, prisma } = setup(PropertyStatus.CHANGES_REQUESTED, [proof])
    await service.update('property-id', draft, owner)
    expect(prisma.property.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: PropertyStatus.DRAFT }) }))
  })

  it('does not rewind review when an unchanged property update is retried', async () => {
    const { service, prisma, record } = setup(PropertyStatus.UNDER_REVIEW, [proof])
    Object.assign(record, draft, { tenantName: null, tenantPhone: null, tenancyStart: null })
    await service.update(record.id, draft, owner)
    expect(record.status).toBe(PropertyStatus.UNDER_REVIEW)
    expect(prisma.property.update).not.toHaveBeenCalled()
  })

  it('preserves review of legacy properties without treating old attachments as proof', async () => {
    const { service, record } = setup(PropertyStatus.UNDER_REVIEW, [], false)
    await service.review(record.id, { status: PropertyStatus.APPROVED }, admin)
    expect(record.status).toBe(PropertyStatus.APPROVED)
    expect(record.ownershipProofRequired).toBe(false)
  })

  it('rejects a direct administrator approval without proof', async () => {
    const { service, prisma } = setup(PropertyStatus.UNDER_REVIEW)
    await expect(service.review('property-id', { status: PropertyStatus.APPROVED }, admin)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.property.update).not.toHaveBeenCalled()
  })

  it('does not let administrator review bypass draft submission', async () => {
    const { service } = setup(PropertyStatus.DRAFT, [proof])
    await expect(service.review('property-id', { status: PropertyStatus.UNDER_REVIEW }, admin)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('stores the declared ownership category without deriving it from the filename', async () => {
    const { service, prisma } = setup()
    await service.startUpload('property-id', { purpose: PropertyFilePurpose.DOCUMENT, ownershipDocumentType: OwnershipDocumentType.GRANT_OF_PROBATE, fileName: 'scan.pdf', contentType: 'application/pdf', sizeBytes: 20 }, owner)
    expect(prisma.propertyFile.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownershipDocumentType: OwnershipDocumentType.GRANT_OF_PROBATE }) }))
  })

  it('rejects an ownership category attached to a photo upload', async () => {
    const { service, storage } = setup()
    await expect(service.startUpload('property-id', { purpose: PropertyFilePurpose.PHOTO, ownershipDocumentType: OwnershipDocumentType.CERTIFICATE_OF_OCCUPANCY, fileName: 'photo.png', contentType: 'image/png', sizeBytes: 20 }, owner)).rejects.toBeInstanceOf(BadRequestException)
    expect(storage.signUpload).not.toHaveBeenCalled()
  })

  it('validates size limits and rejects an invented category at the API boundary', async () => {
    const dto = Object.assign(new StartPropertyUploadDto(), { purpose: 'DOCUMENT', ownershipDocumentType: 'MADE_UP', fileName: 'scan.pdf', contentType: 'application/pdf', sizeBytes: 5_000_001 })
    const fields = (await validate(dto)).map((error) => error.property)
    expect(fields).toEqual(expect.arrayContaining(['ownershipDocumentType', 'sizeBytes']))
  })

  it('prevents deleting the last submitted proof before a replacement is ready', async () => {
    const { service, prisma, storage } = setup(PropertyStatus.SUBMITTED, [proof])
    prisma.propertyFile.findFirst.mockResolvedValue({ ...proof, status: PropertyFileStatus.READY, objectKey: 'properties/proof' })
    await expect(service.deleteFile('property-id', proof.id, owner)).rejects.toBeInstanceOf(BadRequestException)
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('allows replacement once another completed proof is present', async () => {
    const { service, prisma, storage } = setup(PropertyStatus.SUBMITTED, [proof, { ...proof, id: 'replacement-id' }])
    prisma.propertyFile.findFirst.mockResolvedValue({ ...proof, status: PropertyFileStatus.READY, objectKey: 'properties/proof' })
    await service.deleteFile('property-id', proof.id, owner)
    expect(storage.remove).toHaveBeenCalledWith('properties/proof')
  })

  it('does not delete bytes when the removal audit fails before commit', async () => {
    const { service, prisma, storage } = setup(PropertyStatus.DRAFT, [proof])
    prisma.propertyFile.findFirst.mockResolvedValue({ ...proof, status: PropertyFileStatus.READY, objectKey: 'properties/proof' })
    prisma.auditEvent.create.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(service.deleteFile('property-id', proof.id, owner)).rejects.toThrow('database unavailable')
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('retains non-READY cleanup metadata when Storage deletion fails', async () => {
    const { service, prisma, storage } = setup(PropertyStatus.DRAFT, [proof])
    prisma.propertyFile.findFirst.mockResolvedValue({ ...proof, status: PropertyFileStatus.READY, objectKey: 'properties/proof' })
    storage.remove.mockRejectedValueOnce(new ServiceUnavailableException('Storage unavailable'))
    await expect(service.deleteFile('property-id', proof.id, owner)).rejects.toThrow('Storage unavailable')
    expect(prisma.propertyFile.update).toHaveBeenCalledWith({ where: { id: proof.id }, data: { status: PropertyFileStatus.DELETING } })
    expect(prisma.propertyFile.deleteMany).not.toHaveBeenCalled()
  })

  it('rejects completing a file that has been marked for removal', async () => {
    const { service, prisma, storage } = setup()
    prisma.propertyFile.findFirst.mockResolvedValue({ ...proof, status: PropertyFileStatus.DELETING })
    await expect(service.completeUpload('property-id', proof.id, owner)).rejects.toThrow('removed')
    expect(storage.download).not.toHaveBeenCalled()
  })

  it('recovers a storage move when an earlier completion database transaction rolled back', async () => {
    const { service, prisma, storage } = setup()
    const pdf = Buffer.from('%PDF-1.4\nproof')
    prisma.propertyFile.findFirst.mockResolvedValue({ ...proof, propertyId: 'property-id', uploaderId: owner.sub, status: PropertyFileStatus.PENDING, objectKey: 'pending/proof', contentType: 'application/pdf', sizeBytes: pdf.length, createdAt: new Date() })
    storage.download.mockRejectedValueOnce(new ServiceUnavailableException('Storage request failed (404)')).mockResolvedValueOnce(pdf)
    await service.completeUpload('property-id', proof.id, owner)
    expect(storage.download).toHaveBeenNthCalledWith(2, 'properties/property-id/proof-id', pdf.length)
    expect(storage.move).not.toHaveBeenCalled()
    expect(prisma.propertyFile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: PropertyFileStatus.READY }) }))
  })
})
