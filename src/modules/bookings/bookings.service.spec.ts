import { ConflictException, ForbiddenException } from '@nestjs/common'
import { BookingStatus, PropertyOccupancy, PropertyStatus, StayListingStatus, UserRole } from '@prisma/client'
import { BookingsService } from './bookings.service'

const guest = { sub: 'guest-id', email: 'guest@example.com', role: UserRole.GUEST }
const owner = { sub: 'owner-id', email: 'owner@example.com', role: UserRole.OWNER }
const listing = { id: 'listing-id', status: StayListingStatus.PUBLISHED, maxGuests: 4, minimumNights: 2, pricePerNightNgn: 50000, cleaningFeeNgn: 10000, property: { status: PropertyStatus.APPROVED, occupancyStatus: PropertyOccupancy.AVAILABLE_FOR_SHORT_LET } }
const date = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
function setup() {
  const db = {
    stayListing: { findUnique: jest.fn().mockResolvedValue(listing) },
    stayBlock: { count: jest.fn().mockResolvedValue(0) },
    booking: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'booking-id' }), findUnique: jest.fn().mockResolvedValue({ id: 'booking-id', reference: 'EN-TEST', listingId: listing.id, guestId: guest.sub, checkIn: new Date(`${date(2)}T00:00:00Z`), checkOut: new Date(`${date(4)}T00:00:00Z`), guests: 2, guestName: 'Test Guest', guestEmail: guest.email, guestPhone: '+2348000000000', nightlyRateNgn: 50000, cleaningFeeNgn: 10000, subtotalNgn: 100000, totalNgn: 110000, status: BookingStatus.REQUESTED, decisionNote: null, createdAt: new Date(), updatedAt: new Date(), listing: { property: { id: 'property-id', ownerId: owner.sub, managerId: null, name: 'Test Home', address: '1 Road', city: 'Lagos', state: 'Lagos' } } }) },
    auditEvent: { create: jest.fn() },
    $queryRaw: jest.fn(), $transaction: jest.fn(),
  }
  db.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(db))
  return { service: new BookingsService(db as never), db }
}
describe('BookingsService', () => {
  const input = () => ({ listingId: listing.id, checkIn: date(2), checkOut: date(4), guests: 2, guestName: 'Test Guest', guestEmail: guest.email, guestPhone: '+2348000000000' })
  it('allows only guests to request a stay', async () => {
    const { service, db } = setup()
    await expect(service.create(input(), owner)).rejects.toBeInstanceOf(ForbiddenException)
    expect(db.booking.create).not.toHaveBeenCalled()
  })
  it('rejects overlapping dates while holding the listing lock', async () => {
    const { service, db } = setup()
    db.booking.count.mockResolvedValue(1)
    await expect(service.create(input(), guest)).rejects.toBeInstanceOf(ConflictException)
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    expect(db.booking.create).not.toHaveBeenCalled()
  })
  it('stores a price snapshot and audit event for a free booking request', async () => {
    const { service, db } = setup()
    const result = await service.create(input(), guest)
    expect(db.booking.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ nightlyRateNgn: 50000, subtotalNgn: 100000, totalNgn: 110000, guestId: guest.sub }) }))
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'BOOKING_REQUESTED' }) }))
    expect(result.status).toBe(BookingStatus.REQUESTED)
    expect(result.total).toBe(110000)
  })
})
