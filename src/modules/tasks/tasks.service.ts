import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ManagerTaskStatus, Prisma, PropertyStatus, UserRole } from '@prisma/client'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { PrismaService } from '../../database/prisma.service'
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto'

type Actor = AuthenticatedRequest['user']
const include = { property: { select: { id: true, name: true, ownerId: true, managerId: true, city: true } } } satisfies Prisma.ManagerTaskInclude
@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}
  list(actor: Actor) {
    const where: Prisma.ManagerTaskWhereInput = actor.role === UserRole.ADMIN ? {}
      : actor.role === UserRole.OWNER ? { property: { ownerId: actor.sub } }
      : actor.role === UserRole.PROPERTY_MANAGER ? { managerId: actor.sub } : { id: '__none__' }
    return this.prisma.managerTask.findMany({ where, include, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }] })
  }
  async create(dto: CreateTaskDto, actor: Actor) {
    const property = await this.prisma.property.findUnique({ where: { id: dto.propertyId }, select: { id: true, ownerId: true, managerId: true, status: true } })
    if (!property || (actor.role !== UserRole.ADMIN && property.ownerId !== actor.sub && property.managerId !== actor.sub)) throw new NotFoundException('Property not found')
    if (property.status === PropertyStatus.DRAFT) throw new BadRequestException('Submit the property before creating tasks')
    if (!property.managerId) throw new BadRequestException('Assign a property manager before creating tasks')
    let dueAt: Date | undefined
    if (dto.dueAt) {
      dueAt = new Date(dto.dueAt)
      if (Number.isNaN(dueAt.getTime()) || dueAt < new Date()) throw new BadRequestException('Due date must be in the future')
    }
    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.managerTask.create({ data: { propertyId: property.id, managerId: property.managerId!, createdById: actor.sub, title: dto.title.trim(), description: dto.description.trim(), dueAt }, include })
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'MANAGER_TASK_CREATED', entityType: 'TASK', entityId: created.id, summary: 'Property manager task created' } })
      return created
    })
    return task
  }
  async update(id: string, dto: UpdateTaskDto, actor: Actor) {
    const task = await this.prisma.managerTask.findUnique({ where: { id }, include })
    if (!task || (actor.role !== UserRole.ADMIN && task.managerId !== actor.sub && task.property.ownerId !== actor.sub)) throw new NotFoundException('Task not found')
    if (actor.role === UserRole.OWNER && dto.status !== ManagerTaskStatus.CANCELLED) throw new ForbiddenException('Only the manager can progress a task')
    if (task.status === ManagerTaskStatus.DONE || task.status === ManagerTaskStatus.CANCELLED) throw new ConflictException('Task is already closed')
    const allowed = dto.status === ManagerTaskStatus.CANCELLED ||
      (task.status === ManagerTaskStatus.OPEN && dto.status === ManagerTaskStatus.IN_PROGRESS) ||
      (task.status === ManagerTaskStatus.IN_PROGRESS && dto.status === ManagerTaskStatus.DONE)
    if (!allowed) throw new ConflictException('Invalid task status transition')
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.managerTask.updateMany({ where: { id, status: task.status }, data: { status: dto.status, completedAt: dto.status === ManagerTaskStatus.DONE ? new Date() : null } })
      if (!changed.count) throw new ConflictException('Task has already changed')
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: `MANAGER_TASK_${dto.status}`, entityType: 'TASK', entityId: id, summary: `Manager task moved to ${dto.status.toLowerCase().replaceAll('_', ' ')}` } })
      return tx.managerTask.findUniqueOrThrow({ where: { id }, include })
    })
  }
}
