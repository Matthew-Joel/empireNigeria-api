import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, PropertyFilePurpose, PropertyFileStatus, PropertyOccupancy, PropertyStatus, StayListingStatus, UserRole } from '@prisma/client'
import { AuthenticatedRequest } from '../../common/types/request-with-user'
import { PrismaService } from '../../database/prisma.service'
import { SupabaseStorageService } from '../storage/supabase-storage.service'
import { ReviewStayListingDto, SaveStayListingDto, StayBlockDto } from './dto/stay.dto'

type Actor = AuthenticatedRequest['user']
const listingInclude = { property: { include: { files: { where: { purpose: PropertyFilePurpose.PHOTO, status: PropertyFileStatus.READY }, orderBy: [{ isCover: 'desc' as const }, { createdAt: 'asc' as const }], take: 1 } } }, blocks: { orderBy: { startDate: 'asc' as const } } } satisfies Prisma.StayListingInclude
type Listing = Prisma.StayListingGetPayload<{ include: typeof listingInclude }>

@Injectable()
export class StayService {
  constructor(private readonly prisma: PrismaService, private readonly storage: SupabaseStorageService) {}

  private day(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Use YYYY-MM-DD dates')
    const date = new Date(`${value}T00:00:00.000Z`)
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid date')
    return date
  }

  private async output(item: Listing) {
    const photo = item.property.files[0]
    return { id: item.id, propertyId: item.propertyId, name: item.title, propertyType: item.property.type,
      city: item.property.city, state: item.property.state, country: item.property.country, address: item.property.address,
      description: item.description, hostNote: item.hostNote, pricePerNight: item.pricePerNightNgn,
      cleaningFee: item.cleaningFeeNgn, currency: 'NGN', guests: item.maxGuests, bedrooms: item.bedrooms,
      bathrooms: item.bathrooms, minimumNights: item.minimumNights, amenities: item.amenities, houseRules: item.houseRules,
      status: item.status, reviewNote: item.reviewNote, imageUrl: photo ? await this.storage.signedDownload(photo.objectKey, false) : null,
      blocks: item.blocks.map((block) => ({ id: block.id, startDate: block.startDate.toISOString().slice(0, 10), endDate: block.endDate.toISOString().slice(0, 10), reason: block.reason })),
      createdAt: item.createdAt, updatedAt: item.updatedAt }
  }

  private async owned(id: string, actor: Actor) {
    const item = await this.prisma.stayListing.findUnique({ where: { id }, include: listingInclude })
    if (!item) throw new NotFoundException('Stay listing not found')
    if (actor.role !== UserRole.ADMIN && item.property.ownerId !== actor.sub) throw new NotFoundException('Stay listing not found')
    return item
  }

  async list(filters: { location?: string; checkIn?: string; checkOut?: string; guests?: string }) {
    const location = filters.location?.trim().slice(0, 100)
    const guests = filters.guests ? Number(filters.guests) : undefined
    if (guests !== undefined && (!Number.isInteger(guests) || guests < 1 || guests > 50)) throw new BadRequestException('Invalid guest count')
    let dates: { start: Date; end: Date } | undefined
    if (filters.checkIn || filters.checkOut) {
      if (!filters.checkIn || !filters.checkOut) throw new BadRequestException('Choose both dates')
      const start = this.day(filters.checkIn), end = this.day(filters.checkOut)
      if (end <= start) throw new BadRequestException('Check-out must follow check-in')
      dates = { start, end }
    }
    const rows = await this.prisma.stayListing.findMany({ where: { status: StayListingStatus.PUBLISHED, property: { status: PropertyStatus.APPROVED, occupancyStatus: PropertyOccupancy.AVAILABLE_FOR_SHORT_LET, ...(location ? { OR: [{ city: { contains: location, mode: 'insensitive' } }, { state: { contains: location, mode: 'insensitive' } }] } : {}) }, ...(guests ? { maxGuests: { gte: guests } } : {}), ...(dates ? { blocks: { none: { startDate: { lt: dates.end }, endDate: { gt: dates.start } } }, bookings: { none: { status: { in: ['REQUESTED', 'CONFIRMED'] }, checkIn: { lt: dates.end }, checkOut: { gt: dates.start } } } } : {}) }, include: listingInclude, take: 50, orderBy: { createdAt: 'desc' } })
    return Promise.all(rows.filter((item) => !dates || Math.round((dates.end.getTime() - dates.start.getTime()) / 86_400_000) >= item.minimumNights).map((item) => this.output(item)))
  }

