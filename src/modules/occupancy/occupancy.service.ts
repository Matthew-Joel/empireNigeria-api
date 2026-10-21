import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { BookingStatus, Prisma, PropertyOccupancy, PropertyStatus, UserRole } from '@prisma/client'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { PrismaService } from '../../database/prisma.service'
import { UpdateOccupancyDto } from './dto/occupancy.dto'

type Actor = AuthenticatedRequest['user']
@Injectable()
export class OccupancyService {
  constructor(private readonly prisma: PrismaService) {}
  private where(actor: Actor): Prisma.PropertyWhereInput {
    return { status: { not: PropertyStatus.DRAFT }, ...(actor.role === UserRole.ADMIN ? {} : actor.role === UserRole.OWNER ? { ownerId: actor.sub } : { managerId: actor.sub }) }
  }
  list(actor: Actor) {
    return this.prisma.property.findMany({ where: this.where(actor), select: { id: true, name: true, city: true, state: true, ownerId: true, managerId: true, occupancyStatus: true, tenantName: true, tenantPhone: true, tenancyStart: true, stayListing: { select: { id: true, status: true } }, occupancyEvents: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, status: true, note: true, createdAt: true } } }, orderBy: { createdAt: 'desc' } })
  }
  async update(propertyId: string, dto: UpdateOccupancyDto, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      // Booking requests acquire this same row lock before checking occupancy.
      await tx.$queryRaw`SELECT "id" FROM "stay_listings" WHERE "propertyId" = ${propertyId}::uuid FOR UPDATE`
      const property = await tx.property.findFirst({ where: { id: propertyId, ...this.where(actor) }, include: { stayListing: true } })
      if (!property) throw new NotFoundException('Property not found')
      if (dto.status === PropertyOccupancy.OCCUPIED && (!dto.tenantName?.trim() || !dto.tenantPhone?.trim() || !dto.tenancyStart)) throw new BadRequestException('Tenant name, phone, and tenancy start are required')
      const tenancyStart = dto.status === PropertyOccupancy.OCCUPIED ? new Date(`${dto.tenancyStart}T00:00:00.000Z`) : null
      if (tenancyStart && Number.isNaN(tenancyStart.getTime())) throw new BadRequestException('Invalid tenancy start')
      if (property.stayListing && dto.status !== PropertyOccupancy.AVAILABLE_FOR_SHORT_LET) {
        const upcoming = await tx.booking.count({ where: { listingId: property.stayListing.id, status: { in: [BookingStatus.REQUESTED, BookingStatus.CONFIRMED] }, checkOut: { gt: new Date() } } })
        if (upcoming) throw new ConflictException('Resolve upcoming Stay bookings before changing occupancy')
      }
      await tx.property.update({ where: { id: propertyId }, data: { occupancyStatus: dto.status, tenantName: dto.status === PropertyOccupancy.OCCUPIED ? dto.tenantName!.trim() : null, tenantPhone: dto.status === PropertyOccupancy.OCCUPIED ? dto.tenantPhone!.trim() : null, tenancyStart } })
      await tx.occupancyEvent.create({ data: { propertyId, actorId: actor.sub, status: dto.status, note: dto.note.trim() } })
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'OCCUPANCY_UPDATED', entityType: 'PROPERTY', entityId: propertyId, summary: `Occupancy changed to ${dto.status.toLowerCase().replaceAll('_', ' ')}` } })
    })
    return this.list(actor)
  }
}
