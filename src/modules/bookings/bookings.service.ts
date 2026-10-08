import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { BookingStatus, Prisma, PropertyOccupancy, PropertyStatus, StayListingStatus, UserRole } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { PrismaService } from '../../database/prisma.service'
import { CreateBookingDto, DecideBookingDto } from './dto/booking.dto'

type Actor = AuthenticatedRequest['user']
const bookingInclude = { listing: { include: { property: { select: { id: true, ownerId: true, managerId: true, name: true, address: true, city: true, state: true } } } } } satisfies Prisma.BookingInclude
type BookingRecord = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  private date(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Use YYYY-MM-DD dates')
    const date = new Date(`${value}T00:00:00.000Z`)
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid date')
    return date
  }

  private output(row: BookingRecord) {
    const nights = Math.round((row.checkOut.getTime() - row.checkIn.getTime()) / 86_400_000)
    return { id: row.id, reference: row.reference, listingId: row.listingId, propertyId: row.listing.property.id,
      propertyName: row.listing.property.name, propertyLocation: `${row.listing.property.city}, ${row.listing.property.state}`,
      checkIn: row.checkIn.toISOString().slice(0, 10), checkOut: row.checkOut.toISOString().slice(0, 10), nights,
      guests: row.guests, guestId: row.guestId, guestName: row.guestName, guestEmail: row.guestEmail, guestPhone: row.guestPhone,
      pricePerNight: row.nightlyRateNgn, currency: 'NGN', subtotal: row.subtotalNgn, cleaningFee: row.cleaningFeeNgn,
      total: row.totalNgn, status: row.status, decisionNote: row.decisionNote, createdAt: row.createdAt, updatedAt: row.updatedAt }
  }

  private allowed(row: BookingRecord, actor: Actor) {
    return actor.role === UserRole.ADMIN || row.guestId === actor.sub || row.listing.property.ownerId === actor.sub || row.listing.property.managerId === actor.sub
  }

  async list(actor: Actor) {
    const where: Prisma.BookingWhereInput = actor.role === UserRole.ADMIN ? {}
      : actor.role === UserRole.GUEST ? { guestId: actor.sub }
      : actor.role === UserRole.OWNER ? { listing: { property: { ownerId: actor.sub } } }
      : actor.role === UserRole.PROPERTY_MANAGER ? { listing: { property: { managerId: actor.sub } } }
      : { id: '__none__' }
    const rows = await this.prisma.booking.findMany({ where, include: bookingInclude, orderBy: { createdAt: 'desc' }, take: 200 })
    return rows.map((row) => this.output(row))
  }

  async get(id: string, actor: Actor) {
    const row = await this.prisma.booking.findUnique({ where: { id }, include: bookingInclude })
    if (!row || !this.allowed(row, actor)) throw new NotFoundException('Booking not found')
    return this.output(row)
  }

  async create(dto: CreateBookingDto, actor: Actor) {
    if (actor.role !== UserRole.GUEST) throw new ForbiddenException('Only guest accounts can request a stay')
    const checkIn = this.date(dto.checkIn), checkOut = this.date(dto.checkOut)
    const today = this.date(new Date().toISOString().slice(0, 10))
    const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000)
    if (checkIn < today || nights < 1 || nights > 90) throw new BadRequestException('Choose future dates for a stay of 1 to 90 nights')
    const listing = await this.prisma.stayListing.findUnique({ where: { id: dto.listingId }, include: { property: { select: { status: true, occupancyStatus: true } } } })
    if (!listing || listing.status !== StayListingStatus.PUBLISHED || listing.property.status !== PropertyStatus.APPROVED || listing.property.occupancyStatus !== PropertyOccupancy.AVAILABLE_FOR_SHORT_LET) throw new NotFoundException('Stay listing not available')
    if (dto.guests > listing.maxGuests || nights < listing.minimumNights) throw new BadRequestException('Guest count or minimum stay is not valid for this listing')
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "stay_listings" WHERE "id" = ${dto.listingId}::uuid FOR UPDATE`
      const current = await tx.stayListing.findUnique({ where: { id: dto.listingId }, include: { property: { select: { status: true, occupancyStatus: true } } } })
      if (!current || current.status !== StayListingStatus.PUBLISHED || current.property.status !== PropertyStatus.APPROVED || current.property.occupancyStatus !== PropertyOccupancy.AVAILABLE_FOR_SHORT_LET) throw new ConflictException('Stay listing is no longer available')
      const [blocks, bookings] = await Promise.all([
        tx.stayBlock.count({ where: { listingId: dto.listingId, startDate: { lt: checkOut }, endDate: { gt: checkIn } } }),
        tx.booking.count({ where: { listingId: dto.listingId, status: { in: [BookingStatus.REQUESTED, BookingStatus.CONFIRMED] }, checkIn: { lt: checkOut }, checkOut: { gt: checkIn } } }),
      ])
      if (blocks || bookings) throw new ConflictException('These dates are no longer available')
      const subtotal = current.pricePerNightNgn * nights
      const created = await tx.booking.create({ data: { reference: `EN-${randomUUID().slice(0, 12).toUpperCase()}`, listingId: dto.listingId, guestId: actor.sub,
        checkIn, checkOut, guests: dto.guests, guestName: dto.guestName.trim(), guestEmail: dto.guestEmail.trim().toLowerCase(),
        guestPhone: dto.guestPhone.trim(), nightlyRateNgn: current.pricePerNightNgn, cleaningFeeNgn: current.cleaningFeeNgn,
        subtotalNgn: subtotal, totalNgn: subtotal + current.cleaningFeeNgn } })
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'BOOKING_REQUESTED', entityType: 'BOOKING', entityId: created.id, summary: 'Guest requested a Stay booking' } })
      return created
    })
    return this.get(row.id, actor)
  }

  async decide(id: string, dto: DecideBookingDto, actor: Actor) {
    if (actor.role !== UserRole.OWNER && actor.role !== UserRole.ADMIN) throw new ForbiddenException()
    const row = await this.prisma.booking.findUnique({ where: { id }, include: bookingInclude })
    if (!row || !this.allowed(row, actor)) throw new NotFoundException('Booking not found')
    if (row.status !== BookingStatus.REQUESTED) throw new ConflictException('Only requested bookings can be decided')
    if (dto.decision === 'DECLINE' && (dto.note?.trim().length ?? 0) < 10) throw new BadRequestException('Explain why the booking was declined')
    const status = dto.decision === 'CONFIRM' ? BookingStatus.CONFIRMED : BookingStatus.DECLINED
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.booking.updateMany({ where: { id, status: BookingStatus.REQUESTED }, data: { status, decisionNote: dto.note?.trim() || null } })
      if (!changed.count) throw new ConflictException('Booking has already changed')
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: `BOOKING_${status}`, entityType: 'BOOKING', entityId: id, summary: `Booking ${status.toLowerCase()}` } })
    })
    return this.get(id, actor)
  }

  async cancel(id: string, actor: Actor) {
    const row = await this.prisma.booking.findUnique({ where: { id }, include: bookingInclude })
    if (!row || !this.allowed(row, actor)) throw new NotFoundException('Booking not found')
    if (actor.role === UserRole.PROPERTY_MANAGER) throw new ForbiddenException()
    if (actor.role === UserRole.GUEST && row.guestId !== actor.sub) throw new ForbiddenException()
    if ((row.status !== BookingStatus.REQUESTED && row.status !== BookingStatus.CONFIRMED) || row.checkIn <= new Date()) throw new ConflictException('This booking can no longer be cancelled')
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.booking.updateMany({ where: { id, status: { in: [BookingStatus.REQUESTED, BookingStatus.CONFIRMED] } }, data: { status: BookingStatus.CANCELLED } })
      if (!changed.count) throw new ConflictException('Booking has already changed')
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'BOOKING_CANCELLED', entityType: 'BOOKING', entityId: id, summary: 'Booking cancelled before check-in' } })
    })
    return this.get(id, actor)
  }

  async complete(id: string, actor: Actor) {
    if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.OWNER) throw new ForbiddenException()
    const row = await this.prisma.booking.findUnique({ where: { id }, include: bookingInclude })
    if (!row || !this.allowed(row, actor)) throw new NotFoundException('Booking not found')
    if (row.status !== BookingStatus.CONFIRMED || row.checkOut > new Date()) throw new ConflictException('Booking cannot be completed before check-out')
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.booking.updateMany({ where: { id, status: BookingStatus.CONFIRMED }, data: { status: BookingStatus.COMPLETED } })
      if (!changed.count) throw new ConflictException('Booking has already changed')
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'BOOKING_COMPLETED', entityType: 'BOOKING', entityId: id, summary: 'Stay booking marked completed' } })
    })
    return this.get(id, actor)
  }
}
