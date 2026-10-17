import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, PropertyFilePurpose, PropertyFileStatus, PropertyStatus, UserRole, UserStatus } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../../database/prisma.service'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { AssignManagerDto, CreatePropertyDto, ReviewPropertyDto, StartPropertyUploadDto, UpdatePropertyDto } from './dto/property.dto'
import { SupabaseStorageService } from '../storage/supabase-storage.service'
import { fileSignature } from '../storage/file-signature'

type Actor = AuthenticatedRequest['user']

// Allowed admin review moves. A property returns to SUBMITTED only when its owner edits it.
const REVIEW_TRANSITIONS: Record<PropertyStatus, PropertyStatus[]> = {
  [PropertyStatus.SUBMITTED]: [PropertyStatus.UNDER_REVIEW, PropertyStatus.CHANGES_REQUESTED],
  [PropertyStatus.UNDER_REVIEW]: [PropertyStatus.INSPECTION_PENDING, PropertyStatus.APPROVED, PropertyStatus.CHANGES_REQUESTED],
  [PropertyStatus.INSPECTION_PENDING]: [PropertyStatus.APPROVED, PropertyStatus.CHANGES_REQUESTED],
  [PropertyStatus.CHANGES_REQUESTED]: [],
  [PropertyStatus.APPROVED]: [PropertyStatus.CHANGES_REQUESTED],
}

