import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { MaintenanceEvidenceKind, MaintenanceEvidenceStatus, MaintenanceEvidenceType, MaintenanceQuoteStatus, MaintenanceStatus, Prisma, UserRole, UserStatus } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { PrismaService } from '../../database/prisma.service'
import { fileSignature } from '../storage/file-signature'
import { SupabaseStorageService } from '../storage/supabase-storage.service'
import { AssignMaintenanceDto, CreateMaintenanceDto, DecideMaintenanceQuoteDto, MaintenanceNoteDto, StartMaintenanceEvidenceDto, SubmitMaintenanceQuoteDto } from './dto/maintenance.dto'

type Actor = AuthenticatedRequest['user']
const uploadLifetime = 2 * 60 * 60 * 1000

const maintenanceInclude = {
  property: { include: { owner: { select: { email: true } } } },
  contractor: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
  updates: { orderBy: { createdAt: 'asc' as const }, include: { author: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } } } },
  evidence: { where: { status: MaintenanceEvidenceStatus.READY }, orderBy: { createdAt: 'asc' as const } },
  quotes: { orderBy: { revision: 'desc' as const } },
} satisfies Prisma.MaintenanceRequestInclude

type RecordWithDetails = Prisma.MaintenanceRequestGetPayload<{ include: typeof maintenanceInclude }>

