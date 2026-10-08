require('reflect-metadata')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { NestFactory } = require('@nestjs/core')
const { JwtService } = require('@nestjs/jwt')
const { AppModule } = require('../dist/app.module')
const { PrismaService } = require('../dist/database/prisma.service')
const { configureApp } = require('../dist/app.setup')

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] })
  const prisma = app.get(PrismaService)
  const jwt = app.get(JwtService)
  const run = randomUUID().slice(0, 12)
  const userIds = []
  let propertyId
  configureApp(app)
  try {
    const users = {}
    for (const role of ['OWNER', 'ADMIN', 'PROPERTY_MANAGER']) {
      const user = await prisma.user.create({ data: { email: `property-smoke-${run}-${role.toLowerCase()}@example.invalid`, passwordHash: 'unused-test-fixture', role, status: 'ACTIVE', emailVerifiedAt: new Date() } })
      userIds.push(user.id)
      users[role] = { ...user, token: jwt.sign({ sub: user.id, email: user.email, role, version: 0 }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' }) }
    }
    await app.listen(0, '127.0.0.1')
    const base = `${await app.getUrl()}/api/v1/properties`
    async function request(path, method, user, body) {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${user.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
      return { status: response.status, body: await response.json().catch(() => null) }
    }
    const draft = { name: 'Smoke test home', type: 'Apartment', description: 'Temporary property for API verification.', address: '1 Test Street', city: 'Lagos', state: 'Lagos', country: 'Nigeria', occupancyStatus: 'VACANT' }
    const created = await request('', 'POST', users.OWNER, draft)
    assert.equal(created.status, 201)
    propertyId = created.body.id
    assert.equal(created.body.ownerId, users.OWNER.id)
    assert.equal((await request('', 'GET', users.OWNER)).body.some((item) => item.id === propertyId), true)
    const inaccessible = await request(`/${propertyId}`, 'GET', users.PROPERTY_MANAGER)
    assert.equal(inaccessible.status, 404)
    const review = await request(`/${propertyId}/review`, 'PATCH', users.ADMIN, { status: 'UNDER_REVIEW', reviewNote: 'Ready for manager review' })
    assert.equal(review.status, 200)
    const overviewUrl = `${await app.getUrl()}/api/v1/admin/overview`
    const ownerOverview = await fetch(overviewUrl, { headers: { Authorization: `Bearer ${users.OWNER.token}` }, signal: AbortSignal.timeout(30_000) })
    assert.equal(ownerOverview.status, 403, 'Owner cannot access administrator overview')
    const adminOverview = await fetch(overviewUrl, { headers: { Authorization: `Bearer ${users.ADMIN.token}` }, signal: AbortSignal.timeout(30_000) })
    assert.equal(adminOverview.status, 200, 'Administrator can access overview')
    const overview = await adminOverview.json()
    assert.ok(overview.totalProperties >= 1 && overview.reviewQueue >= 1, 'Overview should count real properties')
    const assigned = await request(`/${propertyId}/manager`, 'PATCH', users.ADMIN, { managerId: users.PROPERTY_MANAGER.id })
    assert.equal(assigned.status, 200)
    assert.equal((await request(`/${propertyId}`, 'GET', users.PROPERTY_MANAGER)).status, 200)
    assert.equal((await request(`/${propertyId}`, 'PATCH', users.PROPERTY_MANAGER, draft)).status, 403)
    const approved = await request(`/${propertyId}/review`, 'PATCH', users.ADMIN, { status: 'APPROVED' })
    assert.equal(approved.status, 200)
    assert.equal((await request(`/${propertyId}`, 'PATCH', users.OWNER, draft)).status, 403)
    console.log('PASS property create, owner scope, admin review, real admin overview, manager assignment, and edit permissions. Temporary fixtures will be removed.')
  } finally {
    if (userIds.length) await prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } })
    if (propertyId) await prisma.property.deleteMany({ where: { id: propertyId } })
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await app.close()
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Property smoke test failed'); process.exitCode = 1 })
