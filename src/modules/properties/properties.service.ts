import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { InspectionConsent, InspectionStatus, ManagerTaskStatus, OwnershipDocumentType, Prisma, PropertyFilePurpose, PropertyFileStatus, PropertyStatus, UserRole, UserStatus } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../../database/prisma.service'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { addBusinessDays } from '../../common/business-days'
import { AssignManagerDto, CreatePropertyDto, RecordInspectionConsentDto, ReviewPropertyDto, StartPropertyUploadDto, UpdatePropertyDto } from './dto/property.dto'
import { inspectionReadiness } from './inspection-readiness'
import { SupabaseStorageService } from '../storage/supabase-storage.service'
import { fileSignature } from '../storage/file-signature'
import { WorkflowNotifier } from '../notifications/workflow-notifier.service'

type Actor = AuthenticatedRequest['user']

// Leave room for hosted-database latency while staying within normal API deadlines.
const PROPERTY_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 20_000 }

// Drafts only enter review through submit(), after ownership uploads are ready.
const REVIEW_TRANSITIONS: Record<PropertyStatus, PropertyStatus[]> = {
  [PropertyStatus.DRAFT]: [],
  [PropertyStatus.SUBMITTED]: [PropertyStatus.UNDER_REVIEW, PropertyStatus.CHANGES_REQUESTED],
  [PropertyStatus.UNDER_REVIEW]: [PropertyStatus.INSPECTION_PENDING, PropertyStatus.APPROVED, PropertyStatus.CHANGES_REQUESTED],
  [PropertyStatus.INSPECTION_PENDING]: [PropertyStatus.APPROVED, PropertyStatus.CHANGES_REQUESTED],
  [PropertyStatus.CHANGES_REQUESTED]: [],
  [PropertyStatus.APPROVED]: [PropertyStatus.CHANGES_REQUESTED],
}

// Marks the task the system raises when a property is ready for inspection.
const COORDINATION_TASK_KIND = 'INSPECTION_COORDINATION'
const openInspectionStatuses = [InspectionStatus.SCHEDULED, InspectionStatus.IN_PROGRESS, InspectionStatus.COMPLETED]
const openTaskStatuses = [ManagerTaskStatus.OPEN, ManagerTaskStatus.IN_PROGRESS]

