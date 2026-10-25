/* Live non-payment workflow check. Creates run-scoped records and removes them. */
require('reflect-metadata')
// Fixture runs must not email real admins through the workflow notifier.
process.env.WORKFLOW_EMAILS_DISABLED = 'true'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { NestFactory } = require('@nestjs/core')
const { JwtService } = require('@nestjs/jwt')
const { AppModule } = require('../dist/app.module')
const { PrismaService } = require('../dist/database/prisma.service')
const { SupabaseStorageService } = require('../dist/modules/storage/supabase-storage.service')
const { configureApp } = require('../dist/app.setup')
const { submitPropertyWithOwnership } = require('./test-support/submit-property-with-ownership.cjs')

const date = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] })
  configureApp(app)
  const prisma = app.get(PrismaService)
  const storage = app.get(SupabaseStorageService)
  const jwt = app.get(JwtService)
  const run = randomUUID().slice(0, 12)
  const userIds = []
  const keys = new Set()
  let propertyId
  try {
    const users = {}
    for (const label of ['OWNER', 'GUEST', 'ADMIN', 'PROPERTY_MANAGER', 'OTHER']) {
      const role = label === 'OTHER' ? 'GUEST' : label
      const user = await prisma.user.create({ data: { email: `stay-smoke-${run}-${label.toLowerCase()}@example.invalid`, passwordHash: 'unused-test-fixture', role, status: 'ACTIVE', emailVerifiedAt: new Date() } })
      userIds.push(user.id)
      users[label] = { ...user, token: jwt.sign({ sub: user.id, email: user.email, role, version: 0 }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '20m' }) }
    }
    await app.listen(0, '127.0.0.1')
    const base = `${await app.getUrl()}/api/v1`
    async function request(path, method = 'GET', user, body) {
      const response = await fetch(base + path, { method, headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
      return { status: response.status, body: await response.json().catch(() => null) }
    }
    const home = await request('/properties', 'POST', users.OWNER, { name: 'Temporary Stay home', type: 'Apartment', description: 'Temporary approved property for live Stay workflow verification.', address: '1 Integration Street', city: 'Lagos', state: 'Lagos', country: 'Nigeria', occupancyStatus: 'VACANT' })
    assert.equal(home.status, 201, `Create property: ${JSON.stringify(home.body)}`)
    propertyId = home.body.id
    await submitPropertyWithOwnership({ request, prisma, propertyId, owner: users.OWNER, keys })
    assert.equal((await request(`/properties/${propertyId}/review`, 'PATCH', users.ADMIN, { status: 'UNDER_REVIEW' })).status, 200, 'Review submitted ownership proof')
    assert.equal((await request(`/properties/${propertyId}/review`, 'PATCH', users.ADMIN, { status: 'APPROVED' })).status, 200, 'Approve property')
    assert.equal((await request(`/properties/${propertyId}/manager`, 'PATCH', users.ADMIN, { managerId: users.PROPERTY_MANAGER.id })).status, 200, 'Assign manager')
    const occupancy = await request(`/occupancy/${propertyId}`, 'PATCH', users.PROPERTY_MANAGER, { status: 'AVAILABLE_FOR_SHORT_LET', note: 'Prepared and inspected for short let.' })
    assert.equal(occupancy.status, 200, `Set short-let occupancy: ${JSON.stringify(occupancy.body)}`)
    console.log('PASS property approval, manager assignment, and short-let occupancy')
    const listingInput = { propertyId, title: 'Temporary Stay home', description: 'A comfortable integration-test apartment near the city centre.', hostNote: 'A friendly host will share arrival details after confirmation.', pricePerNightNgn: 50000, cleaningFeeNgn: 10000, maxGuests: 3, bedrooms: 2, bathrooms: 2, minimumNights: 2, amenities: ['Wi-Fi', 'Air conditioning'], houseRules: ['No smoking'] }
    const drafted = await request('/stay', 'POST', users.OWNER, listingInput)
    assert.equal(drafted.status, 201, `Create listing: ${JSON.stringify(drafted.body)}`)
    const listingId = drafted.body.id
    assert.equal((await request(`/stay/${listingId}`)).status, 404, 'Draft hidden from public')
    assert.equal((await request(`/stay/${listingId}/submit`, 'POST', users.OWNER)).status, 201, 'Owner submits listing')
    assert.equal((await request(`/stay/${listingId}/review`, 'POST', users.OWNER, { decision: 'PUBLISH' })).status, 403, 'Owner cannot publish')
    assert.equal((await request(`/stay/${listingId}/review`, 'POST', users.ADMIN, { decision: 'PUBLISH' })).status, 201, 'Admin publishes')
    assert.equal((await request(`/stay/${listingId}`)).status, 200, 'Published listing public')
    const search = await request(`/stay?location=Lagos&checkIn=${date(3)}&checkOut=${date(5)}&guests=2`)
    assert.equal(search.status, 200)
    assert.ok(search.body.some((item) => item.id === listingId), 'Published listing appears in available search')
    console.log('PASS Stay draft privacy, admin publication, and public search')
    const input = { listingId, checkIn: date(3), checkOut: date(5), guests: 2, guestName: 'Integration Guest', guestEmail: users.GUEST.email, guestPhone: '+2348000000000' }
    const requested = await request('/bookings', 'POST', users.GUEST, input)
    assert.equal(requested.status, 201, `Guest requests booking: ${JSON.stringify(requested.body)}`)
    assert.equal(requested.body.status, 'REQUESTED')
    assert.equal(requested.body.total, 110000, 'Price snapshot contains nights and cleaning fee')
    assert.equal((await request(`/occupancy/${propertyId}`, 'PATCH', users.PROPERTY_MANAGER, { status: 'VACANT', note: 'Attempted occupancy change with an upcoming booking.' })).status, 409, 'Upcoming booking prevents incompatible occupancy')
    assert.equal((await request('/bookings', 'POST', users.OTHER, input)).status, 409, 'Overlapping request rejected')
    assert.equal((await request(`/bookings/${requested.body.id}`, 'GET', users.OTHER)).status, 404, 'Other guest cannot read booking')
    assert.equal((await request(`/bookings/${requested.body.id}/decision`, 'POST', users.OWNER, { decision: 'CONFIRM' })).status, 201, 'Owner confirms')
    assert.ok((await request('/bookings', 'GET', users.PROPERTY_MANAGER)).body.some((item) => item.id === requested.body.id), 'Assigned manager can track booking')
    assert.equal((await request(`/stay/${listingId}/blocks`, 'POST', users.OWNER, { startDate: date(3), endDate: date(5), reason: 'Attempted overlap' })).status, 409, 'Cannot block an active booking')
    assert.equal((await request(`/bookings/${requested.body.id}/cancel`, 'POST', users.GUEST)).status, 201, 'Guest cancels before check-in')
    const blocked = await request(`/stay/${listingId}/blocks`, 'POST', users.OWNER, { startDate: date(3), endDate: date(5), reason: 'Owner unavailable on these dates' })
    assert.equal(blocked.status, 201, 'Owner blocks released dates')
    assert.equal((await request('/bookings', 'POST', users.GUEST, input)).status, 409, 'Blocked dates reject bookings')
    assert.equal((await request(`/stay/${listingId}/blocks/${blocked.body.blocks[0].id}`, 'DELETE', users.OWNER)).status, 200, 'Owner unblocks dates')
    const simultaneous = await Promise.all([
      request('/bookings', 'POST', users.GUEST, input),
      request('/bookings', 'POST', users.OTHER, { ...input, guestEmail: users.OTHER.email }),
    ])
    assert.deepEqual(simultaneous.map((result) => result.status).sort(), [201, 409], 'Only one simultaneous booking reserves the same dates')
    const reserved = simultaneous.find((result) => result.status === 201).body
    assert.equal((await request(`/bookings/${reserved.id}/decision`, 'POST', users.OWNER, { decision: 'CONFIRM' })).status, 201)
    assert.equal((await request(`/bookings/${reserved.id}/complete`, 'POST', users.OWNER)).status, 409, 'Cannot complete before checkout')
    await prisma.booking.update({ where: { id: reserved.id }, data: { checkIn: new Date(`${date(-3)}T00:00:00.000Z`), checkOut: new Date(`${date(-1)}T00:00:00.000Z`) } })
    const completed = await request(`/bookings/${reserved.id}/complete`, 'POST', users.OWNER)
    assert.equal(completed.status, 201, `Complete past stay: ${JSON.stringify(completed.body)}`)
    assert.equal(completed.body.status, 'COMPLETED')
    console.log('PASS booking prices, access checks, simultaneous overlap prevention, cancellation, date blocks, and completion')
    const task = await request('/tasks', 'POST', users.PROPERTY_MANAGER, { propertyId, title: 'Prepare arrival pack', description: 'Check entry instructions and guest supplies.', dueAt: date(2) })
    assert.equal(task.status, 201, `Create manager task: ${JSON.stringify(task.body)}`)
    assert.equal((await request(`/tasks/${task.body.id}`, 'PATCH', users.PROPERTY_MANAGER, { status: 'IN_PROGRESS' })).status, 200)
    assert.equal((await request(`/tasks/${task.body.id}`, 'PATCH', users.PROPERTY_MANAGER, { status: 'DONE' })).status, 200)
    const expense = await request('/financials/expenses', 'POST', users.OWNER, { propertyId, amountNgn: 18000, category: 'UTILITY', description: 'Electricity for guest preparation', incurredOn: date(0) })
    assert.equal(expense.status, 201, `Record expense: ${JSON.stringify(expense.body)}`)
    assert.equal(expense.body.expenseTotalNgn, 18000)
    assert.equal(expense.body.receivedBookingIncomeNgn, 0, 'No fake payment income')
    const report = await request('/reports', 'GET', users.PROPERTY_MANAGER)
    assert.equal(report.status, 200)
    assert.ok(report.body.totalProperties >= 1 && report.body.recordedExpensesNgn >= 18000, 'Manager report uses live records')
    const audit = await request('/admin/audit?entityType=BOOKING', 'GET', users.ADMIN)
    assert.ok(audit.body.items.some((item) => item.entityId === requested.body.id && item.action === 'BOOKING_REQUESTED'), 'Booking action audited')
    console.log('PASS live Stay publication, public search, booking overlap and cancellation, blocked dates, manager task and occupancy, financial records, role scope, reports, and audit. No payment collected.')
  } finally {
    const cleanupErrors = []
    for (const key of keys) await storage.remove(key).catch(() => cleanupErrors.push(key))
    if (userIds.length) await prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } })
    if (propertyId) {
      await prisma.booking.deleteMany({ where: { listing: { propertyId } } })
      await prisma.property.deleteMany({ where: { id: propertyId } })
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await app.close()
    if (cleanupErrors.length) throw new Error(`Could not remove ${cleanupErrors.length} Storage fixture(s) from run ${run}`)
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Stay operations smoke failed'); process.exitCode = 1 })