  async get(id: string) {
    const item = await this.prisma.stayListing.findFirst({ where: { id, status: StayListingStatus.PUBLISHED, property: { status: PropertyStatus.APPROVED, occupancyStatus: PropertyOccupancy.AVAILABLE_FOR_SHORT_LET } }, include: listingInclude })
    if (!item) throw new NotFoundException('Stay listing not found')
    return this.output(item)
  }

  async mine(actor: Actor) {
    if (actor.role !== UserRole.OWNER && actor.role !== UserRole.ADMIN) throw new ForbiddenException()
    const rows = await this.prisma.stayListing.findMany({ where: actor.role === UserRole.OWNER ? { property: { ownerId: actor.sub } } : {}, include: listingInclude, orderBy: { createdAt: 'desc' } })
    return Promise.all(rows.map((row) => this.output(row)))
  }

  async create(dto: SaveStayListingDto, actor: Actor) {
    if (actor.role !== UserRole.OWNER) throw new ForbiddenException()
    const property = await this.prisma.property.findUnique({ where: { id: dto.propertyId } })
    if (!property || property.ownerId !== actor.sub) throw new NotFoundException('Property not found')
    if (property.status !== PropertyStatus.APPROVED) throw new BadRequestException('Only approved properties can be listed')
    if (await this.prisma.stayListing.findUnique({ where: { propertyId: dto.propertyId } })) throw new ConflictException('This property already has a Stay listing')
    const row = await this.prisma.stayListing.create({ data: this.fields(dto) })
    await this.audit(actor, 'STAY_LISTING_CREATED', row.id, 'Owner created a Stay listing')
    return this.ownedOutput(row.id, actor)
  }

  private fields(dto: SaveStayListingDto) {
    return { propertyId: dto.propertyId, title: dto.title.trim(), description: dto.description.trim(), hostNote: dto.hostNote.trim(), pricePerNightNgn: dto.pricePerNightNgn, cleaningFeeNgn: dto.cleaningFeeNgn, maxGuests: dto.maxGuests, bedrooms: dto.bedrooms, bathrooms: dto.bathrooms, minimumNights: dto.minimumNights, amenities: dto.amenities.map((x) => x.trim()).filter(Boolean).slice(0, 30), houseRules: dto.houseRules.map((x) => x.trim()).filter(Boolean).slice(0, 20) }
  }

  private async ownedOutput(id: string, actor: Actor) { return this.output(await this.owned(id, actor)) }

  async update(id: string, dto: SaveStayListingDto, actor: Actor) {
    const item = await this.owned(id, actor)
    if (actor.role !== UserRole.OWNER || item.property.ownerId !== actor.sub) throw new ForbiddenException()
    if (item.propertyId !== dto.propertyId) throw new BadRequestException('A listing cannot change property')
    if (item.status === StayListingStatus.PUBLISHED || item.status === StayListingStatus.ARCHIVED) throw new ConflictException('Contact an administrator to change a published listing')
    await this.prisma.stayListing.update({ where: { id }, data: { ...this.fields(dto), status: StayListingStatus.DRAFT, reviewNote: null } })
    await this.audit(actor, 'STAY_LISTING_UPDATED', id, 'Owner updated a Stay listing')
    return this.ownedOutput(id, actor)
  }

  async submit(id: string, actor: Actor) {
    const item = await this.owned(id, actor)
    if (actor.role !== UserRole.OWNER || item.property.ownerId !== actor.sub) throw new ForbiddenException()
    if (item.status !== StayListingStatus.DRAFT && item.status !== StayListingStatus.REJECTED) throw new ConflictException('This listing cannot be submitted')
    await this.prisma.stayListing.update({ where: { id }, data: { status: StayListingStatus.PENDING_REVIEW } })
    await this.audit(actor, 'STAY_LISTING_SUBMITTED', id, 'Owner submitted a Stay listing for review')
    return this.ownedOutput(id, actor)
  }

