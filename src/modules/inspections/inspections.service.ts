import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { InspectionEvidenceStatus, InspectionEvidenceType, InspectionStatus, Prisma, PropertyStatus, UserRole, UserStatus } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { PrismaService } from '../../database/prisma.service'
import { WorkflowNotifier } from '../notifications/workflow-notifier.service'
import { fileSignature } from '../storage/file-signature'
import { SupabaseStorageService } from '../storage/supabase-storage.service'
import { RescheduleInspectionDto, ScheduleInspectionDto, StartInspectionEvidenceDto, SubmitInspectionReportDto } from './dto/inspection.dto'

type Actor = AuthenticatedRequest['user']
const activeStatuses = [InspectionStatus.SCHEDULED, InspectionStatus.IN_PROGRESS, InspectionStatus.COMPLETED]
const uploadLifetime = 2 * 60 * 60 * 1000

const inspectionInclude = {
  property: { include: { owner: { select: { email: true } } } },
  inspector: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
  report: { include: { findings: { orderBy: { position: 'asc' as const } } } },
  evidence: { where: { status: InspectionEvidenceStatus.READY }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.InspectionInclude

type InspectionRecord = Prisma.InspectionGetPayload<{ include: typeof inspectionInclude }>

@Injectable()
export class InspectionsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: SupabaseStorageService, private readonly notifier: WorkflowNotifier) {}

  private serialize(record: InspectionRecord, actor: Actor) {
    const canSeeReport = actor.role === UserRole.ADMIN || actor.role === UserRole.INSPECTOR || record.status === InspectionStatus.REPORT_READY
    const report = canSeeReport ? record.report : null
    const name = record.inspector.profile
      ? `${record.inspector.profile.firstName} ${record.inspector.profile.lastName}`.trim()
      : record.inspector.email
    return {
      id: record.id,
      ownerId: record.property.ownerId,
      ownerEmail: record.property.owner.email,
      propertyId: record.propertyId,
      propertyName: record.property.name,
      address: `${record.property.address}, ${record.property.city}, ${record.property.state}`,
      status: record.status,
      purpose: record.purpose,
      inspectorId: record.inspectorId,
      inspectorName: name,
      inspectorRole: 'Field Inspector',
      scheduledAt: record.scheduledAt,
      completedAt: record.completedAt,
      summary: record.summary,
      findings: report?.findings.map((finding) => ({ id: finding.id, area: finding.area, title: finding.title, severity: finding.severity, detail: finding.detail, recommendation: finding.recommendation })) ?? [],
      evidence: canSeeReport ? record.evidence.map((item) => ({ id: item.id, name: item.originalName, type: item.type, caption: item.caption, recordedAt: item.completedAt ?? item.createdAt, contentType: item.contentType, sizeBytes: item.sizeBytes })) : [],
      report: report ? { id: report.id, submittedAt: report.submittedAt, overview: report.overview, recommendations: report.recommendations } : null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }

  private async accessible(id: string, actor: Actor, tx?: Prisma.TransactionClient) {
    const record = await (tx ?? this.prisma).inspection.findUnique({ where: { id }, include: inspectionInclude })
    if (!record) throw new NotFoundException('Inspection not found')
    const allowed = actor.role === UserRole.ADMIN ||
      (actor.role === UserRole.OWNER && record.property.ownerId === actor.sub) ||
      (actor.role === UserRole.PROPERTY_MANAGER && record.property.managerId === actor.sub) ||
      (actor.role === UserRole.INSPECTOR && record.inspectorId === actor.sub)
    if (!allowed) throw new NotFoundException('Inspection not found')
    return record
  }

  private assignedInspector(record: InspectionRecord, actor: Actor) {
    if (actor.role !== UserRole.INSPECTOR || record.inspectorId !== actor.sub) throw new ForbiddenException('Only the assigned inspector can update this inspection')
  }

  private async validInspector(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { role: true, status: true } })
    if (!user || user.role !== UserRole.INSPECTOR || user.status !== UserStatus.ACTIVE) throw new BadRequestException('Choose an active inspector')
  }

  private futureDate(value: string) {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new BadRequestException('Choose a future inspection date')
    return date
  }

  async list(actor: Actor) {
    const where: Prisma.InspectionWhereInput = actor.role === UserRole.ADMIN ? {}
      : actor.role === UserRole.INSPECTOR ? { inspectorId: actor.sub }
      : actor.role === UserRole.OWNER ? { property: { is: { ownerId: actor.sub } } }
      : actor.role === UserRole.PROPERTY_MANAGER ? { property: { is: { managerId: actor.sub } } }
      : { id: '__none__' }
    const records = await this.prisma.inspection.findMany({ where, include: inspectionInclude, orderBy: { scheduledAt: 'desc' } })
    return records.map((record) => this.serialize(record, actor))
  }

  async get(id: string, actor: Actor) { return this.serialize(await this.accessible(id, actor), actor) }

  async schedule(dto: ScheduleInspectionDto, actor: Actor) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException()
    const property = await this.prisma.property.findUnique({ where: { id: dto.propertyId }, select: { status: true } })
    if (!property) throw new NotFoundException('Property not found')
    if (property.status !== PropertyStatus.INSPECTION_PENDING && property.status !== PropertyStatus.APPROVED) throw new BadRequestException('Review the property before scheduling an inspection')
    await this.validInspector(dto.inspectorId)
    const scheduledAt = this.futureDate(dto.scheduledAt)
    const existing = await this.prisma.inspection.findFirst({ where: { propertyId: dto.propertyId, status: { in: activeStatuses } }, select: { id: true } })
    if (existing) throw new ConflictException('An active inspection already exists for this property')
    try {
      const record = await this.prisma.inspection.create({ data: { propertyId: dto.propertyId, inspectorId: dto.inspectorId, purpose: dto.purpose.trim(), summary: dto.summary.trim(), scheduledAt } })
      await this.prisma.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'INSPECTION_SCHEDULED', entityType: 'INSPECTION', entityId: record.id, summary: 'Administrator scheduled an inspection' } })
      void this.notifier.inspectionScheduled(record.id, actor.sub)
      return this.get(record.id, actor)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('An active inspection already exists for this property')
      throw error
    }
  }

  async reschedule(id: string, dto: RescheduleInspectionDto, actor: Actor) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException()
    const record = await this.accessible(id, actor)
    if (record.status !== InspectionStatus.SCHEDULED) throw new ConflictException('Only scheduled inspections can be changed')
    if (dto.inspectorId) await this.validInspector(dto.inspectorId)
    await this.prisma.inspection.update({ where: { id }, data: { scheduledAt: this.futureDate(dto.scheduledAt), inspectorId: dto.inspectorId ?? record.inspectorId } })
    await this.prisma.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'INSPECTION_RESCHEDULED', entityType: 'INSPECTION', entityId: id, summary: 'Administrator changed an inspection schedule' } })
    void this.notifier.inspectionRescheduled(id, record.inspectorId, actor.sub)
    return this.get(id, actor)
  }

  async cancel(id: string, actor: Actor) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException()
    await this.accessible(id, actor)
    const changed = await this.prisma.inspection.updateMany({ where: { id, status: { in: activeStatuses } }, data: { status: InspectionStatus.CANCELLED } })
    if (!changed.count) throw new ConflictException('This inspection cannot be cancelled')
    await this.prisma.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'INSPECTION_CANCELLED', entityType: 'INSPECTION', entityId: id, summary: 'Administrator cancelled an inspection' } })
    void this.notifier.inspectionCancelled(id, actor.sub)
    return this.get(id, actor)
  }

  async start(id: string, actor: Actor) {
    const record = await this.accessible(id, actor)
    this.assignedInspector(record, actor)
    const changed = await this.prisma.inspection.updateMany({ where: { id, status: InspectionStatus.SCHEDULED }, data: { status: InspectionStatus.IN_PROGRESS } })
    if (!changed.count) throw new ConflictException('This inspection cannot be started')
    await this.prisma.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'INSPECTION_STARTED', entityType: 'INSPECTION', entityId: id, summary: 'Inspector started an inspection' } })
    void this.notifier.inspectionProgress(id, 'started', actor.sub)
    return this.get(id, actor)
  }

  async completeVisit(id: string, actor: Actor) {
    const record = await this.accessible(id, actor)
    this.assignedInspector(record, actor)
    const changed = await this.prisma.inspection.updateMany({ where: { id, status: InspectionStatus.IN_PROGRESS }, data: { status: InspectionStatus.COMPLETED, completedAt: new Date() } })
    if (!changed.count) throw new ConflictException('Start the inspection before completing the visit')
    await this.prisma.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'INSPECTION_VISIT_COMPLETED', entityType: 'INSPECTION', entityId: id, summary: 'Inspector completed an inspection visit' } })
    void this.notifier.inspectionProgress(id, 'visit completed', actor.sub)
    return this.get(id, actor)
  }

  async submitReport(id: string, dto: SubmitInspectionReportDto, actor: Actor) {
    const record = await this.accessible(id, actor)
    this.assignedInspector(record, actor)
    if (record.status !== InspectionStatus.COMPLETED) throw new ConflictException('Complete the visit before submitting its report')
    const recommendations = dto.recommendations.map((item) => item.trim()).filter(Boolean)
    if (!recommendations.length) throw new BadRequestException('Add at least one recommendation')
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.inspection.updateMany({ where: { id, status: InspectionStatus.COMPLETED }, data: { status: InspectionStatus.REPORT_READY } })
      if (!changed.count) throw new ConflictException('This report has already been submitted')
      await tx.inspectionReport.create({ data: { inspectionId: id, overview: dto.overview.trim(), recommendations, findings: { create: dto.findings.map((finding, position) => ({ area: finding.area.trim(), title: finding.title.trim(), severity: finding.severity, detail: finding.detail.trim(), recommendation: finding.recommendation.trim(), position })) } } })
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'INSPECTION_REPORT_SUBMITTED', entityType: 'INSPECTION', entityId: id, summary: 'Inspector submitted an inspection report' } })
    })
    void this.notifier.inspectionReportReady(id, actor.sub)
    return this.get(id, actor)
  }

  async startEvidence(id: string, dto: StartInspectionEvidenceDto, actor: Actor) {
    const record = await this.accessible(id, actor)
    this.assignedInspector(record, actor)
    if (record.status !== InspectionStatus.IN_PROGRESS && record.status !== InspectionStatus.COMPLETED) throw new ConflictException('Evidence can only be added before the report is submitted')
    const allowed = dto.type === InspectionEvidenceType.PHOTO ? ['image/jpeg', 'image/png', 'image/webp'] : ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowed.includes(dto.contentType)) throw new BadRequestException('Unsupported evidence type')
    const cleanName = dto.fileName.trim().replace(/[\\/\x00-\x1f]/g, '_')
    if (!cleanName || !dto.caption.trim()) throw new BadRequestException('Evidence name and caption are required')
    const ready = await this.prisma.inspectionEvidence.count({ where: { inspectionId: id, status: InspectionEvidenceStatus.READY } })
    if (ready >= 30) throw new BadRequestException('Inspection evidence limit reached')
    const pending = await this.prisma.inspectionEvidence.count({ where: { inspectionId: id, status: InspectionEvidenceStatus.PENDING, createdAt: { gt: new Date(Date.now() - uploadLifetime) } } })
    if (pending >= 5) throw new BadRequestException('Too many evidence uploads in progress')
    const objectKey = `pending/inspections/${id}/${randomUUID()}`
    const evidence = await this.prisma.inspectionEvidence.create({ data: { inspectionId: id, uploaderId: actor.sub, type: dto.type, objectKey, originalName: cleanName, caption: dto.caption.trim(), contentType: dto.contentType, sizeBytes: dto.sizeBytes } })
    try { return { id: evidence.id, uploadUrl: await this.storage.signUpload(objectKey), expiresInSeconds: 7200 } }
    catch (error) { await this.prisma.inspectionEvidence.delete({ where: { id: evidence.id } }); throw error }
  }

  async completeEvidence(id: string, evidenceId: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "inspections" WHERE "id" = ${id}::uuid FOR UPDATE`
      const record = await this.accessible(id, actor, tx)
      this.assignedInspector(record, actor)
      await tx.$queryRaw`SELECT "id" FROM "inspection_evidence" WHERE "id" = ${evidenceId}::uuid FOR UPDATE`
      const evidence = await tx.inspectionEvidence.findFirst({ where: { id: evidenceId, inspectionId: id } })
      if (!evidence) throw new NotFoundException('Evidence not found')
      if (evidence.status === InspectionEvidenceStatus.READY) return
      if (record.status !== InspectionStatus.IN_PROGRESS && record.status !== InspectionStatus.COMPLETED) throw new ConflictException('Evidence can no longer be added')
      if (evidence.uploaderId !== actor.sub) throw new ForbiddenException()
      if (Date.now() - evidence.createdAt.getTime() > uploadLifetime) throw new BadRequestException('Evidence upload expired')
      const bytes = await this.storage.download(evidence.objectKey, evidence.sizeBytes)
      if (bytes.length !== evidence.sizeBytes || fileSignature(bytes) !== evidence.contentType) throw new BadRequestException('Evidence does not match its declared type or size')
      const readyKey = `inspections/${id}/${evidence.id}`
      await this.storage.move(evidence.objectKey, readyKey)
      await tx.inspectionEvidence.update({ where: { id: evidence.id }, data: { objectKey: readyKey, status: InspectionEvidenceStatus.READY, completedAt: new Date() } })
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'INSPECTION_EVIDENCE_ADDED', entityType: 'INSPECTION', entityId: id, summary: 'Inspector added inspection evidence' } })
    }, { maxWait: 5_000, timeout: 90_000 })
    return this.get(id, actor)
  }

  async evidenceUrl(id: string, evidenceId: string, actor: Actor, download?: string) {
    const record = await this.accessible(id, actor)
    if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.INSPECTOR && record.status !== InspectionStatus.REPORT_READY) throw new NotFoundException('Evidence not found')
    const evidence = await this.prisma.inspectionEvidence.findFirst({ where: { id: evidenceId, inspectionId: id, status: InspectionEvidenceStatus.READY } })
    if (!evidence) throw new NotFoundException('Evidence not found')
    if (download !== undefined && download !== 'true' && download !== 'false') throw new BadRequestException('Invalid download option')
    const asDownload = download === undefined ? evidence.type === InspectionEvidenceType.DOCUMENT : download === 'true'
    return { url: await this.storage.signedDownload(evidence.objectKey, asDownload), expiresInSeconds: 60 }
  }

  async removeEvidence(id: string, evidenceId: string, actor: Actor) {
    const record = await this.accessible(id, actor)
    this.assignedInspector(record, actor)
    if (record.status !== InspectionStatus.IN_PROGRESS && record.status !== InspectionStatus.COMPLETED) throw new ConflictException('Evidence can no longer be removed')
    const evidence = await this.prisma.inspectionEvidence.findFirst({ where: { id: evidenceId, inspectionId: id } })
    if (!evidence) throw new NotFoundException('Evidence not found')
    await this.storage.remove(evidence.objectKey)
    await this.prisma.inspectionEvidence.delete({ where: { id: evidence.id } })
    return { deleted: true }
  }
}
