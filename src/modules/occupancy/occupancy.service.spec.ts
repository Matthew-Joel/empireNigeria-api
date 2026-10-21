import { ConflictException, NotFoundException } from '@nestjs/common'
import { BookingStatus, PropertyOccupancy, PropertyStatus, UserRole } from '@prisma/client'
import { OccupancyService } from './occupancy.service'

const owner = { sub: 'owner-id', email: 'owner@example.com', role: UserRole.OWNER }
const propertyId = 'property-id'
const input = { status: PropertyOccupancy.VACANT, note: 'Property is ready for a new tenant' }

function setup() {
  const steps: string[] = []
  const tx = {
    $queryRaw: jest.fn().mockImplementation(async () => { steps.push('lock') }),
    property: {
      findFirst: jest.fn().mockImplementation(async () => { steps.push('read'); return { id: propertyId, stayListing: { id: 'current-listing-id' } } }),
      update: jest.fn().mockImplementation(async () => { steps.push('update') }),
    },
    booking: { count: jest.fn().mockImplementation(async () => { steps.push('count'); return 0 }) },
    occupancyEvent: { create: jest.fn().mockImplementation(async () => { steps.push('event') }) },
    auditEvent: { create: jest.fn().mockImplementation(async () => { steps.push('audit') }) },
  }
  const db = {
    property: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: propertyId }]) },
    booking: { count: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)),
  }
  return { service: new OccupancyService(db as never), db, tx, steps }
}

describe('OccupancyService', () => {
  it('rejects changing occupancy with upcoming bookings without writing any records', async () => {
    const { service, db, tx, steps } = setup()
    tx.booking.count.mockImplementation(async () => { steps.push('count'); return 1 })

    await expect(service.update(propertyId, input, owner)).rejects.toBeInstanceOf(ConflictException)

    expect(steps).toEqual(['lock', 'read', 'count'])
    expect(tx.booking.count).toHaveBeenCalledWith({ where: { listingId: 'current-listing-id', status: { in: [BookingStatus.REQUESTED, BookingStatus.CONFIRMED] }, checkOut: { gt: expect.any(Date) } } })
    expect(tx.property.update).not.toHaveBeenCalled()
    expect(tx.occupancyEvent.create).not.toHaveBeenCalled()
    expect(tx.auditEvent.create).not.toHaveBeenCalled()
    expect(db.property.findFirst).not.toHaveBeenCalled()
    expect(db.booking.count).not.toHaveBeenCalled()
  })

  it('locks the listing, reads its current relation, and checks bookings before updating and auditing', async () => {
    const { service, db, tx, steps } = setup()

    await expect(service.update(propertyId, input, owner)).resolves.toEqual([{ id: propertyId }])

    expect(steps).toEqual(['lock', 'read', 'count', 'update', 'event', 'audit'])
    const [query, lockedPropertyId] = tx.$queryRaw.mock.calls[0]
    expect(query.join('?')).toContain('FROM "stay_listings" WHERE "propertyId" = ?::uuid FOR UPDATE')
    expect(lockedPropertyId).toBe(propertyId)
    expect(tx.property.findFirst).toHaveBeenCalledWith({ where: { id: propertyId, status: { not: PropertyStatus.DRAFT }, ownerId: owner.sub }, include: { stayListing: true } })
    expect(tx.property.update).toHaveBeenCalledWith({ where: { id: propertyId }, data: { occupancyStatus: PropertyOccupancy.VACANT, tenantName: null, tenantPhone: null, tenancyStart: null } })
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'OCCUPANCY_UPDATED', actorId: owner.sub }) }))
    expect(db.property.findFirst).not.toHaveBeenCalled()
    expect(db.booking.count).not.toHaveBeenCalled()
  })

  it('keeps the property lookup scoped to the actor inside the transaction', async () => {
    const { service, tx } = setup()
    tx.property.findFirst.mockResolvedValue(null)

    await expect(service.update(propertyId, input, owner)).rejects.toBeInstanceOf(NotFoundException)

    expect(tx.property.findFirst).toHaveBeenCalledWith({ where: { id: propertyId, status: { not: PropertyStatus.DRAFT }, ownerId: owner.sub }, include: { stayListing: true } })
    expect(tx.booking.count).not.toHaveBeenCalled()
    expect(tx.property.update).not.toHaveBeenCalled()
    expect(tx.auditEvent.create).not.toHaveBeenCalled()
  })

  it.each([UserRole.ADMIN, UserRole.OWNER, UserRole.PROPERTY_MANAGER])('excludes unfinished property drafts from %s occupancy', async (role) => {
    const { service, db } = setup()
    await service.list({ ...owner, role })
    expect(db.property.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { not: PropertyStatus.DRAFT } }) }))
  })
})