const propertyInclude = {
  owner: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
  manager: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
  inspections: { where: { status: { in: openInspectionStatuses } }, select: { id: true, status: true, scheduledAt: true, completedAt: true, accessConfirmedAt: true }, take: 1 },
  files: { where: { status: PropertyFileStatus.READY }, select: { id: true, purpose: true, ownershipDocumentType: true, originalName: true, contentType: true, sizeBytes: true, isCover: true, createdAt: true } },
} satisfies Prisma.PropertyInclude

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService, private readonly storage: SupabaseStorageService, private readonly notifier: WorkflowNotifier) {}

  private async lockedProperty(id: string, actor: Actor, tx: Prisma.TransactionClient, edit = false) {
    await tx.$queryRaw`SELECT "id" FROM "properties" WHERE "id" = ${id}::uuid FOR UPDATE`
    return this.accessible(id, actor, edit, tx)
  }

  private requireOwnershipProof(property: Prisma.PropertyGetPayload<{ include: typeof propertyInclude }>) {
    if (property.ownershipProofRequired && !property.files.some((file) => file.purpose === PropertyFilePurpose.DOCUMENT && Boolean(file.ownershipDocumentType))) {
      throw new BadRequestException('Upload and complete at least one proof of ownership document before submitting this property')
    }
  }

  private async accessible(id: string, actor: Actor, edit = false, tx?: Prisma.TransactionClient) {
    const property = await (tx ?? this.prisma).property.findUnique({ where: { id }, include: propertyInclude })
    if (!property) throw new NotFoundException('Property not found')
    const allowed = actor.role === UserRole.ADMIN || property.ownerId === actor.sub || (property.managerId === actor.sub && property.status !== PropertyStatus.DRAFT)
    if (!allowed) throw new NotFoundException('Property not found')
    if (edit && actor.role !== UserRole.ADMIN && property.ownerId !== actor.sub) throw new ForbiddenException('Only the owner can change property details')
    return property
  }

  private fields(dto: CreatePropertyDto) {
    if (dto.occupancyStatus === 'OCCUPIED' && (!dto.tenantName || !dto.tenantPhone || !dto.tenancyStart)) throw new BadRequestException('Tenant details are required for occupied properties')
    return {
      name: dto.name.trim(), type: dto.type, description: dto.description.trim(), address: dto.address.trim(),
      city: dto.city.trim(), state: dto.state.trim(), country: dto.country.trim(), occupancyStatus: dto.occupancyStatus,
      tenantName: dto.occupancyStatus === 'OCCUPIED' ? dto.tenantName!.trim() : null,
      tenantPhone: dto.occupancyStatus === 'OCCUPIED' ? dto.tenantPhone!.trim() : null,
      tenancyStart: dto.occupancyStatus === 'OCCUPIED' ? new Date(dto.tenancyStart!) : null,
    }
  }

  list(actor: Actor) {
    const where: Prisma.PropertyWhereInput = actor.role === UserRole.ADMIN ? { status: { not: PropertyStatus.DRAFT } } : actor.role === UserRole.OWNER ? { ownerId: actor.sub } : actor.role === UserRole.PROPERTY_MANAGER ? { managerId: actor.sub, status: { not: PropertyStatus.DRAFT } } : { id: '__none__' }
    return this.prisma.property.findMany({ where, include: propertyInclude, orderBy: { createdAt: 'desc' } }).then((rows) => rows.map((row) => this.withReadiness(row)))
  }

  async get(id: string, actor: Actor) { return this.withReadiness(await this.accessible(id, actor)) }

  // Tells staff where a property waiting for inspection stands and who acts next.
  private withReadiness<T extends Prisma.PropertyGetPayload<{ include: typeof propertyInclude }>>(property: T) {
    return { ...property, inspectionReadiness: inspectionReadiness(property, property.inspections?.[0]) }
  }

  // Moving away from consent while a visit is booked would leave staff entering without authority.
  private assertConsentCanChange(property: Prisma.PropertyGetPayload<{ include: typeof propertyInclude }>, next: InspectionConsent) {
    if (next !== InspectionConsent.GRANTED && property.inspectionConsent === InspectionConsent.GRANTED && property.inspections?.some((visit) => visit.status === InspectionStatus.SCHEDULED)) {
      throw new ConflictException('An inspection is already scheduled. Ask your property manager to cancel it before withdrawing consent.')
    }
  }

  // Raises the "arrange the inspection" task for the property's manager, once.
  private async ensureCoordinationTask(tx: Prisma.TransactionClient, property: { id: string; managerId: string | null }, actor: Actor) {
    if (!property.managerId) return false
    await tx.managerTask.updateMany({ where: { propertyId: property.id, kind: COORDINATION_TASK_KIND, status: { in: openTaskStatuses } }, data: { managerId: property.managerId } })
    const open = await tx.managerTask.findFirst({ where: { propertyId: property.id, kind: COORDINATION_TASK_KIND, status: { in: openTaskStatuses } }, select: { id: true } })
    if (open) return false
    const task = await tx.managerTask.create({ data: {
      propertyId: property.id, managerId: property.managerId, createdById: actor.sub, kind: COORDINATION_TASK_KIND,
      title: 'Arrange the property inspection',
      description: 'Confirm the owner has authorised the inspection, agree a date and access arrangements, then assign an inspector.',
      dueAt: addBusinessDays(new Date(), 1),
    } })
    await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'MANAGER_TASK_CREATED', entityType: 'TASK', entityId: task.id, summary: 'Inspection coordination task created' } })
    return true
  }

  create(dto: CreatePropertyDto, actor: Actor) {
    if (actor.role !== UserRole.OWNER) throw new ForbiddenException('Only owners can submit properties')
    const consent = dto.inspectionConsent ? { inspectionConsent: dto.inspectionConsent, inspectionConsentAt: new Date(), inspectionConsentById: actor.sub } : {}
    return this.prisma.property.create({ data: { ...this.fields(dto), ...consent, ownerId: actor.sub, status: PropertyStatus.DRAFT, ownershipProofRequired: true }, include: propertyInclude })
  }

  async update(id: string, dto: UpdatePropertyDto, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.lockedProperty(id, actor, tx, true)
      if (existing.status === PropertyStatus.APPROVED && actor.role !== UserRole.ADMIN) throw new ForbiddenException('Contact an administrator to change an approved property')
      const fields = this.fields(dto)
      // Consent is saved on its own so answering it never sends the property back to draft.
      let consent: Prisma.PropertyUpdateInput = {}
      if (dto.inspectionConsent && dto.inspectionConsent !== existing.inspectionConsent) {
        if (actor.role !== UserRole.OWNER) throw new ForbiddenException('Staff record the owner consent with a note')
        this.assertConsentCanChange(existing, dto.inspectionConsent)
        consent = { inspectionConsent: dto.inspectionConsent, inspectionConsentAt: new Date(), inspectionConsentBy: { connect: { id: actor.sub } }, inspectionConsentNote: null }
      }
      const unchanged = Object.entries(fields).every(([key, value]) => {
        const current = existing[key as keyof typeof existing]
        return value instanceof Date ? current instanceof Date && value.getTime() === current.getTime() : current === value
      })
      if (unchanged) return Object.keys(consent).length ? tx.property.update({ where: { id }, data: consent, include: propertyInclude }) : existing
      return tx.property.update({ where: { id }, data: { ...fields, ...consent, status: existing.ownershipProofRequired ? PropertyStatus.DRAFT : PropertyStatus.SUBMITTED, reviewNote: null }, include: propertyInclude })
    }, PROPERTY_TRANSACTION_OPTIONS)
  }

  async submit(id: string, actor: Actor) {
    let changed = false
    const result = await this.prisma.$transaction(async (tx) => {
      const property = await this.lockedProperty(id, actor, tx, true)
      this.requireOwnershipProof(property)
      // A client may retry after the first response was lost. Do not rewind an
      // administrator's review or write another submission audit entry.
      if (property.status !== PropertyStatus.DRAFT && property.status !== PropertyStatus.CHANGES_REQUESTED) return property
      const submitted = await tx.property.update({ where: { id }, data: { status: PropertyStatus.SUBMITTED, reviewNote: null }, include: propertyInclude })
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'PROPERTY_SUBMITTED', entityType: 'PROPERTY', entityId: id, summary: 'Property submitted for administrator review' } })
      changed = true
      return submitted
    }, PROPERTY_TRANSACTION_OPTIONS)
    if (changed) void this.notifier.propertySubmitted(id, actor.sub)
    return result
  }

  async review(id: string, dto: ReviewPropertyDto, actor: Actor) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException()
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockedProperty(id, actor, tx)
      if (dto.status === PropertyStatus.SUBMITTED || dto.status === PropertyStatus.DRAFT) throw new BadRequestException('Invalid review status')
      if (!REVIEW_TRANSITIONS[existing.status].includes(dto.status)) throw new BadRequestException(`Cannot move a property from ${existing.status.toLowerCase().replaceAll('_', ' ')} to ${dto.status.toLowerCase().replaceAll('_', ' ')}`)
      if (dto.status !== PropertyStatus.CHANGES_REQUESTED) this.requireOwnershipProof(existing)
      const ready = dto.status === PropertyStatus.INSPECTION_PENDING
      const property = await tx.property.update({ where: { id }, data: { status: dto.status, reviewNote: dto.reviewNote?.trim() || null, ...(ready ? { inspectionReadyAt: new Date() } : {}) }, include: propertyInclude })
      if (ready) await this.ensureCoordinationTask(tx, property, actor)
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'PROPERTY_REVIEWED', entityType: 'PROPERTY', entityId: id, summary: `Administrator moved property to ${dto.status.toLowerCase().replaceAll('_', ' ')}` } })
      return property
    }, PROPERTY_TRANSACTION_OPTIONS)
    void this.notifier.propertyReviewed(id, actor.sub)
    if (dto.status === PropertyStatus.INSPECTION_PENDING) void this.notifier.inspectionCoordinationNeeded(id, actor.sub)
    return this.withReadiness(result)
  }

  async assignManager(id: string, dto: AssignManagerDto, actor: Actor) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException()
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockedProperty(id, actor, tx)
      if (existing.status === PropertyStatus.DRAFT) throw new BadRequestException('Submit the property for review before assigning a manager')
      if (dto.managerId) {
        const manager = await tx.user.findUnique({ where: { id: dto.managerId } })
        if (!manager || manager.role !== UserRole.PROPERTY_MANAGER || manager.status !== UserStatus.ACTIVE) throw new BadRequestException('Choose an active property manager')
      }
      const property = await tx.property.update({ where: { id }, data: { managerId: dto.managerId || null }, include: propertyInclude })
      if (dto.managerId && property.status === PropertyStatus.INSPECTION_PENDING) await this.ensureCoordinationTask(tx, property, actor)
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'PROPERTY_MANAGER_ASSIGNED', entityType: 'PROPERTY', entityId: id, summary: dto.managerId ? 'Administrator assigned a property manager' : 'Administrator removed the property manager' } })
      return property
    }, PROPERTY_TRANSACTION_OPTIONS)
    if (dto.managerId) void this.notifier.propertyManagerAssigned(id, actor.sub)
    if (dto.managerId && result.status === PropertyStatus.INSPECTION_PENDING) void this.notifier.inspectionCoordinationNeeded(id, actor.sub)
    return this.withReadiness(result)
  }

  // The owner answers for themselves. The assigned manager or an admin may record
  // the answer the owner gave them, which needs a note saying how it was given.
  async recordInspectionConsent(id: string, dto: RecordInspectionConsentDto, actor: Actor) {
    const note = dto.note?.trim() || null
    const onBehalf = actor.role !== UserRole.OWNER
    if (onBehalf && (!note || note.length < 10)) throw new BadRequestException('Say how and when the owner gave this answer (at least 10 characters)')
    let changed = false
    const result = await this.prisma.$transaction(async (tx) => {
      const property = await this.lockedProperty(id, actor, tx)
      if (property.inspectionConsent === dto.response) return property
      this.assertConsentCanChange(property, dto.response)
      const updated = await tx.property.update({ where: { id }, data: { inspectionConsent: dto.response, inspectionConsentAt: new Date(), inspectionConsentBy: { connect: { id: actor.sub } }, inspectionConsentNote: onBehalf ? note : null }, include: propertyInclude })
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'PROPERTY_INSPECTION_CONSENT_RECORDED', entityType: 'PROPERTY', entityId: id, summary: `${onBehalf ? 'Staff recorded the owner answer' : 'Owner answered'}: ${dto.response === InspectionConsent.GRANTED ? 'consents to inspection' : 'wants to discuss the inspection first'}` } })
      changed = true
      return updated
    }, PROPERTY_TRANSACTION_OPTIONS)
    if (changed) void this.notifier.inspectionConsentRecorded(id, actor.sub)
    return this.withReadiness(result)
  }

  // Staff ask the owner for consent. The first request starts the follow-up clock.
  async requestInspectionConsent(id: string, actor: Actor) {
    if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.PROPERTY_MANAGER) throw new ForbiddenException()
    const result = await this.prisma.$transaction(async (tx) => {
      const property = await this.lockedProperty(id, actor, tx)
      if (property.status !== PropertyStatus.INSPECTION_PENDING && property.status !== PropertyStatus.APPROVED) throw new BadRequestException('Consent can be requested once the property is ready for inspection')
      if (property.inspectionConsent === InspectionConsent.GRANTED) throw new ConflictException('The owner has already consented to an inspection')
      const updated = await tx.property.update({ where: { id }, data: property.inspectionConsentRequestedAt ? {} : { inspectionConsentRequestedAt: new Date() }, include: propertyInclude })
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'PROPERTY_INSPECTION_CONSENT_REQUESTED', entityType: 'PROPERTY', entityId: id, summary: 'Staff asked the owner for inspection consent' } })
      return updated
    }, PROPERTY_TRANSACTION_OPTIONS)
    void this.notifier.inspectionConsentRequested(id, actor.sub)
    return this.withReadiness(result)
  }

  async startUpload(id: string, dto: StartPropertyUploadDto, actor: Actor) {
    const property = await this.accessible(id, actor, true)
    if (property.status === PropertyStatus.APPROVED && actor.role !== UserRole.ADMIN) throw new ForbiddenException('Contact an administrator to add files to an approved property')
    const allowed = dto.purpose === PropertyFilePurpose.PHOTO ? ['image/jpeg', 'image/png', 'image/webp'] : ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowed.includes(dto.contentType)) throw new BadRequestException('Unsupported file type')
    if (dto.ownershipDocumentType !== undefined && (dto.purpose !== PropertyFilePurpose.DOCUMENT || !Object.values(OwnershipDocumentType).includes(dto.ownershipDocumentType))) throw new BadRequestException('Choose a valid ownership document type for a document upload')
    const cleanName = dto.fileName.trim().replace(/[\\/\x00-\x1f]/g, '_')
    if (!cleanName) throw new BadRequestException('File name is required')
    const count = await this.prisma.propertyFile.count({ where: { propertyId: id, status: PropertyFileStatus.READY, purpose: dto.purpose } })
    if (count >= (dto.purpose === PropertyFilePurpose.PHOTO ? 30 : 20)) throw new BadRequestException('Property file limit reached')
    const pending = await this.prisma.propertyFile.count({ where: { propertyId: id, status: PropertyFileStatus.PENDING, createdAt: { gt: new Date(Date.now() - 2 * 60 * 60 * 1000) } } })
    if (pending >= 10) throw new BadRequestException('Too many uploads in progress')
    const key = `pending/${id}/${randomUUID()}`
    const record = await this.prisma.propertyFile.create({ data: { propertyId: id, uploaderId: actor.sub, purpose: dto.purpose, ownershipDocumentType: dto.ownershipDocumentType ?? null, objectKey: key, originalName: cleanName, contentType: dto.contentType, sizeBytes: dto.sizeBytes, isCover: dto.purpose === PropertyFilePurpose.PHOTO && !!dto.isCover } })
    try {
      const uploadUrl = await this.storage.signUpload(key)
      return { id: record.id, uploadUrl, expiresInSeconds: 7200 }
    } catch (error) {
      await this.prisma.propertyFile.delete({ where: { id: record.id } })
      throw error
    }
  }

  async completeUpload(id: string, fileId: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      // Parent first: cover publication and property review share the same row lock.
      const property = await this.lockedProperty(id, actor, tx, true)
      await tx.$queryRaw`SELECT "id" FROM "property_files" WHERE "id" = ${fileId}::uuid FOR UPDATE`
      const record = await tx.propertyFile.findFirst({ where: { id: fileId, propertyId: id } })
      if (!record) throw new NotFoundException('File not found')
      if (record.status === PropertyFileStatus.DELETING) throw new BadRequestException('This file has been removed from the property')
      if (record.status === PropertyFileStatus.READY) return
      if (property.status === PropertyStatus.APPROVED && actor.role !== UserRole.ADMIN) throw new ForbiddenException('Contact an administrator to add files to an approved property')
      if (record.uploaderId !== actor.sub && actor.role !== UserRole.ADMIN) throw new ForbiddenException()
      if (Date.now() - record.createdAt.getTime() > 2 * 60 * 60 * 1000) throw new BadRequestException('Upload expired')
      const readyKey = `properties/${id}/${record.id}`
      let bytes: Buffer
      let alreadyMoved = false
      try {
        bytes = await this.storage.download(record.objectKey, record.sizeBytes)
      } catch (error) {
        if (!(error instanceof ServiceUnavailableException)) throw error
        // Storage moves cannot participate in the database transaction. Recover
        // a verified object if a previous completion moved it but then rolled back.
        try {
          bytes = await this.storage.download(readyKey, record.sizeBytes)
          alreadyMoved = true
        } catch {
          throw error
        }
      }
      if (bytes.length !== record.sizeBytes || fileSignature(bytes) !== record.contentType) throw new BadRequestException('Uploaded file does not match its declared type or size')
      if (!alreadyMoved) await this.storage.move(record.objectKey, readyKey)
      if (record.isCover) await tx.propertyFile.updateMany({ where: { propertyId: id, purpose: PropertyFilePurpose.PHOTO, status: PropertyFileStatus.READY }, data: { isCover: false } })
      await tx.propertyFile.update({ where: { id: fileId }, data: { objectKey: readyKey, status: PropertyFileStatus.READY, completedAt: new Date() } })
      if (record.ownershipDocumentType) await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'OWNERSHIP_DOCUMENT_UPLOADED', entityType: 'PROPERTY', entityId: id, summary: `Ownership evidence uploaded: ${record.ownershipDocumentType.toLowerCase().replaceAll('_', ' ')}` } })
    }, { maxWait: 5_000, timeout: 90_000 })
    return this.get(id, actor)
  }

  async fileUrl(id: string, fileId: string, actor: Actor, download?: string) {
    await this.accessible(id, actor)
    const file = await this.prisma.propertyFile.findFirst({ where: { id: fileId, propertyId: id, status: PropertyFileStatus.READY } })
    if (!file) throw new NotFoundException('File not found')
    if (download !== undefined && download !== 'true' && download !== 'false') throw new BadRequestException('Invalid download option')
    const asDownload = download === undefined ? file.purpose === PropertyFilePurpose.DOCUMENT : download === 'true'
    return { url: await this.storage.signedDownload(file.objectKey, asDownload), expiresInSeconds: 60 }
  }

  async deleteFile(id: string, fileId: string, actor: Actor) {
    const removed = await this.prisma.$transaction(async (tx) => {
      const property = await this.lockedProperty(id, actor, tx, true)
      if (property.status === PropertyStatus.APPROVED && actor.role !== UserRole.ADMIN) throw new ForbiddenException('Contact an administrator to remove files from an approved property')
      const file = await tx.propertyFile.findFirst({ where: { id: fileId, propertyId: id } })
      if (!file) throw new NotFoundException('File not found')
      if (file.status === PropertyFileStatus.DELETING) return file
      if (property.ownershipProofRequired && property.status !== PropertyStatus.DRAFT && file.status === PropertyFileStatus.READY && file.ownershipDocumentType && !property.files.some((other) => other.id !== file.id && other.purpose === PropertyFilePurpose.DOCUMENT && Boolean(other.ownershipDocumentType))) {
        throw new BadRequestException('Upload a replacement ownership document before removing the last proof of ownership')
      }
      // Commit removal from the READY set before touching Storage. Failed cleanup
      // leaves a retryable tombstone, never a READY record for a deleted object.
      await tx.propertyFile.update({ where: { id: fileId }, data: { status: PropertyFileStatus.DELETING } })
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'PROPERTY_FILE_REMOVED', entityType: 'PROPERTY', entityId: id, summary: 'Property attachment removed' } })
      return file
    }, PROPERTY_TRANSACTION_OPTIONS)
    const paths = removed.objectKey.startsWith('pending/') ? [removed.objectKey, `properties/${id}/${fileId}`] : [removed.objectKey]
    for (const path of paths) await this.storage.remove(path)
    await this.prisma.propertyFile.deleteMany({ where: { id: fileId, status: PropertyFileStatus.DELETING } })
    return { deleted: true }
  }
}