const propertyInclude = {
  owner: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
  manager: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
  files: { where: { status: PropertyFileStatus.READY }, select: { id: true, purpose: true, originalName: true, contentType: true, sizeBytes: true, isCover: true, createdAt: true } },
} satisfies Prisma.PropertyInclude

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService, private readonly storage: SupabaseStorageService) {}

  private async accessible(id: string, actor: Actor, edit = false, tx?: Prisma.TransactionClient) {
    const property = await (tx ?? this.prisma).property.findUnique({ where: { id }, include: propertyInclude })
    if (!property) throw new NotFoundException('Property not found')
    const allowed = actor.role === UserRole.ADMIN || property.ownerId === actor.sub || property.managerId === actor.sub
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
    const where: Prisma.PropertyWhereInput = actor.role === UserRole.ADMIN ? {} : actor.role === UserRole.OWNER ? { ownerId: actor.sub } : actor.role === UserRole.PROPERTY_MANAGER ? { managerId: actor.sub } : { id: '__none__' }
    return this.prisma.property.findMany({ where, include: propertyInclude, orderBy: { createdAt: 'desc' } })
  }

  get(id: string, actor: Actor) { return this.accessible(id, actor) }

  create(dto: CreatePropertyDto, actor: Actor) {
    if (actor.role !== UserRole.OWNER) throw new ForbiddenException('Only owners can submit properties')
    return this.prisma.property.create({ data: { ...this.fields(dto), ownerId: actor.sub }, include: propertyInclude })
  }

  async update(id: string, dto: UpdatePropertyDto, actor: Actor) {
    const existing = await this.accessible(id, actor, true)
    if (existing.status === PropertyStatus.APPROVED && actor.role !== UserRole.ADMIN) throw new ForbiddenException('Contact an administrator to change an approved property')
    return this.prisma.property.update({ where: { id }, data: { ...this.fields(dto), status: PropertyStatus.SUBMITTED, reviewNote: null }, include: propertyInclude })
  }

  async review(id: string, dto: ReviewPropertyDto, actor: Actor) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException()
    const existing = await this.accessible(id, actor)
    if (dto.status === PropertyStatus.SUBMITTED) throw new BadRequestException('Invalid review status')
    if (!REVIEW_TRANSITIONS[existing.status].includes(dto.status)) throw new BadRequestException(`Cannot move a property from ${existing.status.toLowerCase().replaceAll('_', ' ')} to ${dto.status.toLowerCase().replaceAll('_', ' ')}`)
    const property = await this.prisma.property.update({ where: { id }, data: { status: dto.status, reviewNote: dto.reviewNote?.trim() || null }, include: propertyInclude })
    await this.prisma.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'PROPERTY_REVIEWED', entityType: 'PROPERTY', entityId: id, summary: `Administrator moved property to ${dto.status.toLowerCase().replaceAll('_', ' ')}` } })
    return property
  }

  async assignManager(id: string, dto: AssignManagerDto, actor: Actor) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException()
    await this.accessible(id, actor)
    if (dto.managerId) {
      const manager = await this.prisma.user.findUnique({ where: { id: dto.managerId } })
      if (!manager || manager.role !== UserRole.PROPERTY_MANAGER || manager.status !== UserStatus.ACTIVE) throw new BadRequestException('Choose an active property manager')
    }
    const property = await this.prisma.property.update({ where: { id }, data: { managerId: dto.managerId || null }, include: propertyInclude })
    await this.prisma.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'PROPERTY_MANAGER_ASSIGNED', entityType: 'PROPERTY', entityId: id, summary: dto.managerId ? 'Administrator assigned a property manager' : 'Administrator removed the property manager' } })
    return property
  }

  async startUpload(id: string, dto: StartPropertyUploadDto, actor: Actor) {
    const property = await this.accessible(id, actor, true)
    if (property.status === PropertyStatus.APPROVED && actor.role !== UserRole.ADMIN) throw new ForbiddenException('Contact an administrator to add files to an approved property')
    const allowed = dto.purpose === PropertyFilePurpose.PHOTO ? ['image/jpeg', 'image/png', 'image/webp'] : ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowed.includes(dto.contentType)) throw new BadRequestException('Unsupported file type')
    const cleanName = dto.fileName.trim().replace(/[\\/\x00-\x1f]/g, '_')
    if (!cleanName) throw new BadRequestException('File name is required')
    const count = await this.prisma.propertyFile.count({ where: { propertyId: id, status: PropertyFileStatus.READY, purpose: dto.purpose } })
    if (count >= (dto.purpose === PropertyFilePurpose.PHOTO ? 30 : 20)) throw new BadRequestException('Property file limit reached')
    const pending = await this.prisma.propertyFile.count({ where: { propertyId: id, status: PropertyFileStatus.PENDING, createdAt: { gt: new Date(Date.now() - 2 * 60 * 60 * 1000) } } })
    if (pending >= 10) throw new BadRequestException('Too many uploads in progress')
    const key = `pending/${id}/${randomUUID()}`
    const record = await this.prisma.propertyFile.create({ data: { propertyId: id, uploaderId: actor.sub, purpose: dto.purpose, objectKey: key, originalName: cleanName, contentType: dto.contentType, sizeBytes: dto.sizeBytes, isCover: dto.purpose === PropertyFilePurpose.PHOTO && !!dto.isCover } })
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
      await tx.$queryRaw`SELECT "id" FROM "properties" WHERE "id" = ${id}::uuid FOR UPDATE`
      await this.accessible(id, actor, true, tx)
      await tx.$queryRaw`SELECT "id" FROM "property_files" WHERE "id" = ${fileId}::uuid FOR UPDATE`
      const record = await tx.propertyFile.findFirst({ where: { id: fileId, propertyId: id } })
      if (!record) throw new NotFoundException('File not found')
      if (record.status === PropertyFileStatus.READY) return
      if (record.uploaderId !== actor.sub && actor.role !== UserRole.ADMIN) throw new ForbiddenException()
      if (Date.now() - record.createdAt.getTime() > 2 * 60 * 60 * 1000) throw new BadRequestException('Upload expired')
      const bytes = await this.storage.download(record.objectKey, record.sizeBytes)
      if (bytes.length !== record.sizeBytes || fileSignature(bytes) !== record.contentType) throw new BadRequestException('Uploaded file does not match its declared type or size')
      const readyKey = `properties/${id}/${record.id}`
      await this.storage.move(record.objectKey, readyKey)
      if (record.isCover) await tx.propertyFile.updateMany({ where: { propertyId: id, purpose: PropertyFilePurpose.PHOTO, status: PropertyFileStatus.READY }, data: { isCover: false } })
      await tx.propertyFile.update({ where: { id: fileId }, data: { objectKey: readyKey, status: PropertyFileStatus.READY, completedAt: new Date() } })
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
    const property = await this.accessible(id, actor, true)
    if (property.status === PropertyStatus.APPROVED && actor.role !== UserRole.ADMIN) throw new ForbiddenException('Contact an administrator to remove files from an approved property')
    const file = await this.prisma.propertyFile.findFirst({ where: { id: fileId, propertyId: id } })
    if (!file) throw new NotFoundException('File not found')
    await this.storage.remove(file.objectKey)
    await this.prisma.propertyFile.delete({ where: { id: fileId } })
    return { deleted: true }
  }
}