  async review(id: string, dto: ReviewStayListingDto, actor: Actor) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException()
    const item = await this.owned(id, actor)
    if (item.status !== StayListingStatus.PENDING_REVIEW) throw new ConflictException('Listing is not awaiting review')
    if (dto.decision !== 'PUBLISH' && dto.decision !== 'REJECT') throw new BadRequestException('Invalid decision')
    if (dto.decision === 'PUBLISH' && (item.property.status !== PropertyStatus.APPROVED || item.property.occupancyStatus !== PropertyOccupancy.AVAILABLE_FOR_SHORT_LET)) throw new BadRequestException('Property must be approved and marked available for short let')
    if (dto.decision === 'REJECT' && (dto.note?.trim().length ?? 0) < 10) throw new BadRequestException('Explain the rejection')
    await this.prisma.stayListing.update({ where: { id }, data: { status: dto.decision === 'PUBLISH' ? StayListingStatus.PUBLISHED : StayListingStatus.REJECTED, reviewNote: dto.note?.trim() || null } })
    await this.audit(actor, dto.decision === 'PUBLISH' ? 'STAY_LISTING_PUBLISHED' : 'STAY_LISTING_REJECTED', id, `Administrator ${dto.decision === 'PUBLISH' ? 'published' : 'rejected'} a Stay listing`)
    return this.ownedOutput(id, actor)
  }

  async block(id: string, dto: StayBlockDto, actor: Actor) {
    await this.owned(id, actor)
    const startDate = this.day(dto.startDate), endDate = this.day(dto.endDate)
    if (endDate <= startDate || startDate < this.day(new Date().toISOString().slice(0, 10))) throw new BadRequestException('Choose future dates in order')
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "stay_listings" WHERE "id" = ${id}::uuid FOR UPDATE`
      const conflict = await tx.booking.count({ where: { listingId: id, status: { in: ['REQUESTED', 'CONFIRMED'] }, checkIn: { lt: endDate }, checkOut: { gt: startDate } } })
      if (conflict) throw new ConflictException('Dates overlap an active booking')
      await tx.stayBlock.create({ data: { listingId: id, startDate, endDate, reason: dto.reason.trim() } })
      await tx.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action: 'STAY_DATES_BLOCKED', entityType: 'STAY', entityId: id, summary: 'Stay dates blocked' } })
    })
    return this.ownedOutput(id, actor)
  }

  async unblock(id: string, blockId: string, actor: Actor) {
    await this.owned(id, actor)
    const deleted = await this.prisma.stayBlock.deleteMany({ where: { id: blockId, listingId: id } })
    if (!deleted.count) throw new NotFoundException('Date block not found')
    await this.audit(actor, 'STAY_DATES_UNBLOCKED', id, 'Stay dates unblocked')
    return this.ownedOutput(id, actor)
  }

  async availability(id: string, from: string, to: string) {
    const item = await this.prisma.stayListing.findFirst({ where: { id, status: StayListingStatus.PUBLISHED, property: { status: PropertyStatus.APPROVED, occupancyStatus: PropertyOccupancy.AVAILABLE_FOR_SHORT_LET } }, select: { id: true, minimumNights: true } })
    if (!item) throw new NotFoundException('Stay listing not found')
    const start = this.day(from), end = this.day(to)
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000)
    if (days < 1 || days > 120) throw new BadRequestException('Choose a range of 1 to 120 days')
    const [blocks, bookings] = await Promise.all([
      this.prisma.stayBlock.findMany({ where: { listingId: id, startDate: { lt: end }, endDate: { gt: start } } }),
      this.prisma.booking.findMany({ where: { listingId: id, status: { in: ['REQUESTED', 'CONFIRMED'] }, checkIn: { lt: end }, checkOut: { gt: start } } }),
    ])
    return Array.from({ length: days }, (_, i) => {
      const date = new Date(start.getTime() + i * 86_400_000)
      return { date: date.toISOString().slice(0, 10), available: !blocks.some((x) => x.startDate <= date && x.endDate > date) && !bookings.some((x) => x.checkIn <= date && x.checkOut > date), minimumNights: item.minimumNights }
    })
  }

  private audit(actor: Actor, action: string, entityId: string, summary: string) { return this.prisma.auditEvent.create({ data: { actorId: actor.sub, actorRole: actor.role, action, entityType: 'STAY', entityId, summary } }) }
}