@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService, private readonly storage: SupabaseStorageService) {}

  private name(user: { email: string; profile: { firstName: string; lastName: string } | null } | null) {
    return user ? (user.profile ? `${user.profile.firstName} ${user.profile.lastName}`.trim() : user.email) : null
  }

  private async quoteContractorNames(records: RecordWithDetails[]) {
    const ids = [...new Set(records.flatMap((record) => record.quotes.map((quote) => quote.contractorId)).filter(Boolean))]
    if (!ids.length) return new Map<string, string | null>()
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } })
    return new Map(users.map((user) => [user.id, this.name(user)]))
  }

  private serialize(record: RecordWithDetails, contractorNames: Map<string, string | null>) {
    return {
      id: record.id,
      ownerId: record.property.ownerId,
      ownerEmail: record.property.owner.email,
      propertyId: record.propertyId,
      propertyName: record.property.name,
      address: `${record.property.address}, ${record.property.city}, ${record.property.state}`,
      issue: record.issue,
      description: record.description,
      priority: record.priority,
      status: record.status,
      contractorId: record.contractorId,
      assignedContractor: this.name(record.contractor),
      assignmentNote: record.assignmentNote,
      reportedAt: record.reportedAt,
      updatedAt: record.updatedAt,
      completedAt: record.completedAt,
      closedAt: record.closedAt,
      updates: record.updates.map((update) => ({ id: update.id, status: update.status, note: update.note, authorName: this.name(update.author), createdAt: update.createdAt })),
      evidence: record.evidence.map((item) => ({ id: item.id, name: item.originalName, caption: item.caption, type: item.type, kind: item.kind, recordedAt: item.completedAt ?? item.createdAt, sizeBytes: item.sizeBytes })),
      quotes: record.quotes.map((quote) => ({ id: quote.id, revision: quote.revision, contractorId: quote.contractorId, contractorName: contractorNames.get(quote.contractorId) ?? null, status: quote.status, amountNgn: quote.amountNgn, scope: quote.scope, expectedDurationDays: quote.expectedDurationDays, notes: quote.notes, submittedAt: quote.submittedAt, decidedAt: quote.decidedAt, decisionNote: quote.decisionNote })),
    }
  }

  private async accessible(id: string, actor: Actor, tx?: Prisma.TransactionClient) {
    const record = await (tx ?? this.prisma).maintenanceRequest.findUnique({ where: { id }, include: maintenanceInclude })
    if (!record) throw new NotFoundException('Maintenance request not found')
    const allowed = actor.role === UserRole.ADMIN ||
      (actor.role === UserRole.OWNER && record.property.ownerId === actor.sub) ||
      (actor.role === UserRole.PROPERTY_MANAGER && record.property.managerId === actor.sub) ||
      (actor.role === UserRole.CONTRACTOR && record.contractorId === actor.sub)
    if (!allowed) throw new NotFoundException('Maintenance request not found')
    return record
  }

  private assignedContractor(record: RecordWithDetails, actor: Actor) {
    if (actor.role !== UserRole.CONTRACTOR || record.contractorId !== actor.sub) throw new ForbiddenException('Only the assigned contractor can update this request')
  }

  private audit(actor: Actor, action: string, id: string, summary: string, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action, entityType: 'MAINTENANCE', entityId: id, summary } })
  }

  async list(actor: Actor) {
    const where: Prisma.MaintenanceRequestWhereInput = actor.role === UserRole.ADMIN ? {}
      : actor.role === UserRole.OWNER ? { property: { is: { ownerId: actor.sub } } }
      : actor.role === UserRole.PROPERTY_MANAGER ? { property: { is: { managerId: actor.sub } } }
      : actor.role === UserRole.CONTRACTOR ? { contractorId: actor.sub }
      : { id: '__none__' }
    const records = await this.prisma.maintenanceRequest.findMany({ where, include: maintenanceInclude, orderBy: { reportedAt: 'desc' } })
    const contractorNames = await this.quoteContractorNames(records)
    return records.map((record) => this.serialize(record, contractorNames))
  }

  async get(id: string, actor: Actor) {
    const record = await this.accessible(id, actor)
    return this.serialize(record, await this.quoteContractorNames([record]))
  }

  async create(dto: CreateMaintenanceDto, actor: Actor) {
    if (actor.role !== UserRole.OWNER) throw new ForbiddenException()
    const property = await this.prisma.property.findUnique({ where: { id: dto.propertyId }, select: { ownerId: true } })
    if (!property || property.ownerId !== actor.sub) throw new NotFoundException('Property not found')
    const issue = dto.issue.trim()
    const description = dto.description.trim()
    if (issue.length < 3 || description.length < 10) throw new BadRequestException('Provide an issue title and description')
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.maintenanceRequest.create({
        data: { propertyId: dto.propertyId, issue, description, priority: dto.priority,
          updates: { create: { authorId: actor.sub, status: MaintenanceStatus.REPORTED, note: description } } },
      })
      await this.audit(actor, 'MAINTENANCE_REPORTED', created.id, 'Owner reported a maintenance issue', tx)
      return created
    })
    return this.get(record.id, actor)
  }

  async assign(id: string, dto: AssignMaintenanceDto, actor: Actor) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException()
    if (dto.note.trim().length < 10) throw new BadRequestException('Provide a work brief')
    const record = await this.accessible(id, actor)
    if (record.status !== MaintenanceStatus.REPORTED && record.status !== MaintenanceStatus.ASSIGNED && record.status !== MaintenanceStatus.QUOTE_REJECTED) throw new ConflictException('Only unstarted requests can be assigned')
    const contractor = await this.prisma.user.findUnique({ where: { id: dto.contractorId }, select: { role: true, status: true } })
    if (!contractor || contractor.role !== UserRole.CONTRACTOR || contractor.status !== UserStatus.ACTIVE) throw new BadRequestException('Choose an active contractor')
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.maintenanceRequest.updateMany({ where: { id, status: { in: [MaintenanceStatus.REPORTED, MaintenanceStatus.ASSIGNED, MaintenanceStatus.QUOTE_REJECTED] } }, data: { contractorId: dto.contractorId, assignmentNote: dto.note.trim(), status: MaintenanceStatus.ASSIGNED } })
      if (!changed.count) throw new ConflictException('This request has already started')
      await tx.maintenanceUpdate.create({ data: { requestId: id, authorId: actor.sub, status: MaintenanceStatus.ASSIGNED, note: dto.note.trim() } })
      await this.audit(actor, 'MAINTENANCE_ASSIGNED', id, 'Administrator assigned a contractor', tx)
    })
    return this.get(id, actor)
  }

  async submitQuote(id: string, dto: SubmitMaintenanceQuoteDto, actor: Actor) {
    const record = await this.accessible(id, actor)
    this.assignedContractor(record, actor)
    if (record.status !== MaintenanceStatus.ASSIGNED && record.status !== MaintenanceStatus.QUOTE_REJECTED) throw new ConflictException('A quote can only be submitted before approval')
    const scope = dto.scope.trim()
    const notes = dto.notes.trim()
    if (scope.length < 10 || notes.length < 10) throw new BadRequestException('Provide a clear scope and notes')
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.maintenanceRequest.updateMany({ where: { id, contractorId: actor.sub, status: { in: [MaintenanceStatus.ASSIGNED, MaintenanceStatus.QUOTE_REJECTED] } }, data: { status: MaintenanceStatus.PENDING_APPROVAL } })
      if (!changed.count) throw new ConflictException('This request can no longer receive a quote')
      const latest = await tx.maintenanceQuote.findFirst({ where: { requestId: id }, orderBy: { revision: 'desc' }, select: { revision: true } })
      await tx.maintenanceQuote.create({ data: { requestId: id, contractorId: actor.sub, revision: (latest?.revision ?? 0) + 1, amountNgn: dto.amountNgn, scope, expectedDurationDays: dto.expectedDurationDays, notes } })
      await tx.maintenanceUpdate.create({ data: { requestId: id, authorId: actor.sub, status: MaintenanceStatus.PENDING_APPROVAL, note: `Quote submitted for NGN ${dto.amountNgn.toLocaleString('en-NG')}. ${scope}` } })
      await this.audit(actor, 'MAINTENANCE_QUOTE_SUBMITTED', id, 'Contractor submitted a maintenance quote', tx)
    })
    return this.get(id, actor)
  }

  async decideQuote(id: string, quoteId: string, dto: DecideMaintenanceQuoteDto, actor: Actor) {
    if (actor.role !== UserRole.OWNER) throw new ForbiddenException()
    const record = await this.accessible(id, actor)
    const quote = record.quotes[0]
    if (record.status !== MaintenanceStatus.PENDING_APPROVAL || !quote || quote.id !== quoteId || quote.status !== MaintenanceQuoteStatus.SUBMITTED) throw new ConflictException('This quote is no longer awaiting approval')
    const note = dto.note?.trim() || ''
    if (dto.decision === 'REJECT' && note.length < 10) throw new BadRequestException('Explain why the quote was rejected')
    const approved = dto.decision === 'APPROVE'
    const next = approved ? MaintenanceStatus.APPROVED : MaintenanceStatus.QUOTE_REJECTED
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.maintenanceRequest.updateMany({ where: { id, status: MaintenanceStatus.PENDING_APPROVAL }, data: { status: next } })
      if (!changed.count) throw new ConflictException('This quote has already been decided')
      const decided = await tx.maintenanceQuote.updateMany({ where: { id: quoteId, requestId: id, status: MaintenanceQuoteStatus.SUBMITTED }, data: { status: approved ? MaintenanceQuoteStatus.APPROVED : MaintenanceQuoteStatus.REJECTED, decidedAt: new Date(), decisionNote: note || null } })
      if (!decided.count) throw new ConflictException('This quote has already been decided')
      await tx.maintenanceUpdate.create({ data: { requestId: id, authorId: actor.sub, status: next, note: approved ? note || 'Owner approved the maintenance quote.' : note } })
      await this.audit(actor, approved ? 'MAINTENANCE_QUOTE_APPROVED' : 'MAINTENANCE_QUOTE_REJECTED', id, approved ? 'Owner approved a maintenance quote' : 'Owner rejected a maintenance quote', tx)
    })
    return this.get(id, actor)
  }

  async start(id: string, dto: MaintenanceNoteDto, actor: Actor) {
    const record = await this.accessible(id, actor)
    this.assignedContractor(record, actor)
    await this.transition(id, MaintenanceStatus.APPROVED, MaintenanceStatus.IN_PROGRESS, dto.note, actor)
    return this.get(id, actor)
  }

  async progress(id: string, dto: MaintenanceNoteDto, actor: Actor) {
    const record = await this.accessible(id, actor)
    this.assignedContractor(record, actor)
    if (record.status !== MaintenanceStatus.IN_PROGRESS) throw new ConflictException('Start the job before posting progress')
    if (dto.note.trim().length < 10) throw new BadRequestException('Provide a progress note')
    await this.prisma.$transaction(async (tx) => {
      await tx.maintenanceUpdate.create({ data: { requestId: id, authorId: actor.sub, status: MaintenanceStatus.IN_PROGRESS, note: dto.note.trim() } })
      await this.audit(actor, 'MAINTENANCE_PROGRESS', id, 'Contractor posted a progress update', tx)
    })
    return this.get(id, actor)
  }

  async complete(id: string, dto: MaintenanceNoteDto, actor: Actor) {
    const record = await this.accessible(id, actor)
    this.assignedContractor(record, actor)
    if (record.status !== MaintenanceStatus.IN_PROGRESS) throw new ConflictException('Start the job before completing it')
    const completionEvidence = await this.prisma.maintenanceEvidence.count({ where: { requestId: id, status: MaintenanceEvidenceStatus.READY, kind: MaintenanceEvidenceKind.COMPLETION } })
    if (!completionEvidence) throw new BadRequestException('Upload completion evidence before completing the job')
    await this.transition(id, MaintenanceStatus.IN_PROGRESS, MaintenanceStatus.COMPLETED, dto.note, actor, { completedAt: new Date() })
    return this.get(id, actor)
  }

  async close(id: string, dto: MaintenanceNoteDto, actor: Actor) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException()
    await this.accessible(id, actor)
    await this.transition(id, MaintenanceStatus.COMPLETED, MaintenanceStatus.CLOSED, dto.note, actor, { closedAt: new Date() })
    return this.get(id, actor)
  }

  private async transition(id: string, from: MaintenanceStatus, to: MaintenanceStatus, note: string, actor: Actor, extra: Prisma.MaintenanceRequestUpdateManyMutationInput = {}) {
    if (note.trim().length < 10) throw new BadRequestException('Provide a note of at least 10 characters')
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.maintenanceRequest.updateMany({ where: { id, status: from, ...(actor.role === UserRole.CONTRACTOR ? { contractorId: actor.sub } : {}) }, data: { status: to, ...extra } })
      if (!changed.count) throw new ConflictException('This maintenance request has already changed')
      await tx.maintenanceUpdate.create({ data: { requestId: id, authorId: actor.sub, status: to, note: note.trim() } })
      await this.audit(actor, `MAINTENANCE_${to}`, id, `Maintenance moved to ${to.replaceAll('_', ' ').toLowerCase()}`, tx)
    })
  }

  private canUpload(record: RecordWithDetails, actor: Actor, kind: MaintenanceEvidenceKind) {
    if (actor.role === UserRole.OWNER && record.property.ownerId === actor.sub && kind === MaintenanceEvidenceKind.ISSUE && record.status !== MaintenanceStatus.CLOSED) return
    if (actor.role === UserRole.CONTRACTOR && record.contractorId === actor.sub &&
      record.status === MaintenanceStatus.IN_PROGRESS && kind !== MaintenanceEvidenceKind.ISSUE) return
    throw new ForbiddenException('Evidence cannot be added to this request')
  }

  async startEvidence(id: string, dto: StartMaintenanceEvidenceDto, actor: Actor) {
    const record = await this.accessible(id, actor)
    this.canUpload(record, actor, dto.kind)
    const allowed = dto.type === MaintenanceEvidenceType.PHOTO ? ['image/jpeg', 'image/png', 'image/webp'] : ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowed.includes(dto.contentType)) throw new BadRequestException('Unsupported evidence type')
    const cleanName = dto.fileName.trim().replace(/[\\/\x00-\x1f]/g, '_')
    if (!cleanName || dto.caption.trim().length < 2) throw new BadRequestException('Evidence name and caption are required')
    const ready = await this.prisma.maintenanceEvidence.count({ where: { requestId: id, status: MaintenanceEvidenceStatus.READY } })
    if (ready >= 30) throw new BadRequestException('Maintenance evidence limit reached')
    const pending = await this.prisma.maintenanceEvidence.count({ where: { requestId: id, status: MaintenanceEvidenceStatus.PENDING, createdAt: { gt: new Date(Date.now() - uploadLifetime) } } })
    if (pending >= 5) throw new BadRequestException('Too many uploads in progress')
    const objectKey = `pending/maintenance/${id}/${randomUUID()}`
    const evidence = await this.prisma.maintenanceEvidence.create({ data: { requestId: id, uploaderId: actor.sub, type: dto.type, kind: dto.kind, objectKey, originalName: cleanName, caption: dto.caption.trim(), contentType: dto.contentType, sizeBytes: dto.sizeBytes } })
    try { return { id: evidence.id, uploadUrl: await this.storage.signUpload(objectKey), expiresInSeconds: 7200 } }
    catch (error) { await this.prisma.maintenanceEvidence.delete({ where: { id: evidence.id } }); throw error }
  }

  async completeEvidence(id: string, evidenceId: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "maintenance_requests" WHERE "id" = ${id}::uuid FOR UPDATE`
      const record = await this.accessible(id, actor, tx)
      await tx.$queryRaw`SELECT "id" FROM "maintenance_evidence" WHERE "id" = ${evidenceId}::uuid FOR UPDATE`
      const evidence = await tx.maintenanceEvidence.findFirst({ where: { id: evidenceId, requestId: id } })
      if (!evidence) throw new NotFoundException('Evidence not found')
      if (evidence.uploaderId !== actor.sub) throw new ForbiddenException()
      if (evidence.status === MaintenanceEvidenceStatus.READY) return
      this.canUpload(record, actor, evidence.kind)
      if (Date.now() - evidence.createdAt.getTime() > uploadLifetime) throw new BadRequestException('Evidence upload expired')
      const bytes = await this.storage.download(evidence.objectKey, evidence.sizeBytes)
      if (bytes.length !== evidence.sizeBytes || fileSignature(bytes) !== evidence.contentType) throw new BadRequestException('Evidence does not match its declared type or size')
      const readyKey = `maintenance/${id}/${evidence.id}`
      await this.storage.move(evidence.objectKey, readyKey)
      await tx.maintenanceEvidence.update({ where: { id: evidence.id }, data: { objectKey: readyKey, status: MaintenanceEvidenceStatus.READY, completedAt: new Date() } })
      await this.audit(actor, 'MAINTENANCE_EVIDENCE_ADDED', id, 'Evidence added to a maintenance request', tx)
    }, { maxWait: 5_000, timeout: 90_000 })
    return this.get(id, actor)
  }

  async evidenceUrl(id: string, evidenceId: string, actor: Actor, download?: string) {
    await this.accessible(id, actor)
    const evidence = await this.prisma.maintenanceEvidence.findFirst({ where: { id: evidenceId, requestId: id, status: MaintenanceEvidenceStatus.READY } })
    if (!evidence) throw new NotFoundException('Evidence not found')
    if (download !== undefined && download !== 'true' && download !== 'false') throw new BadRequestException('Invalid download option')
    const asDownload = download === undefined ? evidence.type === MaintenanceEvidenceType.DOCUMENT : download === 'true'
    return { url: await this.storage.signedDownload(evidence.objectKey, asDownload), expiresInSeconds: 60 }
  }

  async removeEvidence(id: string, evidenceId: string, actor: Actor) {
    const record = await this.accessible(id, actor)
    const evidence = await this.prisma.maintenanceEvidence.findFirst({ where: { id: evidenceId, requestId: id } })
    if (!evidence) throw new NotFoundException('Evidence not found')
    if (evidence.uploaderId !== actor.sub) throw new ForbiddenException()
    this.canUpload(record, actor, evidence.kind)
    await this.storage.remove(evidence.objectKey)
    await this.prisma.maintenanceEvidence.delete({ where: { id: evidence.id } })
    return { deleted: true }
  }
}
